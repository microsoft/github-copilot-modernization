#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import {
  BatchStateError,
  acquireLease,
  appendEvent,
  assertSafePersistedValue,
  assertSchedulingAllowed,
  atomicWriteJson,
  fileDigest,
  initializeBatch,
  readLease,
  readState,
  releaseLease,
  updateState,
  writeRepoState,
  writeSummary,
} from "./batch-state.mjs";
import {
  assessmentReportPaths,
  directoryDigest,
  publishBatchAssessmentReport,
} from "./batch-assessment-report.mjs";
import { validateSchema } from "./schema-validator.mjs";
import { validateAttemptResultFile } from "./validate-result.mjs";
import { defaultAssessmentDomains } from "../../assessment/scripts/assessment-catalog.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const assessmentCliPath = fileURLToPath(new URL("../../assessment/scripts/assess-cli.mjs", import.meta.url));
const requestSchemaPath = path.resolve(scriptRoot, "..", "schemas", "attempt-request.schema.json");
const resultSchemaPath = path.resolve(scriptRoot, "..", "schemas", "attempt-result.schema.json");
const validationSchemaPath = path.resolve(scriptRoot, "..", "schemas", "attempt-validation.v1.json");
const finalizationSchemaPath = path.resolve(scriptRoot, "..", "schemas", "assessment-finalization.v1.json");
const resolvedSchemaPath = path.resolve(scriptRoot, "..", "schemas", "resolved-repos.schema.json");
const requestSchema = JSON.parse(fs.readFileSync(requestSchemaPath, "utf8"));
const resultSchema = JSON.parse(fs.readFileSync(resultSchemaPath, "utf8"));
const validationSchema = JSON.parse(fs.readFileSync(validationSchemaPath, "utf8"));
const finalizationSchema = JSON.parse(fs.readFileSync(finalizationSchemaPath, "utf8"));
const resolvedSchema = JSON.parse(fs.readFileSync(resolvedSchemaPath, "utf8"));
const ACTIVE_STATUSES = new Set(["preparing", "running"]);
const TERMINAL_STATUSES = new Set([
  "completed",
  "completed_with_issues",
  "protocol_error",
  "failed",
  "interrupted",
]);
const LEASE_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_SESSION_IDLE_MS = 6 * 60 * 60 * 1000;
const LEASE_SESSION_MAX_MESSAGE_BYTES = 1024 * 1024;
const ASSESSMENT_CONFIG_FIELDS = [
  "targetRuntime",
  "targetComputeServices",
  "enableContainerization",
  "targetOS",
  "minimumCveSeverity",
  "cveScanScope",
];

function assessmentConfig(decisions = {}) {
  return Object.fromEntries(ASSESSMENT_CONFIG_FIELDS
    .filter((name) => decisions[name] !== undefined)
    .map((name) => [name, decisions[name]]));
}

function leaseSessionEndpoint(leaseSessionId) {
  if (!LEASE_SESSION_ID_PATTERN.test(leaseSessionId ?? "")) {
    throw new BatchStateError("Lease session ID is invalid", "invalid_lease_session");
  }
  return process.platform === "win32"
    ? `\\\\.\\pipe\\batch-lease-session-${leaseSessionId}`
    : path.join(os.tmpdir(), `batch-lease-session-${leaseSessionId}.sock`);
}

function compactStartedAttempt(started) {
  return {
    requestPath: started.requestPath,
    resultPath: started.resultPath,
    executionUnitId: started.request.executionUnitId,
    invocationId: started.request.invocationId,
  };
}

function serializedError(error) {
  return {
    code: error?.code ?? "lease_session_error",
    message: error?.message ?? String(error),
  };
}

function jsonDocument(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new BatchStateError(`Unable to read ${label}: ${error.message}`, "invalid_json");
  }
}

function validatedDocument(filePath, schema, schemaPath, label) {
  const document = jsonDocument(filePath, label);
  const errors = validateSchema(document, schema, schemaPath);
  if (errors.length > 0) {
    throw new BatchStateError(`${label} violates its v1 schema: ${errors.join("; ")}`, "schema_validation_failed");
  }
  assertSafePersistedValue(document);
  return document;
}

function createJsonExclusive(filePath, value) {
  const absolutePath = path.resolve(filePath);
  const temporaryPath = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomUUID()}.publish`,
  );
  atomicWriteJson(temporaryPath, value);
  try {
    fs.linkSync(temporaryPath, absolutePath);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new BatchStateError(`Attempt artifact already exists: ${absolutePath}`, "attempt_artifact_exists");
    }
    throw error;
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function createOrVerifyJson(filePath, value, schemaValue, schemaFilePath, label) {
  if (fs.existsSync(filePath)) {
    const existing = validatedDocument(filePath, schemaValue, schemaFilePath, label);
    if (!isDeepStrictEqual(existing, value)) {
      throw new BatchStateError(`${label} conflicts with the existing immutable artifact`, "attempt_artifact_conflict");
    }
    return false;
  }
  createJsonExclusive(filePath, value);
  return true;
}

function manifestUnit(batchRoot, executionUnitId) {
  const manifest = jsonDocument(path.join(batchRoot, "manifest.json"), "batch manifest");
  if (manifest.schemaVersion !== 1) {
    throw new BatchStateError("Unsupported batch manifest schemaVersion", "unsupported_schema");
  }
  const matches = (manifest.resolvedConfig?.repositories ?? [])
    .flatMap((repository) => repository.executionUnits ?? [])
    .filter((unit) => unit.executionUnitId === executionUnitId);
  if (matches.length !== 1) {
    throw new BatchStateError(
      `Execution unit ${JSON.stringify(executionUnitId)} is not uniquely present in the batch manifest`,
      "execution_unit_not_found",
    );
  }
  return matches[0];
}

function executionUnitLanguage(unit) {
  const supported = new Set(["java", "dotnet", "javascript", "typescript"]);
  if (!Array.isArray(unit.languages)
      || unit.languages.length !== 1
      || !supported.has(unit.languages[0])) {
    throw new BatchStateError(
      `Execution unit ${JSON.stringify(unit.executionUnitId)} must have exactly one supported language`,
      "unsupported_execution_unit_languages",
    );
  }
  return unit.languages[0];
}

function effectiveAssessmentDecisions(decisions, language) {
  return {
    ...decisions,
    domains: decisions.domains ?? defaultAssessmentDomains(language),
  };
}

function assertRequestMatchesBatch(batchRoot, requestPath, request) {
  const manifest = jsonDocument(path.join(batchRoot, "manifest.json"), "batch manifest");
  const unit = manifestUnit(batchRoot, request.executionUnitId);
  const expected = {
    batchId: manifest.batchId,
    repoId: unit.repoId,
    workspacePath: unit.workspacePath,
    scopeRoots: unit.scopeRoots,
    assessmentCliPath,
    runId: `batch-${request.invocationId.toLowerCase()}`,
    language: executionUnitLanguage(unit),
    phase: "assessment",
    attempt: 1,
    mode: "batch-headless",
    userRequest: manifest.assessment?.userRequest,
    phaseApproved: true,
    inputArtifacts: manifest.assessment?.inputArtifacts ?? {},
    decisions: effectiveAssessmentDecisions(
      manifest.assessment?.decisions ?? {},
      executionUnitLanguage(unit),
    ),
  };
  for (const [field, value] of Object.entries(expected)) {
    if (!isDeepStrictEqual(request[field], value)) {
      throw new BatchStateError(
        `Attempt request ${field} does not match the initialized batch`,
        "attempt_request_mismatch",
      );
    }
  }
  const expectedDirectory = attemptDirectory(
    batchRoot,
    unit.repoId,
    unit.executionUnitId,
    request.phase,
    request.attempt,
  );
  if (path.resolve(requestPath) !== path.join(expectedDirectory, "request.json")
      || path.resolve(request.resultPath) !== path.join(expectedDirectory, "result.json")) {
    throw new BatchStateError("Attempt request paths do not match the initialized batch", "attempt_request_mismatch");
  }
}

function attemptDirectory(batchRoot, repoId, executionUnitId, phase, attempt) {
  const unitDigest = crypto.createHash("sha256").update(executionUnitId).digest("hex").slice(0, 16);
  return path.join(path.resolve(batchRoot), "attempts", repoId, unitDigest, phase, String(attempt));
}

function validateAttemptInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BatchStateError("Attempt input must be an object", "invalid_attempt_input");
  }
  if (typeof input.userRequest !== "string" || !input.userRequest.trim()) {
    throw new BatchStateError("Attempt input requires userRequest", "invalid_attempt_input");
  }
  if (input.phaseApproved !== true) {
    throw new BatchStateError("Assessment phase is not approved", "phase_not_approved");
  }
  for (const [name, value] of Object.entries(input.inputArtifacts ?? {})) {
    if (typeof name !== "string" || typeof value !== "string" || !value) {
      throw new BatchStateError("inputArtifacts must contain non-empty string values", "invalid_attempt_input");
    }
  }
  if (input.decisions !== undefined && (
    !input.decisions || typeof input.decisions !== "object" || Array.isArray(input.decisions)
  )) {
    throw new BatchStateError("decisions must be an object", "invalid_attempt_input");
  }
}

function validateAssessmentDecisions(decisions, { domainsRequired = false, allowEmptyDomains = false } = {}) {
  const supportedDomains = new Set(["security", "cloud-readiness", "java-upgrade"]);
  const supportedFields = new Set([
    "domains",
    "analysisCoverage",
    "maxConcurrency",
    ...ASSESSMENT_CONFIG_FIELDS,
  ]);
  const unknownFields = Object.keys(decisions ?? {}).filter((name) => !supportedFields.has(name));
  if (unknownFields.length > 0) {
    throw new BatchStateError(
      `Assessment decisions contain unsupported fields: ${unknownFields.join(", ")}`,
      "invalid_assessment_decisions",
    );
  }
  const domains = decisions?.domains;
  if ((domainsRequired && !Array.isArray(domains))
      || (domains !== undefined && (
        !Array.isArray(domains)
        || (!allowEmptyDomains && domains.length === 0)
        || new Set(domains).size !== domains.length
        || domains.some((domain) => !supportedDomains.has(domain))
      ))) {
    throw new BatchStateError("Assessment decisions require supported domains", "invalid_assessment_decisions");
  }
  if (!["issue-only", "full"].includes(decisions.analysisCoverage)) {
    throw new BatchStateError("Assessment decisions require issue-only or full coverage", "invalid_assessment_decisions");
  }
  if (!Number.isInteger(decisions.maxConcurrency)
      || decisions.maxConcurrency < 1
      || decisions.maxConcurrency > 7) {
    throw new BatchStateError("Assessment maxConcurrency must be between 1 and 7", "invalid_assessment_decisions");
  }
  for (const name of ["targetRuntime", "minimumCveSeverity", "cveScanScope"]) {
    if (decisions[name] !== undefined && (typeof decisions[name] !== "string" || !decisions[name].trim())) {
      throw new BatchStateError(`Assessment ${name} must be a non-empty string`, "invalid_assessment_decisions");
    }
  }
  for (const name of ["targetComputeServices", "targetOS"]) {
    const value = decisions[name];
    if (value !== undefined && (
      !Array.isArray(value)
      || value.length === 0
      || new Set(value).size !== value.length
      || value.some((entry) => typeof entry !== "string" || !entry.trim())
    )) {
      throw new BatchStateError(`Assessment ${name} must be a non-empty unique string array`, "invalid_assessment_decisions");
    }
  }
  if (decisions.enableContainerization !== undefined
      && typeof decisions.enableContainerization !== "boolean") {
    throw new BatchStateError("Assessment enableContainerization must be a boolean", "invalid_assessment_decisions");
  }
}

export function initializeAssessmentBatch({
  batchRoot,
  resolvedConfig,
  selection,
  input,
  now = new Date().toISOString(),
} = {}) {
  const resolvedErrors = validateSchema(resolvedConfig, resolvedSchema, resolvedSchemaPath);
  if (resolvedErrors.length > 0) {
    throw new BatchStateError(
      `Inspected repositories violate the v1 schema: ${resolvedErrors.join("; ")}`,
      "schema_validation_failed",
    );
  }
  validateAttemptInput(input);
  validateAssessmentDecisions(input.decisions);
  const selectedIds = selection?.executionUnitIds;
  const approvedAttention = new Set(selection?.approvedNeedsAttention ?? []);
  if (!Array.isArray(selectedIds) || selectedIds.length === 0 || new Set(selectedIds).size !== selectedIds.length) {
    throw new BatchStateError("Selection requires unique executionUnitIds", "invalid_selection");
  }
  const units = [];
  for (const executionUnitId of selectedIds) {
    const repositories = resolvedConfig.repositories.filter((repository) =>
      repository.executionUnits.some((unit) => unit.executionUnitId === executionUnitId));
    if (repositories.length !== 1) {
      throw new BatchStateError(`Selected execution unit is not unique: ${executionUnitId}`, "invalid_selection");
    }
    const repository = repositories[0];
    if (repository.preflightStatus === "blocked") {
      throw new BatchStateError(`Blocked repository cannot be selected: ${repository.repoId}`, "blocked_selection");
    }
    if (repository.preflightStatus === "needs_attention" && !approvedAttention.has(executionUnitId)) {
      throw new BatchStateError(
        `Execution unit requires explicit attention approval: ${executionUnitId}`,
        "attention_not_approved",
      );
    }
    const unit = repository.executionUnits.find((candidate) => candidate.executionUnitId === executionUnitId);
    executionUnitLanguage(unit);
    if (unit.source === "include-path") {
      throw new BatchStateError(
        `Batch Assessment supports whole repositories only; include-path execution unit is not supported: ${executionUnitId}`,
        "unsupported_execution_unit_source",
      );
    }
    units.push(unit);
  }
  const batchId = input.batchId;
  if (typeof batchId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(batchId)) {
    throw new BatchStateError("Assessment batch requires a valid batchId", "invalid_batch_id");
  }
  const manifest = {
    batchId,
    createdAt: now,
    executionMode: "local",
    action: "assessment",
    resolvedConfig,
    selectedExecutionUnitIds: selectedIds,
    assessment: {
      userRequest: input.userRequest,
      phaseApproved: true,
      inputArtifacts: input.inputArtifacts ?? {},
      decisions: input.decisions,
    },
  };
  assertSafePersistedValue(manifest);
  const state = {
    status: "ready",
    executionUnits: units.map((unit) => ({
      repoId: unit.repoId,
      executionUnitId: unit.executionUnitId,
      phase: "assessment",
      attempt: 0,
      invocationId: null,
      status: "pending",
      resultPath: null,
      startedAt: null,
      finishedAt: null,
    })),
    progress: {
      wave: 1,
      eligible: units.length,
      terminal: 0,
      successful: 0,
      issues: 0,
      failed: 0,
    },
  };
  const paths = initializeBatch({ batchRoot, manifest, state, now });
  return { ...paths, manifest, state: readState(batchRoot) };
}

export function startAttempt({
  batchRoot,
  ownerToken,
  executionUnitId,
  phase = "assessment",
  input,
  invocationId,
  now = new Date().toISOString(),
  checkpoint,
} = {}) {
  if (phase !== "assessment") {
    throw new BatchStateError("Batch Assessment supports assessment attempts only", "phase_not_supported");
  }
  const manifest = jsonDocument(path.join(batchRoot, "manifest.json"), "batch manifest");
  const attemptInput = input ?? manifest.assessment;
  validateAttemptInput(attemptInput);
  validateAssessmentDecisions(attemptInput.decisions);
  assertSafePersistedValue(attemptInput);
  assertSchedulingAllowed(batchRoot, ownerToken);
  const current = readState(batchRoot);
  const unitIndex = current.executionUnits.findIndex(
    (unit) => unit.executionUnitId === executionUnitId && unit.phase === phase,
  );
  if (unitIndex < 0) {
    throw new BatchStateError("Execution unit is not scheduled for this phase", "execution_unit_not_scheduled");
  }
  const scheduled = current.executionUnits[unitIndex];
  const unit = manifestUnit(batchRoot, executionUnitId);
  if (unit.repoId !== scheduled.repoId) {
    throw new BatchStateError("Manifest and state repository identities differ", "attempt_identity_mismatch");
  }
  const language = executionUnitLanguage(unit);
  const decisions = effectiveAssessmentDecisions(attemptInput.decisions, language);
  validateAssessmentDecisions(decisions, {
    domainsRequired: true,
    allowEmptyDomains: language === "javascript" || language === "typescript",
  });
  const attempt = 1;
  const directory = attemptDirectory(batchRoot, unit.repoId, executionUnitId, phase, attempt);
  const requestPath = path.join(directory, "request.json");
  const resultPath = path.join(directory, "result.json");
  const existingRequest = fs.existsSync(requestPath)
    ? validatedDocument(requestPath, requestSchema, requestSchemaPath, "attempt request")
    : null;
  if (existingRequest) assertRequestMatchesBatch(batchRoot, requestPath, existingRequest);
  if (existingRequest && invocationId && existingRequest.invocationId !== invocationId) {
    throw new BatchStateError("Attempt request is already bound to another invocation", "attempt_artifact_conflict");
  }
  const effectiveInvocationId = existingRequest?.invocationId ?? invocationId ?? crypto.randomUUID();
  const matchingReplay = scheduled.status === "running"
    && scheduled.attempt === attempt
    && scheduled.invocationId === effectiveInvocationId
    && scheduled.resultPath === resultPath;
  const activeUnits = current.executionUnits.filter((candidate) => ACTIVE_STATUSES.has(candidate.status));
  if (activeUnits.length > 0 && !matchingReplay) {
    throw new BatchStateError("Another attempt is already active", "attempt_already_active");
  }
  if (!matchingReplay && (scheduled.status !== "pending" || scheduled.attempt !== 0)) {
    throw new BatchStateError("Batch Assessment starts only a pending first attempt", "attempt_not_startable");
  }
  const request = {
    schemaVersion: 1,
    batchId: current.batchId,
    invocationId: effectiveInvocationId,
    repoId: unit.repoId,
    executionUnitId,
    workspacePath: unit.workspacePath,
    scopeRoots: unit.scopeRoots,
    assessmentCliPath,
    runId: `batch-${effectiveInvocationId.toLowerCase()}`,
    language,
    phase,
    attempt,
    mode: "batch-headless",
    userRequest: attemptInput.userRequest,
    phaseApproved: true,
    resultPath,
    inputArtifacts: attemptInput.inputArtifacts ?? {},
    decisions,
  };
  const errors = validateSchema(request, requestSchema, requestSchemaPath);
  if (errors.length > 0) {
    throw new BatchStateError(`Attempt request violates its v1 schema: ${errors.join("; ")}`, "schema_validation_failed");
  }
  assertSafePersistedValue(request);
  const requestCreated = createOrVerifyJson(
    requestPath,
    request,
    requestSchema,
    requestSchemaPath,
    "attempt request",
  );
  checkpoint?.("request");
  let state;
  if (matchingReplay) {
    state = current;
  } else {
    try {
      state = updateState({
        batchRoot,
        ownerToken,
        now,
        mutate: (draft) => {
          const stateUnit = draft.executionUnits.find(
            (candidate) => candidate.executionUnitId === executionUnitId && candidate.phase === phase,
          );
          if (!stateUnit || stateUnit.status !== "pending" || stateUnit.attempt !== 0) {
            throw new BatchStateError("Execution unit changed before dispatch", "attempt_compare_failed");
          }
          Object.assign(stateUnit, {
            attempt,
            invocationId: effectiveInvocationId,
            status: "running",
            resultPath,
            startedAt: now,
            finishedAt: null,
          });
          draft.status = "running";
          return draft;
        },
      });
    } catch (error) {
      if (requestCreated) fs.rmSync(requestPath, { force: true });
      throw error;
    }
  }
  checkpoint?.("state");
  appendEvent({
    batchRoot,
    ownerToken,
    now,
    operationKey: attemptOperationKey("start", request),
    event: {
      type: "attempt_started",
      repoId: unit.repoId,
      executionUnitId,
      invocationId: effectiveInvocationId,
      payload: { phase, attempt, requestPath, resultPath },
    },
  });
  checkpoint?.("event");
  return { requestPath, resultPath, request, state };
}

function assertRequestResultBinding(requestPath, request) {
  const absoluteRequestPath = path.resolve(requestPath);
  const absoluteResultPath = path.resolve(request.resultPath);
  if (path.basename(absoluteRequestPath) !== "request.json"
      || path.basename(absoluteResultPath) !== "result.json"
      || path.dirname(absoluteRequestPath) !== path.dirname(absoluteResultPath)) {
    throw new BatchStateError("Attempt request and result paths are not colocated", "invalid_result_binding");
  }
}

export function publishAttemptResult({ requestPath, outcome, now = new Date().toISOString() } = {}) {
  const request = validatedDocument(requestPath, requestSchema, requestSchemaPath, "attempt request");
  assertRequestResultBinding(requestPath, request);
  const allowed = new Set(["status", "artifacts", "evidence", "needsInput", "error"]);
  const unknown = Object.keys(outcome ?? {}).filter((name) => !allowed.has(name));
  if (unknown.length > 0) {
    throw new BatchStateError(`Attempt outcome contains unsupported fields: ${unknown.join(", ")}`, "invalid_attempt_outcome");
  }
  const result = {
    schemaVersion: 1,
    batchId: request.batchId,
    invocationId: request.invocationId,
    repoId: request.repoId,
    executionUnitId: request.executionUnitId,
    phase: request.phase,
    attempt: request.attempt,
    status: outcome?.status,
    artifacts: outcome?.artifacts ?? {},
    evidence: outcome?.evidence ?? { artifactValidation: "not_run" },
    needsInput: outcome?.needsInput ?? null,
    error: outcome?.error ?? null,
    completedAt: now,
  };
  const errors = validateSchema(result, resultSchema, resultSchemaPath);
  if (errors.length > 0) {
    throw new BatchStateError(`Attempt result violates its v1 schema: ${errors.join("; ")}`, "schema_validation_failed");
  }
  assertSafePersistedValue(result);
  createJsonExclusive(request.resultPath, result);
  return { resultPath: request.resultPath, result };
}

function stateStatus(resultStatus) {
  if (resultStatus === "skipped") return "failed";
  return resultStatus;
}

function attemptOperationKey(operation, request) {
  return [
    operation,
    request.batchId,
    request.executionUnitId,
    request.phase,
    request.attempt,
    request.invocationId,
  ].join(":");
}

function validationRecordPath(requestPath) {
  return path.join(path.dirname(path.resolve(requestPath)), "validation.json");
}

function finalizationRecordPath(batchRoot) {
  return path.join(path.resolve(batchRoot), "finalization.json");
}

function validationFromRecord(record) {
  return {
    valid: record.valid,
    status: record.status,
    errors: record.errors,
    artifacts: record.artifacts,
  };
}

function validateResultAgainstRequest(batchRoot, requestPath, request) {
  return validateAttemptResultFile(request.resultPath, {
    batchRoot,
    workspacePath: request.workspacePath,
    expected: {
      batchId: request.batchId,
      invocationId: request.invocationId,
      repoId: request.repoId,
      executionUnitId: request.executionUnitId,
      phase: request.phase,
      attempt: request.attempt,
    },
    assessment: {
      runId: request.runId,
      language: request.language,
      domains: request.decisions.domains,
      analysisCoverage: request.decisions.analysisCoverage,
      assessmentConfig: assessmentConfig(request.decisions),
      attemptDirectory: path.dirname(path.resolve(requestPath)),
      workspacePath: request.workspacePath,
    },
  });
}

function artifactDigests(artifacts) {
  return Object.fromEntries(
    Object.entries(artifacts).map(([name, artifactPath]) => [name, fileDigest(artifactPath)]),
  );
}

function validateRecordBinding(record, requestPath, request) {
  const expected = {
    batchId: request.batchId,
    invocationId: request.invocationId,
    repoId: request.repoId,
    executionUnitId: request.executionUnitId,
    phase: request.phase,
    attempt: request.attempt,
    requestDigest: fileDigest(requestPath),
    resultDigest: fs.existsSync(request.resultPath) ? fileDigest(request.resultPath) : null,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (record[field] !== value) {
      throw new BatchStateError(
        `Attempt validation record ${field} does not match immutable attempt artifacts`,
        "validation_record_mismatch",
      );
    }
  }
}

function verifyValidationRecord({ batchRoot, requestPath, request, record }) {
  validateRecordBinding(record, requestPath, request);
  const validation = validateResultAgainstRequest(batchRoot, requestPath, request);
  if (!isDeepStrictEqual(validationFromRecord(record), validation)) {
    throw new BatchStateError(
      "Attempt validation record no longer matches the request result and artifacts",
      "validation_record_mismatch",
    );
  }
  let currentDigests;
  try {
    currentDigests = artifactDigests(record.artifacts);
  } catch (error) {
    throw new BatchStateError(`Validated artifact is unavailable: ${error.message}`, "validated_artifact_changed");
  }
  if (!isDeepStrictEqual(record.artifactDigests, currentDigests)) {
    throw new BatchStateError("Validated artifact content changed after commit", "validated_artifact_changed");
  }
  return validation;
}

function readOrCreateValidationRecord({ batchRoot, requestPath, request, now }) {
  const recordPath = validationRecordPath(requestPath);
  if (fs.existsSync(recordPath)) {
    const record = validatedDocument(recordPath, validationSchema, validationSchemaPath, "attempt validation record");
    verifyValidationRecord({ batchRoot, requestPath, request, record });
    return { recordPath, record, validation: validationFromRecord(record), created: false };
  }
  const validation = validateResultAgainstRequest(batchRoot, requestPath, request);
  const record = {
    schemaVersion: 1,
    batchId: request.batchId,
    invocationId: request.invocationId,
    repoId: request.repoId,
    executionUnitId: request.executionUnitId,
    phase: request.phase,
    attempt: request.attempt,
    requestDigest: fileDigest(requestPath),
    resultDigest: fs.existsSync(request.resultPath) ? fileDigest(request.resultPath) : null,
    status: validation.status,
    valid: validation.valid,
    errors: validation.errors,
    artifacts: validation.artifacts,
    artifactDigests: artifactDigests(validation.artifacts),
    validatedAt: now,
  };
  const errors = validateSchema(record, validationSchema, validationSchemaPath);
  if (errors.length > 0) {
    throw new BatchStateError(`Attempt validation record violates its schema: ${errors.join("; ")}`, "schema_validation_failed");
  }
  assertSafePersistedValue(record);
  createJsonExclusive(recordPath, record);
  return { recordPath, record, validation, created: true };
}

function calculateProgress(executionUnits) {
  const eligible = executionUnits.filter(
    (unit) => !["not_applicable", "excluded", "blocked"].includes(unit.status),
  );
  return {
    wave: 1,
    eligible: eligible.length,
    terminal: eligible.filter((unit) => TERMINAL_STATUSES.has(unit.status)).length,
    successful: eligible.filter((unit) => unit.status === "completed").length,
    issues: eligible.filter((unit) => unit.status === "completed_with_issues").length,
    failed: eligible.filter((unit) => ["protocol_error", "failed", "interrupted"].includes(unit.status)).length,
  };
}

function aggregateBatchStatus(executionUnits, progress) {
  if (executionUnits.some((unit) => unit.status === "needs_input")) return "awaiting_input";
  if (executionUnits.some((unit) => ["pending", "preparing", "running"].includes(unit.status))) return "running";
  if (progress.successful + progress.issues === 0) return "failed";
  return progress.issues > 0 || progress.failed > 0 ? "completed_with_issues" : "completed";
}

export function commitAttempt({
  batchRoot,
  ownerToken,
  requestPath,
  now = new Date().toISOString(),
  checkpoint,
} = {}) {
  assertSchedulingAllowed(batchRoot, ownerToken);
  const request = validatedDocument(requestPath, requestSchema, requestSchemaPath, "attempt request");
  assertRequestResultBinding(requestPath, request);
  assertRequestMatchesBatch(batchRoot, requestPath, request);
  const validationRecord = readOrCreateValidationRecord({ batchRoot, requestPath, request, now });
  const { validation } = validationRecord;
  checkpoint?.("validation");
  const committedStatus = stateStatus(validation.status);
  const current = readState(batchRoot);
  const currentUnit = current.executionUnits.find(
    (candidate) => candidate.executionUnitId === request.executionUnitId
      && candidate.phase === request.phase,
  );
  const identityMatches = currentUnit
    && currentUnit.attempt === request.attempt
    && currentUnit.invocationId === request.invocationId
    && currentUnit.resultPath === request.resultPath;
  let state;
  if (identityMatches && currentUnit.status === committedStatus) {
    state = current;
  } else if (identityMatches && currentUnit.status === "running") {
    state = updateState({
      batchRoot,
      ownerToken,
      now,
      mutate: (draft) => {
        const unit = draft.executionUnits.find(
          (candidate) => candidate.executionUnitId === request.executionUnitId
            && candidate.phase === request.phase,
        );
        if (!unit || unit.status !== "running") {
          throw new BatchStateError("Running state does not match the attempt request", "attempt_compare_failed");
        }
        unit.status = committedStatus;
        unit.finishedAt = now;
        draft.progress = calculateProgress(draft.executionUnits);
        draft.status = aggregateBatchStatus(draft.executionUnits, draft.progress);
        return draft;
      },
    });
  } else {
    throw new BatchStateError("Attempt state does not match the validation record", "attempt_compare_failed");
  }
  checkpoint?.("state");
  const repoUnits = state.executionUnits.filter((unit) => unit.repoId === request.repoId);
  const repoStatePath = path.join(path.resolve(batchRoot), "repos", `${request.repoId}.json`);
  const previousRepoState = fs.existsSync(repoStatePath)
    ? jsonDocument(repoStatePath, "repository state")
    : null;
  const validations = {
    ...(previousRepoState?.validations ?? {}),
    [request.executionUnitId]: {
      status: validation.status,
      valid: validation.valid,
      errors: validation.errors,
      artifacts: validation.artifacts,
    },
  };
  writeRepoState({
    batchRoot,
    ownerToken,
    repoId: request.repoId,
    state: {
      schemaVersion: 1,
      repoId: request.repoId,
      status: repoUnits.some((unit) => ["protocol_error", "failed", "interrupted"].includes(unit.status))
        ? "completed_with_issues"
        : repoUnits.some((unit) => unit.status === "completed_with_issues")
          ? "completed_with_issues"
          : committedStatus,
      executionUnits: repoUnits,
      validations,
      latestValidation: {
        executionUnitId: request.executionUnitId,
        status: validation.status,
        valid: validation.valid,
        errors: validation.errors,
        artifacts: validation.artifacts,
      },
    },
  });
  checkpoint?.("repo");
  appendEvent({
    batchRoot,
    ownerToken,
    now,
    operationKey: attemptOperationKey("commit", request),
    event: {
      type: validation.status === "needs_input" ? "input_requested" : "attempt_finished",
      repoId: request.repoId,
      executionUnitId: request.executionUnitId,
      invocationId: request.invocationId,
      payload: { phase: request.phase, attempt: request.attempt, status: validation.status },
    },
  });
  checkpoint?.("event");
  return { validation, validationRecordPath: validationRecord.recordPath, state };
}

export function finalizeAssessmentBatch({
  batchRoot,
  ownerToken,
  now = new Date().toISOString(),
  checkpoint,
} = {}) {
  const root = path.resolve(batchRoot);
  const journalPath = finalizationRecordPath(root);
  const state = readState(root);
  const summaryPaths = {
    json: path.join(root, "summary.json"),
    markdown: path.join(root, "summary.md"),
  };
  const expectedReportPaths = assessmentReportPaths({ batchRoot: root, completedAt: state.updatedAt });
  const paths = { ...summaryPaths, ...expectedReportPaths };
  const existingJournal = fs.existsSync(journalPath)
    ? validatedDocument(journalPath, finalizationSchema, finalizationSchemaPath, "Assessment finalization journal")
    : null;
  if (existingJournal?.releaseReady && !readLease(root)) {
    if (fileDigest(summaryPaths.json) !== existingJournal.summaryJsonDigest
        || fileDigest(summaryPaths.markdown) !== existingJournal.summaryMarkdownDigest
        || existingJournal.reportDirectoryPath !== expectedReportPaths.reportDirectory
        || existingJournal.reportIndexPath !== expectedReportPaths.reportIndex
        || existingJournal.aggregateReportPath !== expectedReportPaths.aggregateReport
        || directoryDigest(expectedReportPaths.reportDirectory) !== existingJournal.reportDirectoryDigest
        || fileDigest(expectedReportPaths.reportIndex) !== existingJournal.reportIndexDigest
        || fileDigest(expectedReportPaths.aggregateReport) !== existingJournal.aggregateReportDigest) {
      throw new BatchStateError("Finalized deliverables do not match their journal", "finalization_record_mismatch");
    }
    const releasedJournal = existingJournal.released
      ? existingJournal
      : { ...existingJournal, released: true };
    if (!existingJournal.released) atomicWriteJson(journalPath, releasedJournal);
    return { summary: jsonDocument(summaryPaths.json, "batch summary"), paths };
  }
  assertSchedulingAllowed(batchRoot, ownerToken);
  if (["draft", "ready", "running", "awaiting_input"].includes(state.status)
      || state.executionUnits.some((unit) => ["pending", "preparing", "running", "needs_input"].includes(unit.status))) {
    throw new BatchStateError("Batch still has non-terminal assessment work", "batch_not_terminal");
  }
  const repoValidations = new Map();
  for (const repoId of new Set(state.executionUnits.map((unit) => unit.repoId))) {
    const repoPath = path.join(path.resolve(batchRoot), "repos", `${repoId}.json`);
    if (!fs.existsSync(repoPath)) {
      throw new BatchStateError(`Repository validation state is missing: ${repoId}`, "validation_commit_incomplete");
    }
    const repoState = jsonDocument(repoPath, "repository state");
    for (const [executionUnitId, validation] of Object.entries(repoState.validations ?? {})) {
      repoValidations.set(executionUnitId, validation);
    }
  }
  const manifest = jsonDocument(path.join(root, "manifest.json"), "batch manifest");
  const results = state.executionUnits.map((unit) => {
    if (!unit.resultPath || unit.attempt < 1 || !unit.invocationId) {
      throw new BatchStateError(`Terminal execution unit has no attempt identity: ${unit.executionUnitId}`, "validation_commit_incomplete");
    }
    const requestPath = path.join(path.dirname(unit.resultPath), "request.json");
    const request = validatedDocument(requestPath, requestSchema, requestSchemaPath, "attempt request");
    assertRequestMatchesBatch(batchRoot, requestPath, request);
    const recordPath = validationRecordPath(requestPath);
    if (!fs.existsSync(recordPath)) {
      throw new BatchStateError(`Attempt validation record is missing: ${unit.executionUnitId}`, "validation_commit_incomplete");
    }
    const record = validatedDocument(recordPath, validationSchema, validationSchemaPath, "attempt validation record");
    verifyValidationRecord({ batchRoot, requestPath, request, record });
    if (record.executionUnitId !== unit.executionUnitId
        || record.invocationId !== unit.invocationId
        || stateStatus(record.status) !== unit.status) {
      throw new BatchStateError(`Attempt validation record does not match terminal state: ${unit.executionUnitId}`, "validation_record_mismatch");
    }
    const validation = validationFromRecord(record);
    if (!isDeepStrictEqual(repoValidations.get(unit.executionUnitId), validation)) {
      throw new BatchStateError(`Repository validation is not committed: ${unit.executionUnitId}`, "validation_commit_incomplete");
    }
    return {
      repoId: unit.repoId,
      executionUnitId: unit.executionUnitId,
      status: unit.status,
      attempt: unit.attempt,
      language: request.language,
      workspacePath: request.workspacePath,
      artifacts: record.artifacts,
      artifactDigests: record.artifactDigests,
      errors: record.errors,
    };
  });
  const publishedReport = publishBatchAssessmentReport({
    batchRoot: root,
    manifest,
    state,
    results,
  });
  checkpoint?.("report");
  const aggregateSummary = publishedReport.aggregate.extensions["github-copilot-modernization"];
  const summary = {
    schemaVersion: 1,
    batchId: state.batchId,
    phase: "assessment",
    status: state.status,
    completedAt: state.updatedAt,
    counts: {
      total: results.length,
      completed: results.filter((result) => result.status === "completed").length,
      completedWithIssues: results.filter((result) => result.status === "completed_with_issues").length,
      failed: results.filter((result) => ["protocol_error", "failed", "interrupted"].includes(result.status)).length,
    },
    reports: {
      directory: publishedReport.paths.reportDirectory,
      index: publishedReport.paths.reportIndex,
      aggregate: publishedReport.paths.aggregateReport,
      digest: publishedReport.reportDirectoryDigest,
    },
    findings: {
      total: aggregateSummary.counts.trackedFindings,
      bySeverity: aggregateSummary.counts.bySeverity,
      byState: aggregateSummary.counts.byState,
    },
    topRecommendations: aggregateSummary.topRecommendations,
    planningSupported: aggregateSummary.planningSupported,
    results,
  };
  const markdown = [
    `# Batch Assessment ${state.batchId}`,
    "",
    `Status: ${state.status}`,
    "",
    `- Total: ${summary.counts.total}`,
    `- Completed: ${summary.counts.completed}`,
    `- Completed with issues: ${summary.counts.completedWithIssues}`,
    `- Failed: ${summary.counts.failed}`,
    "",
    "## Findings",
    "",
    `- Tracked: ${summary.findings.total}`,
    `- Critical: ${summary.findings.bySeverity.critical}`,
    `- High: ${summary.findings.bySeverity.high}`,
    `- Medium: ${summary.findings.bySeverity.medium}`,
    `- Low: ${summary.findings.bySeverity.low}`,
    `- Info: ${summary.findings.bySeverity.info}`,
    ...Object.entries(summary.findings.byState).map(([stateName, count]) => `- ${stateName}: ${count}`),
    "",
    "## Top Recommendations",
    "",
    ...(summary.topRecommendations.length > 0
      ? summary.topRecommendations.map((recommendation) => `- ${recommendation.identity}: ${recommendation.summary}`)
      : ["- None"]),
    "",
    "## Planning Support",
    "",
    `- Supported: ${summary.planningSupported.supported}`,
    `- Not supported: ${summary.planningSupported.unsupported}`,
    `- Unavailable: ${summary.planningSupported.unavailable}`,
    "",
    "## Report",
    "",
    `- Dashboard: ${summary.reports.index}`,
    `- Aggregate data: ${summary.reports.aggregate}`,
    "",
    "## Results",
    "",
    ...results.map((result) => {
      const report = result.artifacts.report ? `; report: ${result.artifacts.report}` : "";
      const error = result.errors.length > 0 ? `; ${result.errors.join("; ")}` : "";
      return `- ${result.executionUnitId}: ${result.status}${report}${error}`;
    }),
    "",
  ].join("\n");
  writeSummary({ batchRoot, ownerToken, summary, markdown });
  checkpoint?.("summary");
  appendEvent({
    batchRoot,
    ownerToken,
    now,
    operationKey: `finalize:${state.batchId}:assessment`,
    event: { type: "batch_completed", payload: { status: state.status, counts: summary.counts } },
  });
  checkpoint?.("event");
  const journal = {
    schemaVersion: 1,
    batchId: state.batchId,
    phase: "assessment",
    status: state.status,
    summaryJsonDigest: fileDigest(paths.json),
    summaryMarkdownDigest: fileDigest(paths.markdown),
    reportDirectoryPath: publishedReport.paths.reportDirectory,
    reportIndexPath: publishedReport.paths.reportIndex,
    aggregateReportPath: publishedReport.paths.aggregateReport,
    reportDirectoryDigest: publishedReport.reportDirectoryDigest,
    reportIndexDigest: publishedReport.reportIndexDigest,
    aggregateReportDigest: publishedReport.aggregateReportDigest,
    completedAt: summary.completedAt,
    releaseReady: true,
    released: false,
  };
  const journalErrors = validateSchema(journal, finalizationSchema, finalizationSchemaPath);
  if (journalErrors.length > 0) {
    throw new BatchStateError(`Assessment finalization journal violates its schema: ${journalErrors.join("; ")}`, "schema_validation_failed");
  }
  if (existingJournal && !isDeepStrictEqual(existingJournal, journal)) {
    const comparableExisting = { ...existingJournal, released: false };
    if (!isDeepStrictEqual(comparableExisting, journal)) {
      throw new BatchStateError("Assessment finalization journal conflicts with the summary", "finalization_record_mismatch");
    }
  }
  atomicWriteJson(journalPath, journal);
  checkpoint?.("release-ready");
  releaseLease({ batchRoot, ownerToken });
  checkpoint?.("released");
  atomicWriteJson(journalPath, { ...journal, released: true });
  checkpoint?.("complete");
  return { summary, paths };
}

function executeLeaseSessionOperation({ batchRoot, ownerToken, request }) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new BatchStateError("Lease session request must be an object", "invalid_lease_session_request");
  }
  if (request.operation === "start") {
    return startAttempt({
      batchRoot,
      ownerToken,
      executionUnitId: request.executionUnitId,
    });
  }
  if (request.operation === "commit") {
    return commitAttempt({
      batchRoot,
      ownerToken,
      requestPath: request.requestPath,
    });
  }
  if (request.operation === "finalize-assessment") {
    return finalizeAssessmentBatch({ batchRoot, ownerToken });
  }
  if (request.operation === "release") {
    return releaseLease({ batchRoot, ownerToken });
  }
  throw new BatchStateError("Unknown lease session operation", "unknown_lease_session_operation");
}

async function runLeaseSessionWorker({ batchRoot, invocationId, leaseSessionId, executionUnitId }) {
  const endpoint = leaseSessionEndpoint(leaseSessionId);
  if (process.platform !== "win32") fs.rmSync(endpoint, { force: true });
  let ownerToken;
  let server;
  let idleTimer;
  let readySent = false;
  const closeServer = () => {
    clearTimeout(idleTimer);
    server?.close();
  };
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(closeServer, LEASE_SESSION_IDLE_MS);
  };

  try {
    ownerToken = acquireLease({ batchRoot, invocationId }).ownerToken;
    server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      let message = "";
      let handled = false;
      const respond = (response, closeAfterResponse = false) => {
        socket.end(`${JSON.stringify(response)}\n`, () => {
          if (closeAfterResponse) closeServer();
        });
      };
      socket.on("data", (chunk) => {
        if (handled) return;
        message += chunk;
        if (Buffer.byteLength(message, "utf8") > LEASE_SESSION_MAX_MESSAGE_BYTES) {
          handled = true;
          respond({ ok: false, error: { code: "lease_session_message_too_large", message: "Lease session request is too large" } });
          return;
        }
        const newline = message.indexOf("\n");
        if (newline < 0) return;
        handled = true;
        try {
          const request = JSON.parse(message.slice(0, newline));
          if (request.leaseSessionId !== leaseSessionId) {
            throw new BatchStateError("Lease session ID does not match", "lease_session_mismatch");
          }
          const result = executeLeaseSessionOperation({ batchRoot, ownerToken, request });
          const terminal = ["finalize-assessment", "release"].includes(request.operation);
          respond({ ok: true, result }, terminal);
        } catch (error) {
          respond({ ok: false, error: serializedError(error) });
        }
        resetIdleTimer();
      });
      socket.on("error", () => {});
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(endpoint, resolve);
    });
    if (process.platform !== "win32") fs.chmodSync(endpoint, 0o600);
    const started = startAttempt({ batchRoot, ownerToken, executionUnitId });
    resetIdleTimer();
    process.send?.({
      type: "ready",
      leaseSessionId,
      started: compactStartedAttempt(started),
    });
    readySent = true;
    await new Promise((resolve) => server.once("close", resolve));
  } catch (error) {
    if (server?.listening) server.close();
    if (ownerToken && !readySent) {
      try {
        releaseLease({ batchRoot, ownerToken });
      } catch {}
    }
    process.send?.({ type: "error", error: serializedError(error) });
    throw error;
  } finally {
    clearTimeout(idleTimer);
    if (process.platform !== "win32") fs.rmSync(endpoint, { force: true });
  }
}

export function openLeaseSession({ batchRoot, invocationId, executionUnitId } = {}) {
  if (typeof invocationId !== "string" || !invocationId) {
    return Promise.reject(new BatchStateError("Lease invocation ID is required", "missing_option"));
  }
  if (typeof executionUnitId !== "string" || !executionUnitId) {
    return Promise.reject(new BatchStateError("First execution unit ID is required", "missing_option"));
  }
  const leaseSessionId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      fileURLToPath(import.meta.url),
      "__lease-worker",
      "--batch-root", path.resolve(batchRoot),
      "--invocation-id", invocationId,
      "--lease-session-id", leaseSessionId,
      "--execution-unit-id", executionUnitId,
    ], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new BatchStateError("Lease session worker did not become ready", "lease_session_timeout"));
    }, 15_000);
    const finish = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };
    child.once("message", (message) => finish(() => {
      child.disconnect();
      child.unref();
      if (message?.type === "ready") {
        resolve({ leaseSessionId, ...message.started });
      } else {
        reject(new BatchStateError(
          message?.error?.message ?? "Lease session worker failed",
          message?.error?.code ?? "lease_session_error",
        ));
      }
    }));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) => finish(() => reject(new BatchStateError(
      `Lease session worker exited before ready (${code})`,
      "lease_session_unavailable",
    ))));
  });
}

export function requestLeaseSession({ leaseSessionId, operation, executionUnitId, requestPath } = {}) {
  const endpoint = leaseSessionEndpoint(leaseSessionId);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let message = "";
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error instanceof BatchStateError ? error : new BatchStateError(
        `Lease session is unavailable: ${error.message}`,
        "lease_session_unavailable",
      ));
    };
    socket.setEncoding("utf8");
    socket.setTimeout(30_000, () => fail(new BatchStateError(
      "Lease session request timed out",
      "lease_session_timeout",
    )));
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ leaseSessionId, operation, executionUnitId, requestPath })}\n`);
    });
    socket.on("data", (chunk) => {
      message += chunk;
      if (Buffer.byteLength(message, "utf8") > LEASE_SESSION_MAX_MESSAGE_BYTES) {
        fail(new BatchStateError("Lease session response is too large", "lease_session_message_too_large"));
        return;
      }
      const newline = message.indexOf("\n");
      if (newline < 0 || settled) return;
      try {
        const response = JSON.parse(message.slice(0, newline));
        if (!response.ok) {
          throw new BatchStateError(response.error?.message ?? "Lease session operation failed", response.error?.code);
        }
        settled = true;
        socket.end();
        resolve(response.result);
      } catch (error) {
        fail(error);
      }
    });
    socket.once("error", fail);
    socket.once("end", () => {
      if (!settled) fail(new BatchStateError("Lease session ended without a response", "lease_session_unavailable"));
    });
  });
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    let result;
    if (command === "__lease-worker") {
      await runLeaseSessionWorker({
        batchRoot: optionValue("--batch-root"),
        invocationId: optionValue("--invocation-id"),
        leaseSessionId: optionValue("--lease-session-id"),
        executionUnitId: optionValue("--execution-unit-id"),
      });
    } else if (command === "open-session") {
      result = await openLeaseSession({
        batchRoot: optionValue("--batch-root"),
        invocationId: optionValue("--invocation-id"),
        executionUnitId: optionValue("--execution-unit-id"),
      });
    } else if (command === "session-start") {
      result = await requestLeaseSession({
        leaseSessionId: optionValue("--lease-session-id"),
        operation: "start",
        executionUnitId: optionValue("--execution-unit-id"),
      });
    } else if (command === "session-commit") {
      result = await requestLeaseSession({
        leaseSessionId: optionValue("--lease-session-id"),
        operation: "commit",
        requestPath: optionValue("--request"),
      });
    } else if (command === "session-finalize-assessment") {
      result = await requestLeaseSession({
        leaseSessionId: optionValue("--lease-session-id"),
        operation: "finalize-assessment",
      });
    } else if (command === "session-release") {
      result = await requestLeaseSession({
        leaseSessionId: optionValue("--lease-session-id"),
        operation: "release",
      });
    } else if (command === "initialize-assessment") {
      result = initializeAssessmentBatch({
        batchRoot: optionValue("--batch-root"),
        resolvedConfig: jsonDocument(optionValue("--resolved"), "inspected repositories"),
        selection: jsonDocument(optionValue("--selection"), "batch selection"),
        input: jsonDocument(optionValue("--input"), "assessment batch input"),
      });
    } else if (command === "start") {
      result = startAttempt({
        batchRoot: optionValue("--batch-root"),
        ownerToken: process.env.BATCH_OWNER_TOKEN,
        executionUnitId: optionValue("--execution-unit-id"),
        phase: optionValue("--phase") ?? "assessment",
        input: optionValue("--input")
          ? jsonDocument(optionValue("--input"), "attempt input")
          : undefined,
      });
    } else if (command === "publish") {
      result = publishAttemptResult({
        requestPath: optionValue("--request"),
        outcome: jsonDocument(optionValue("--outcome"), "attempt outcome"),
      });
    } else if (command === "commit") {
      result = commitAttempt({
        batchRoot: optionValue("--batch-root"),
        ownerToken: process.env.BATCH_OWNER_TOKEN,
        requestPath: optionValue("--request"),
      });
    } else if (command === "finalize-assessment") {
      result = finalizeAssessmentBatch({
        batchRoot: optionValue("--batch-root"),
        ownerToken: process.env.BATCH_OWNER_TOKEN,
      });
    } else {
      throw new BatchStateError(`Unknown command: ${command}`, "unknown_command");
    }
    if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code, message: error.message })}\n`);
    process.exitCode = 1;
  }
}
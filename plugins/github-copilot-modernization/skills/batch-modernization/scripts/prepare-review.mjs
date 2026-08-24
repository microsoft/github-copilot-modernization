#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectResolvedRepositories } from "./inspect-workspaces.mjs";
import { resolveReposFile } from "./resolve-repos.mjs";
import { defaultAssessmentDomains } from "../../assessment/scripts/assessment-catalog.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const batchAttemptScriptPath = path.join(scriptRoot, "batch-attempt.mjs");
const SUPPORTED_DOMAINS = new Set(["security", "cloud-readiness", "java-upgrade"]);
const SUPPORTED_COVERAGE = new Set(["issue-only", "full"]);

export class BatchReviewError extends Error {
  constructor(message, code = "batch_review_failed") {
    super(message);
    this.name = "BatchReviewError";
    this.code = code;
  }
}

function atomicWrite(filePath, content) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporaryPath, absolutePath);
}

function atomicWriteJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function validateDecisions({ domains, analysisCoverage, maxConcurrency }) {
  if (domains !== undefined && (!Array.isArray(domains)
      || domains.length === 0
      || new Set(domains).size !== domains.length
      || domains.some((domain) => !SUPPORTED_DOMAINS.has(domain)))) {
    throw new BatchReviewError("Review requires unique supported Assessment domains", "invalid_decisions");
  }
  if (!SUPPORTED_COVERAGE.has(analysisCoverage)) {
    throw new BatchReviewError("Review coverage must be issue-only or full", "invalid_decisions");
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 7) {
    throw new BatchReviewError("Review maxConcurrency must be between 1 and 7", "invalid_decisions");
  }
}

function optionalString(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new BatchReviewError(`${name} must be a non-empty string`, "invalid_decisions");
  }
  return value.trim();
}

function optionalStringArray(value, name) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)
      || value.length === 0
      || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new BatchReviewError(`${name} must be a non-empty string array`, "invalid_decisions");
  }
  const normalized = value.map((entry) => entry.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new BatchReviewError(`${name} must contain unique values`, "invalid_decisions");
  }
  return normalized;
}

function assessmentOptions(options) {
  if (options.enableContainerization !== undefined && typeof options.enableContainerization !== "boolean") {
    throw new BatchReviewError("enableContainerization must be a boolean", "invalid_decisions");
  }
  return Object.fromEntries(Object.entries({
    targetRuntime: optionalString(options.targetRuntime, "targetRuntime"),
    targetComputeServices: optionalStringArray(options.targetComputeServices, "targetComputeServices"),
    enableContainerization: options.enableContainerization,
    targetOS: optionalStringArray(options.targetOS, "targetOS"),
    minimumCveSeverity: optionalString(options.minimumCveSeverity, "minimumCveSeverity"),
    cveScanScope: optionalString(options.cveScanScope, "cveScanScope"),
  }).filter(([, value]) => value !== undefined));
}

function repositoryEntry(repository) {
  return {
    repoId: repository.repoId,
    name: repository.name,
    workspacePath: repository.workspacePath,
    executionUnitIds: repository.executionUnits.map((unit) => unit.executionUnitId),
    languages: [...new Set(repository.executionUnits.flatMap((unit) => unit.languages))],
    warnings: repository.warnings,
    errors: repository.errors,
  };
}

function markdownReview(review) {
  const lines = [
    "# Batch Assessment Review",
    "",
    `Status: ${review.status}`,
    "",
    "## Selection",
    "",
    ...review.selectedExecutionUnitIds.map((executionUnitId) => `- ${executionUnitId}`),
    "",
    "## Decisions",
    "",
    `- Domains: ${review.decisions.domains?.join(", ") ?? "language-specific defaults"}`,
    `- Coverage: ${review.decisions.analysisCoverage}`,
    `- Max concurrency: ${review.decisions.maxConcurrency}`,
    "- Repository scheduling: sequential",
    ...Object.entries(review.decisions)
      .filter(([name]) => !["domains", "analysisCoverage", "maxConcurrency", "repositoryScheduling"].includes(name))
      .map(([name, value]) => `- ${name}: ${JSON.stringify(value)}`),
    "",
    "## Preflight",
    "",
    `- Ready: ${review.groups.ready.length}`,
    `- Needs attention: ${review.groups.needsAttention.length}`,
    `- Clone required: ${review.groups.cloneRequired.length}`,
    `- Blocked: ${review.groups.blocked.length}`,
    `- Blocked execution units: ${review.blockedExecutionUnits.length}`,
    "",
  ];
  if (review.effectiveAssessments.length > 0) {
    lines.push("### Effective assessments", "");
    for (const assessment of review.effectiveAssessments) {
      lines.push(`- ${assessment.executionUnitId}: ${assessment.language}; ${assessment.domains.length > 0 ? assessment.domains.join(", ") : "dependency assessment"}`);
    }
    lines.push("");
  }
  if (review.blockedExecutionUnits.length > 0) {
    lines.push("### Blocked execution units", "");
    for (const unit of review.blockedExecutionUnits) {
      lines.push(`- ${unit.executionUnitId}: ${unit.languages.join(", ")} (${unit.reason})`);
    }
    lines.push("");
  }
  for (const [heading, entries] of [
    ["Ready", review.groups.ready],
    ["Needs attention", review.groups.needsAttention],
    ["Clone required", review.groups.cloneRequired],
    ["Blocked", review.groups.blocked],
  ]) {
    if (entries.length === 0) continue;
    lines.push(`### ${heading}`, "");
    for (const entry of entries) {
      const details = [...entry.warnings, ...entry.errors];
      lines.push(`- ${entry.repoId}${details.length > 0 ? `: ${details.join("; ")}` : ""}`);
    }
    lines.push("");
  }
  lines.push(`Result directory: ${review.batchRoot}`, "");
  return lines.join("\n");
}

export function formatReviewHandoff(review) {
  const fields = [
    review.status === "ready_for_approval" ? "BATCH_REVIEW_READY" : "BATCH_REVIEW_BLOCKED",
    `batchRoot: ${review.batchRoot}`,
    `reviewPath: ${review.reviewPath}`,
    `reviewMarkdownPath: ${review.reviewMarkdownPath}`,
    `reviewSha256: ${review.reviewSha256}`,
    `reviewMarkdownSha256: ${review.reviewMarkdownSha256}`,
    `inspectedReposPath: ${review.inspectedReposPath}`,
    `batchAttemptScriptPath: ${review.batchAttemptScriptPath}`,
    `configSha256: ${review.configSha256}`,
    `selectedExecutionUnitIds: ${JSON.stringify(review.selectedExecutionUnitIds)}`,
    `approvedNeedsAttention: ${JSON.stringify(review.approvedNeedsAttention)}`,
    ...(review.decisions.domains === undefined
      ? []
      : [`domains: ${JSON.stringify(review.decisions.domains)}`]),
    `effectiveAssessments: ${JSON.stringify(review.effectiveAssessments)}`,
    `blockedExecutionUnits: ${JSON.stringify(review.blockedExecutionUnits)}`,
    `analysisCoverage: ${review.decisions.analysisCoverage}`,
    `maxConcurrency: ${review.decisions.maxConcurrency}`,
      ...Object.entries(review.decisions)
        .filter(([name]) => !["domains", "analysisCoverage", "maxConcurrency", "repositoryScheduling"].includes(name))
        .map(([name, value]) => `${name}: ${JSON.stringify(value)}`),
  ];
  return `${review.markdown}\n${fields.join("\n")}\n`;
}

export function prepareBatchReview({
  configPath,
  launchRoot,
  allowedRoots = [],
  domains,
  analysisCoverage = "issue-only",
  maxConcurrency = 1,
  targetRuntime,
  targetComputeServices,
  enableContainerization,
  targetOS,
  minimumCveSeverity,
  cveScanScope,
  selectedExecutionUnitIds,
  batchId,
} = {}) {
  if (!path.isAbsolute(launchRoot ?? "") || !path.isAbsolute(configPath ?? "")) {
    throw new BatchReviewError("Review launch root and config path must be absolute", "invalid_path");
  }
  validateDecisions({ domains, analysisCoverage, maxConcurrency });
  const explicitOptions = assessmentOptions({
    targetRuntime,
    targetComputeServices,
    enableContainerization,
    targetOS,
    minimumCveSeverity,
    cveScanScope,
  });
  const absoluteLaunchRoot = path.resolve(launchRoot);
  const absoluteConfigPath = path.resolve(configPath);
  const resolved = resolveReposFile(absoluteConfigPath, { launchRoot: absoluteLaunchRoot });
  const authorizedRoots = allowedRoots.length > 0 ? allowedRoots : [absoluteLaunchRoot];
  const inspected = inspectResolvedRepositories(resolved, {
    allowedRoots: authorizedRoots.map((root) => path.resolve(root)),
  });
  const allUnits = inspected.repositories.flatMap((repository) =>
    repository.executionUnits.map((unit) => ({ repository, unit })));
  const eligible = allUnits.filter(({ repository }) => repository.preflightStatus !== "blocked");
  const requestedIds = selectedExecutionUnitIds?.length > 0
    ? selectedExecutionUnitIds
    : eligible.map(({ unit }) => unit.executionUnitId);
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new BatchReviewError("Review requires unique execution units", "invalid_selection");
  }
  const requested = requestedIds.map((executionUnitId) => {
    const matches = eligible.filter(({ unit }) => unit.executionUnitId === executionUnitId);
    if (matches.length !== 1) {
      throw new BatchReviewError(
        `Execution unit is not uniquely selectable: ${executionUnitId}`,
        "invalid_selection",
      );
    }
    return matches[0];
  });
  const blockedExecutionUnits = eligible
    .filter(({ unit }) => unit.languages.length > 1)
    .map(({ unit }) => ({
      executionUnitId: unit.executionUnitId,
      languages: unit.languages,
      reason: "mixed-language execution units are not supported",
    }));
  const selected = requested.filter(({ unit }) => unit.languages.length === 1);
  const selectedIds = selected.map(({ unit }) => unit.executionUnitId);
  const effectiveAssessments = selected.map(({ unit }) => ({
    executionUnitId: unit.executionUnitId,
    language: unit.languages[0],
    domains: domains ?? defaultAssessmentDomains(unit.languages[0]),
  }));

  const stableBatchId = batchId ?? `batch-review-${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(stableBatchId)) {
    throw new BatchReviewError("Review batch ID is invalid", "invalid_batch_id");
  }
  const batchesRoot = path.join(absoluteLaunchRoot, ".github", "modernize", "batches");
  const batchRoot = path.join(batchesRoot, stableBatchId);
  fs.mkdirSync(batchesRoot, { recursive: true });
  fs.mkdirSync(batchRoot, { recursive: false });
  const scratchRoot = path.join(batchRoot, "scratch");
  fs.mkdirSync(scratchRoot);
  const resolvedReposPath = path.join(scratchRoot, "resolved-repos.json");
  const inspectedReposPath = path.join(scratchRoot, "inspected-repos.json");
  const reviewPath = path.join(batchRoot, "review.json");
  const reviewMarkdownPath = path.join(batchRoot, "REVIEW.md");
  atomicWriteJson(resolvedReposPath, resolved);
  atomicWriteJson(inspectedReposPath, inspected);

  const cloneRequired = inspected.repositories.filter((repository) =>
    repository.warnings.includes("repository clone is required"));
  const groups = {
    ready: inspected.repositories.filter((repository) => repository.preflightStatus === "ready")
      .map(repositoryEntry),
    needsAttention: inspected.repositories.filter((repository) =>
      repository.preflightStatus === "needs_attention" && !cloneRequired.includes(repository))
      .map(repositoryEntry),
    cloneRequired: cloneRequired.map(repositoryEntry),
    blocked: inspected.repositories.filter((repository) => repository.preflightStatus === "blocked")
      .map(repositoryEntry),
  };
  const review = {
    schemaVersion: 1,
    status: selectedIds.length > 0 ? "ready_for_approval" : "blocked",
    batchId: stableBatchId,
    batchRoot,
    reviewPath,
    reviewMarkdownPath,
    batchAttemptScriptPath,
    launchRoot: absoluteLaunchRoot,
    resolvedReposPath,
    inspectedReposPath,
    configSha256: inspected.configSha256,
    selectedExecutionUnitIds: selectedIds,
    approvedNeedsAttention: selected
      .filter(({ repository }) => repository.preflightStatus === "needs_attention")
      .map(({ unit }) => unit.executionUnitId),
    decisions: {
      ...(domains === undefined ? {} : { domains }),
      analysisCoverage,
      maxConcurrency,
      ...explicitOptions,
    },
    repositoryScheduling: "sequential",
    apps: inspected.apps,
    groups,
    effectiveAssessments,
    blockedExecutionUnits,
  };
  review.markdown = markdownReview(review);
  atomicWriteJson(reviewPath, review);
  atomicWrite(reviewMarkdownPath, `${review.markdown}\n`);
  return {
    ...review,
    reviewSha256: fileSha256(reviewPath),
    reviewMarkdownSha256: fileSha256(reviewMarkdownPath),
  };
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function booleanOption(name) {
  const value = optionValue(name);
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BatchReviewError(`${name} must be true or false`, "invalid_decisions");
}

function optionValues(name) {
  return process.argv.flatMap((value, index) => {
    const candidate = process.argv[index + 1];
    return value === name && candidate && !candidate.startsWith("--") ? [candidate] : [];
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const domainValues = optionValues("--domain");
    const targetComputeServices = optionValues("--target-compute-service");
    const targetOS = optionValues("--target-os");
    const review = prepareBatchReview({
      configPath: optionValue("--config"),
      launchRoot: optionValue("--launch-root"),
      allowedRoots: optionValues("--allowed-root"),
      domains: domainValues.length > 0 ? domainValues : undefined,
      analysisCoverage: optionValue("--coverage") ?? "issue-only",
      maxConcurrency: Number(optionValue("--max-concurrency") ?? 1),
        targetRuntime: optionValue("--target-runtime"),
        targetComputeServices: targetComputeServices.length > 0 ? targetComputeServices : undefined,
        enableContainerization: booleanOption("--enable-containerization"),
        targetOS: targetOS.length > 0 ? targetOS : undefined,
        minimumCveSeverity: optionValue("--minimum-cve-severity"),
        cveScanScope: optionValue("--cve-scan-scope"),
      selectedExecutionUnitIds: optionValues("--execution-unit-id"),
      batchId: optionValue("--batch-id"),
    });
    process.stdout.write(formatReviewHandoff(review));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error.code ?? "batch_review_failed",
      message: error.message,
    })}\n`);
    process.exitCode = 1;
  }
}
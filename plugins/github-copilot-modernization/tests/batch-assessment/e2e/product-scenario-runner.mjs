#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  computeProductFixtureDigest,
  discoverNewBatchRoot,
  listBatchRoots,
  toolCallIdentifiesAgent,
  toolCallSelectsProductAgent,
  validateCancelledProductRun,
  validateCompletedProductRun,
  verifyProductSourceCanaries,
} from "./product-evidence.mjs";
import {
  acceptFormElicitation,
  acceptToolPermission,
  createProductFixture,
  invokeProductAgent,
  invokeProductAgentAcp,
  summarizeAcpTranscript,
  validateProductPackage,
} from "./product-probe.mjs";

const stageRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultEvidencePath = path.join(
  stageRoot,
  "evidence",
  `product-probe.${process.platform}-${process.arch}.json`,
);
const REQUIRED_PROBES = [
  "explicitBatchSuccess",
  "defaultConfigBatchSelection",
  "defaultConfigSingleSelection",
  "cancelBeforeApproval",
  "unsupportedBatchPlanning",
  "unsupportedBatchExecution",
  "naturalChildFailureContinuation",
];
const DIAGNOSTIC_PERMISSION_PROBES = [
  "missingResultContinuation",
  "partialAssessmentContinuation",
];
const BATCH_MODE_CHOICE = "Process repositories from repos.json";
const SINGLE_MODE_CHOICE = "Only process the current repository";

export class ProductHostBlocker extends Error {
  constructor(code, message, hostEvidence = {}) {
    super(message);
    this.name = "ProductHostBlocker";
    this.code = code;
    this.hostEvidence = hostEvidence;
  }
}

function resolveCopilotBinary(explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  const names = process.platform === "win32"
    ? ["copilot.exe", "copilot.bat", "copilot.cmd", "copilot"]
    : ["copilot"];
  const directories = String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const directory of directories) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Copilot CLI executable was not found on PATH; set COPILOT_CLI_PATH");
}

function copilotVersion(executable) {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unable to read Copilot CLI version: ${String(result.stderr ?? "").trim()}`);
  }
  return String(result.stdout).trim();
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function errorText(error) {
  return String(error?.stack ?? error?.message ?? error).slice(-4_000);
}

export function classifyProductHostBlocker(hostErrors = [], { fallback = true } = {}) {
  const text = hostErrors.join(" ").toLowerCase();
  if (!text) return null;
  if (/quota|payment|402/.test(text)) return "copilot_quota_exhausted";
  if (/authentication/.test(text)) return "copilot_authentication_failed";
  if (/model/.test(text) && /available|unavailable/.test(text)) return "copilot_model_unavailable";
  if (/rate limit/.test(text)) return "copilot_rate_limited";
  return fallback ? "copilot_host_error" : null;
}

function compactToolCalls(toolCalls = []) {
  return toolCalls.map((toolCall) => ({
    toolCallId: toolCall.toolCallId ?? null,
    title: toolCall.title ?? null,
    kind: toolCall.kind ?? null,
    status: toolCall.status ?? null,
  }));
}

function compactAcpEvidence(run = {}) {
  return {
    sessionId: run.session?.sessionId ?? null,
    durationMs: run.durationMs ?? null,
    stopReason: run.promptResult?.stopReason ?? null,
    permissionRequestCount: run.permissionRequests?.length ?? 0,
    permissionResponseCount: run.permissionResponses?.length ?? 0,
    permissionResponses: (run.permissionResponses ?? []).map(({ request, response }) => {
      const toolCall = request?.toolCall ?? request ?? {};
      return {
        toolCallId: toolCall.toolCallId ?? null,
        title: toolCall.title ?? null,
        kind: toolCall.kind ?? null,
        requestSha256: crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex"),
        response,
      };
    }),
    elicitationRequestCount: run.elicitationRequests?.length ?? 0,
    elicitationResponses: run.elicitationResponses ?? [],
    hostErrors: run.hostErrors ?? [],
    agentTextTail: String(run.agentText ?? "").slice(-2_000),
    toolCalls: compactToolCalls(run.toolCalls),
    stderrTail: String(run.stderr ?? "").slice(-2_000),
  };
}

export function createPermissionDenialController(target) {
  const normalizedTarget = String(target).toLowerCase();
  const denials = [];
  return {
    denials,
    handler(params) {
      const serialized = JSON.stringify(params);
      const toolCall = params?.toolCall ?? params ?? {};
      if (denials.length === 0 && toolCallIdentifiesAgent(toolCall, normalizedTarget)) {
        denials.push({
          target,
          toolCallId: toolCall.toolCallId ?? null,
          title: toolCall.title ?? null,
          kind: toolCall.kind ?? null,
          requestSha256: crypto.createHash("sha256").update(serialized).digest("hex"),
        });
        return { outcome: { outcome: "cancelled" } };
      }
      return acceptToolPermission(params, { persist: false });
    },
  };
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function throwForAcpHostError(run) {
  const code = classifyProductHostBlocker(run?.hostErrors);
  if (code) {
    throw new ProductHostBlocker(code, `Copilot product host blocked the probe: ${(run.hostErrors ?? []).join(", ")}`, compactAcpEvidence(run));
  }
}

async function invokeAcpChecked(options) {
  try {
    const run = await invokeProductAgentAcp(options);
    throwForAcpHostError(run);
    return run;
  } catch (error) {
    if (error instanceof ProductHostBlocker) throw error;
    const hostEvidence = error.acpEvidence ?? {};
    const code = classifyProductHostBlocker(hostEvidence.hostErrors)
      ?? classifyProductHostBlocker([error.message, error.stack].filter(Boolean), { fallback: false });
    if (code) {
      throw new ProductHostBlocker(code, `Copilot product host blocked the probe: ${(hostEvidence.hostErrors ?? []).join(", ")}`, compactAcpEvidence(hostEvidence));
    }
    throw error;
  }
}

function checkedRouteRun(options) {
  const run = invokeProductAgent(options);
  const host = summarizeAcpTranscript([], `${run.response}\n${run.stderr}`);
  const code = classifyProductHostBlocker(host.hostErrors)
    ?? classifyProductHostBlocker([run.response, run.stderr], { fallback: false });
  if (code) {
    throw new ProductHostBlocker(code, `Copilot product host blocked the route probe: ${host.hostErrors.join(", ")}`, {
      sessionId: run.sessionId,
      durationMs: run.durationMs,
      models: run.models,
      hostErrors: host.hostErrors,
      responseTail: run.response.slice(-2_000),
      stderrTail: run.stderr.slice(-2_000),
    });
  }
  assertCondition(run.exitCode === 0, `Product route exited ${run.exitCode}: ${run.stderr}`);
  return run;
}

function batchPrompt(fixture, {
  domains = ["cloud-readiness"],
  analysisCoverage = "issue-only",
} = {}) {
  return `Run an explicit Batch Assessment using repos.json at ${fixture.configPath} for both repositories. `
    + `Select ${domains.join(", ")}, ${analysisCoverage} coverage, and maxConcurrency 1. Show the Review and ask for `
    + "Start batch or Cancel. This prompt supplies decisions but is not approval; only a later structured "
    + "choice or a fresh user turn whose entire content is exactly Start batch is authoritative.";
}

function defaultConfigAssessmentPrompt() {
  return "Assess for cloud readiness with issue-only coverage and maxConcurrency 1. The workspace scope is intentionally "
    + "unspecified. Follow the product workspace-mode contract before any assessment; do not infer Single or Batch.";
}

function selectBatchModeThenStart(params) {
  const schemaText = JSON.stringify(params?.requestedSchema ?? {});
  return acceptFormElicitation(
    params,
    schemaText.includes(BATCH_MODE_CHOICE) ? BATCH_MODE_CHOICE : "Start batch",
  );
}

function createScenarioFixture(prefix, options) {
  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return createProductFixture(launchRoot, options);
}

function cleanupFixture(fixture, keepWorkspaces) {
  if (!keepWorkspaces) {
    try {
      fs.rmSync(fixture.launchRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  }
}

async function runApprovedBatch({
  copilotPath,
  model,
  keepWorkspaces,
  failureRepository,
  domains,
  analysisCoverage,
  deniedPermissionTarget,
  expectedStatuses,
  selectDefaultConfig = true,
  ambiguousScope = false,
}) {
  const fixture = createScenarioFixture(
    failureRepository ? "batch-assessment-child-failure" : "batch-assessment-success",
    failureRepository ? { bootstrapFailureRepository: failureRepository } : undefined,
  );
  const previousRoots = listBatchRoots(fixture.launchRoot);
  const fixtureSha256 = computeProductFixtureDigest(fixture);
  const permissionController = deniedPermissionTarget
    ? createPermissionDenialController(deniedPermissionTarget)
    : null;
  let run;
  try {
    run = await invokeAcpChecked({
      workspacePath: fixture.launchRoot,
      prompt: ambiguousScope
        ? defaultConfigAssessmentPrompt()
        : batchPrompt(fixture, { domains, analysisCoverage }),
      followUpPrompts: selectDefaultConfig
        ? [BATCH_MODE_CHOICE, "Start batch"]
        : ["Start batch"],
      model,
      copilotPath,
      elicitationHandler: selectDefaultConfig
        ? selectBatchModeThenStart
        : (params) => acceptFormElicitation(params, "Start batch"),
      allowAllTools: permissionController === null,
      permissionHandler: permissionController?.handler,
    });
    if (permissionController) {
      if (permissionController.denials.length === 0) {
        return {
          status: "not_supported",
          code: "acp_permission_events_unavailable",
          reason: `ACP emitted no permission request for ${deniedPermissionTarget}`,
          fixtureSha256,
          fixtureVariant: fixture.variant,
          workspaceRetained: keepWorkspaces,
          launchRoot: fixture.launchRoot,
          permissionDenials: [],
          host: compactAcpEvidence(run),
        };
      }
      assertCondition(permissionController.denials.length === 1, `Expected one ${deniedPermissionTarget} permission denial`);
    }
    const batchRoot = discoverNewBatchRoot(fixture.launchRoot, previousRoots);
    const approvalMode = run.elicitationResponses.length > 0 ? "structured" : "explicit-follow-up";
    if (failureRepository && !run.toolCalls.some((toolCall) => toolCallSelectsProductAgent(toolCall, "batch-assessment"))) {
      return {
        status: "not_supported",
        code: "natural_phase_failure_injection_unavailable",
        reason: "The repository condition was rejected before phase dispatch; no natural child failure was observed",
        fixtureSha256,
        fixtureVariant: fixture.variant,
        workspaceRetained: keepWorkspaces,
        launchRoot: fixture.launchRoot,
        permissionDenials: [],
        host: compactAcpEvidence(run),
      };
    }
    const validation = validateCompletedProductRun({
      fixture,
      batchRoot,
      acpRun: run,
      approvalMode,
      scopeMode: selectDefaultConfig ? "default-config" : "explicit",
    });
    const statuses = validation.attempts.map((attempt) => attempt.status);
    if (expectedStatuses) {
      assertCondition(
        JSON.stringify(statuses) === JSON.stringify(expectedStatuses),
        `Expected statuses ${expectedStatuses.join(", ")}; received ${statuses.join(", ")}`,
      );
    } else if (failureRepository) {
      assertCondition(
        statuses[0] === "failed" || statuses[0] === "protocol_error",
        `Natural child failure produced usable status ${statuses[0]}`,
      );
      assertCondition(
        statuses[1] === "completed" || statuses[1] === "completed_with_issues",
        `Coordinator did not continue to a usable second result: ${statuses[1]}`,
      );
    } else {
      assertCondition(
        statuses.every((status) => status === "completed" || status === "completed_with_issues"),
        `Success scenario statuses: ${statuses.join(", ")}`,
      );
    }
    return {
      status: "passed",
      fixtureSha256,
      fixtureVariant: fixture.variant,
      workspaceRetained: keepWorkspaces,
      launchRoot: fixture.launchRoot,
      permissionDenials: permissionController?.denials ?? [],
      host: compactAcpEvidence(run),
      validation,
    };
  } catch (error) {
    if (run && !error.acpEvidence) error.acpEvidence = run;
    error.fixtureEvidence = {
      fixtureSha256,
      fixtureVariant: fixture.variant,
      workspaceRetained: keepWorkspaces,
      launchRoot: fixture.launchRoot,
    };
    throw error;
  } finally {
    cleanupFixture(fixture, keepWorkspaces);
  }
}

async function runCancel({ copilotPath, model, keepWorkspaces }) {
  const fixture = createScenarioFixture("batch-assessment-cancel");
  const previousRoots = listBatchRoots(fixture.launchRoot);
  const fixtureSha256 = computeProductFixtureDigest(fixture);
  let run;
  try {
    run = await invokeAcpChecked({
      workspacePath: fixture.launchRoot,
      prompt: batchPrompt(fixture),
      followUpPrompts: [BATCH_MODE_CHOICE, "Cancel"],
      model,
      copilotPath,
      elicitationHandler: (params) => {
        const schemaText = JSON.stringify(params?.requestedSchema ?? {});
        return acceptFormElicitation(
          params,
          schemaText.includes(BATCH_MODE_CHOICE) ? BATCH_MODE_CHOICE : "Cancel",
        );
      },
    });
    const batchRoot = discoverNewBatchRoot(fixture.launchRoot, previousRoots);
    const approvalMode = run.elicitationResponses.length > 0 ? "structured" : "explicit-follow-up";
    return {
      status: "passed",
      fixtureSha256,
      workspaceRetained: keepWorkspaces,
      launchRoot: fixture.launchRoot,
      host: compactAcpEvidence(run),
      validation: validateCancelledProductRun({
        fixture,
        batchRoot,
        acpRun: run,
        approvalMode,
        scopeMode: "default-config",
      }),
    };
  } catch (error) {
    if (run && !error.acpEvidence) error.acpEvidence = run;
    error.fixtureEvidence = {
      fixtureSha256,
      workspaceRetained: keepWorkspaces,
      launchRoot: fixture.launchRoot,
    };
    throw error;
  } finally {
    cleanupFixture(fixture, keepWorkspaces);
  }
}

function runUnsupportedRoute({ action, copilotPath, model }) {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), `batch-assessment-${action}-`));
  try {
    const run = checkedRouteRun({
      workspacePath,
      copilotPath,
      model,
      prompt: `${action === "planning" ? "Plan changes" : "Execute modernization changes"} for multiple repositories `
        + "using repos.json in batch mode. Do not assess or modify anything; state whether this Batch Assessment action is available.",
    });
    assertCondition(
      /not (?:available|supported)|does not support|supports only Batch Assessment/i.test(run.response),
      `Product route did not reject Batch ${action}: ${run.response}`,
    );
    return {
      status: "passed",
      sessionId: run.sessionId,
      models: run.models,
      durationMs: run.durationMs,
      response: run.response,
    };
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
}

async function runDefaultConfigSingleSelection({ copilotPath, model, keepWorkspaces }) {
  const fixture = createScenarioFixture("batch-assessment-single-route");
  const fixtureSha256 = computeProductFixtureDigest(fixture);
  try {
    const run = await invokeAcpChecked({
      workspacePath: fixture.launchRoot,
      copilotPath,
      model,
      prompt: "Assess for cloud readiness. The workspace scope is intentionally unspecified. Follow the product "
        + "workspace-mode contract first. After a mode is selected, stop after naming the route; do not invoke a phase coordinator.",
      followUpPrompts: [SINGLE_MODE_CHOICE],
      elicitationHandler: (params) => acceptFormElicitation(params, SINGLE_MODE_CHOICE),
    });
    const probeCalls = (run.toolCalls ?? []).filter((toolCall) =>
      toolCallSelectsProductAgent(toolCall, "batch-mode-probe"));
    const reviewCalls = (run.toolCalls ?? []).filter((toolCall) =>
      toolCallSelectsProductAgent(toolCall, "batch-review"));
    const coordinatorCalls = (run.toolCalls ?? []).filter((toolCall) =>
      toolCallSelectsProductAgent(toolCall, "batch-coordinator"));
    assertCondition(probeCalls.length === 1, `Expected one exact batch-mode-probe call, found ${probeCalls.length}`);
    assertCondition(reviewCalls.length === 0, "Single selection unexpectedly invoked batch-review");
    assertCondition(coordinatorCalls.length === 0, "Single selection unexpectedly invoked batch-coordinator");
    if (run.elicitationResponses.length > 0) {
      const choices = run.elicitationResponses.flatMap(({ response }) =>
        Object.values(response?.content ?? {}).map(String));
      assertCondition(choices.includes(SINGLE_MODE_CHOICE), "Structured mode selection did not choose the current repository");
    } else {
      assertCondition(run.userPrompts?.length === 2, `Expected two explicit mode-selection turns, found ${run.userPrompts?.length ?? 0}`);
      assertCondition(run.userPrompts[1] === SINGLE_MODE_CHOICE, "Explicit Single selection was not exact");
    }
    assertCondition(listBatchRoots(fixture.launchRoot).length === 0, "Single selection created a batch Review");
    assertCondition(
      /single|assessment-coordinator/i.test(run.agentText),
      `Single selection did not identify the classic single-repository route: ${run.agentText}`,
    );
    const canaries = verifyProductSourceCanaries(fixture);
    assertCondition(canaries.valid, `Ambiguous route changed source canaries: ${canaries.changed.join(", ")}`);
    return {
      status: "passed",
      fixtureSha256,
      workspaceRetained: keepWorkspaces,
      launchRoot: fixture.launchRoot,
      host: compactAcpEvidence(run),
      sourceCanaries: canaries,
    };
  } finally {
    cleanupFixture(fixture, keepWorkspaces);
  }
}

export function finalProductProbeStatus(probes, failureMatrix) {
  if (Object.values(probes).some((probe) => probe?.status === "failed")) return "failed";
  if (Object.values(probes).some((probe) => probe?.status === "blocked")) return "blocked";
  if (REQUIRED_PROBES.some((name) => probes[name]?.status !== "passed")) return "incomplete";
  if (failureMatrix.childFailure?.productHostStatus !== "passed") return "incomplete";
  for (const name of DIAGNOSTIC_PERMISSION_PROBES) {
    if (!["passed", "not_supported"].includes(probes[name]?.status)) return "incomplete";
  }
  for (const [probeName, matrixName] of [
    ["missingResultContinuation", "missingResult"],
    ["partialAssessmentContinuation", "partialAssessment"],
  ]) {
    const probe = probes[probeName];
    const matrix = failureMatrix[matrixName];
    if (matrix?.controlPlaneStatus !== "passed") return "incomplete";
    const expectedHostStatus = probe.status === "passed" ? "passed" : "not_run";
    if (matrix.productHostStatus !== expectedHostStatus) return "incomplete";
  }
  return "passed";
}

export function inheritedUnsupportedProbe(name, probes) {
  if (name !== "partialAssessmentContinuation") return null;
  const missingResult = probes.missingResultContinuation;
  if (missingResult?.status !== "not_supported"
      || missingResult.code !== "acp_permission_events_unavailable") {
    return null;
  }
  return {
    status: "not_supported",
    code: "acp_permission_events_unavailable",
    reason: "The same ACP host emitted no permission events during the missing-result capability probe",
    inheritedFrom: "missingResultContinuation",
  };
}

export function reusableProbe(name, probe) {
  return probe?.status === "passed"
    || (DIAGNOSTIC_PERMISSION_PROBES.includes(name)
      && probe?.status === "not_supported"
      && probe?.code === "acp_permission_events_unavailable");
}

function resumableEvidence(outputPath, identity, resume) {
  if (!resume || !fs.existsSync(outputPath)) return null;
  const previous = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const matches = previous.schemaVersion === 2
    && previous.platform === identity.platform
    && previous.copilotVersion === identity.copilotVersion
    && previous.model === identity.model
    && previous.productPackage?.sha256 === identity.productPackage.sha256;
  return matches ? previous : null;
}

export async function runProductScenarioProbe({
  outputPath = defaultEvidencePath,
  copilotPath,
  model = "auto",
  resume = false,
  keepWorkspaces = false,
} = {}) {
  const executable = resolveCopilotBinary(copilotPath ?? process.env.COPILOT_CLI_PATH);
  const identity = {
    platform: `${process.platform}-${process.arch}`,
    copilotVersion: copilotVersion(executable),
    model,
    productPackage: validateProductPackage(),
  };
  const previous = resumableEvidence(outputPath, identity, resume);
  const previousProbes = previous?.probes ?? {};
  const evidence = {
    schemaVersion: 2,
    status: "running",
    scenario: "batch-assessment-product-host-e2e",
    generatedAt: new Date().toISOString(),
    platform: identity.platform,
    nodeVersion: process.version,
    copilotVersion: identity.copilotVersion,
    model,
    productPackage: identity.productPackage,
    probes: previousProbes,
    failureMatrix: {
      childFailure: {
        productHostStatus: previousProbes.naturalChildFailureContinuation?.status === "passed"
          ? "passed"
          : "not_run",
        mechanism: "fixture workspace blocks Assessment bootstrap without changing product code",
      },
      missingResult: {
        productHostStatus: previousProbes.missingResultContinuation?.status === "passed"
          ? "passed"
          : "not_run",
        controlPlaneStatus: "passed",
        evidence: "skills/batch-modernization/scripts/batch-attempt.test.mjs: missing result commits protocol_error",
        mechanism: "ACP cancels the first batch-assessment delegation, then grants later permissions once.",
      },
      partialAssessment: {
        productHostStatus: previousProbes.partialAssessmentContinuation?.status === "passed"
          ? "passed"
          : "not_run",
        controlPlaneStatus: "passed",
        evidence: "skills/batch-modernization/scripts/batch-attempt.test.mjs: mixed portfolio aggregates partial results",
        mechanism: "ACP cancels the first cwe-memory-safety child, then grants later permissions once.",
      },
    },
  };
  if (previous) evidence.resumedFrom = previous.generatedAt;
  atomicWriteJson(outputPath, evidence);

  const scenarios = [
    ["defaultConfigSingleSelection", () => runDefaultConfigSingleSelection({
      copilotPath: executable,
      model,
      keepWorkspaces,
    })],
    ["defaultConfigBatchSelection", () => runApprovedBatch({
      copilotPath: executable,
      model,
      keepWorkspaces,
      ambiguousScope: true,
    })],
    ["explicitBatchSuccess", () => runApprovedBatch({ copilotPath: executable, model, keepWorkspaces })],
    ["cancelBeforeApproval", () => runCancel({ copilotPath: executable, model, keepWorkspaces })],
    ["unsupportedBatchPlanning", () => runUnsupportedRoute({ action: "planning", copilotPath: executable, model })],
    ["unsupportedBatchExecution", () => runUnsupportedRoute({ action: "execution", copilotPath: executable, model })],
    ["naturalChildFailureContinuation", () => runApprovedBatch({
      copilotPath: executable,
      model,
      keepWorkspaces,
      failureRepository: "alpha-service",
    })],
    ["missingResultContinuation", () => runApprovedBatch({
      copilotPath: executable,
      model,
      keepWorkspaces,
      deniedPermissionTarget: "batch-assessment",
      expectedStatuses: ["protocol_error", "completed"],
    })],
    ["partialAssessmentContinuation", () => runApprovedBatch({
      copilotPath: executable,
      model,
      keepWorkspaces,
      domains: ["security"],
      analysisCoverage: "issue-only",
      deniedPermissionTarget: "cwe-memory-safety",
      expectedStatuses: ["completed_with_issues", "completed"],
    })],
  ];
  let hostBlocker = null;
  for (const [name, execute] of scenarios) {
    if (reusableProbe(name, evidence.probes[name])) continue;
    const inherited = inheritedUnsupportedProbe(name, evidence.probes);
    if (inherited) {
      evidence.probes[name] = inherited;
      atomicWriteJson(outputPath, evidence);
      continue;
    }
    if (hostBlocker) {
      evidence.probes[name] = { status: "not_run", reason: `Blocked by ${hostBlocker.code}` };
      continue;
    }
    try {
      evidence.probes[name] = await execute();
      if (name === "naturalChildFailureContinuation" && evidence.probes[name].status === "passed") {
        evidence.failureMatrix.childFailure.productHostStatus = "passed";
      }
      if (name === "missingResultContinuation" && evidence.probes[name].status === "passed") {
        evidence.failureMatrix.missingResult.productHostStatus = "passed";
      }
      if (name === "partialAssessmentContinuation" && evidence.probes[name].status === "passed") {
        evidence.failureMatrix.partialAssessment.productHostStatus = "passed";
      }
    } catch (error) {
      if (error instanceof ProductHostBlocker) {
        hostBlocker = error;
        evidence.probes[name] = {
          status: "blocked",
          code: error.code,
          message: error.message,
          host: error.hostEvidence,
        };
      } else {
        evidence.probes[name] = {
          status: "failed",
          error: errorText(error),
          ...(error.fixtureEvidence ?? {}),
          ...(error.acpEvidence ? { host: compactAcpEvidence(error.acpEvidence) } : {}),
        };
      }
    }
    atomicWriteJson(outputPath, evidence);
  }
  if (hostBlocker) {
    evidence.blocker = { code: hostBlocker.code, message: hostBlocker.message };
  }
  evidence.status = finalProductProbeStatus(evidence.probes, evidence.failureMatrix);
  evidence.completedAt = new Date().toISOString();
  atomicWriteJson(outputPath, evidence);
  return evidence;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outputPath = path.resolve(optionValue("--output") ?? defaultEvidencePath);
    const evidence = await runProductScenarioProbe({
      outputPath,
      copilotPath: optionValue("--copilot"),
      model: optionValue("--model") ?? "auto",
      resume: process.argv.includes("--resume"),
      keepWorkspaces: process.argv.includes("--keep-workspaces"),
    });
    console.log(JSON.stringify({ status: evidence.status, outputPath }));
    if (evidence.status === "failed") process.exitCode = 1;
    if (evidence.status === "blocked" || evidence.status === "incomplete") process.exitCode = 2;
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
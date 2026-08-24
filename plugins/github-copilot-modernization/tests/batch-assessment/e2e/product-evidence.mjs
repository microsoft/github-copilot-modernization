import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { directoryDigest } from "../../../skills/batch-modernization/scripts/batch-assessment-report.mjs";

const TERMINAL_BATCH_STATUSES = new Set(["completed", "completed_with_issues", "failed"]);
const SUCCESS_UNIT_STATUSES = new Set(["completed", "completed_with_issues"]);
const TERMINAL_UNIT_STATUSES = new Set([
  ...SUCCESS_UNIT_STATUSES,
  "protocol_error",
  "failed",
  "interrupted",
]);
const UUID_PATTERN = /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[1-5][A-Fa-f0-9]{3}-[89ABab][A-Fa-f0-9]{3}-[A-Fa-f0-9]{12}$/;
const PRODUCT_AGENT_PREFIX = "github-copilot-modernization:";
const FACT_SKILL_IDS = [
  "architecture-diagram",
  "dependency-map",
  "api-service-contracts",
  "data-architecture",
  "configuration-inventory",
  "business-workflows",
];
const SECURITY_SKILL_IDS = [
  "cve-known-vulnerabilities",
  "cwe-code-quality",
  "cwe-concurrency-synchronization",
  "cwe-credentials-secrets",
  "cwe-file-path-security",
  "cwe-injection-attacks",
  "cwe-memory-safety",
];

export class ProductEvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductEvidenceError";
  }
}

function requireEvidence(condition, message) {
  if (!condition) throw new ProductEvidenceError(message);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new ProductEvidenceError(`Unable to read ${label}: ${error.message}`);
  }
}

function readEvents(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    throw new ProductEvidenceError(`Unable to read batch events: ${error.message}`);
  }
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fileDigest(filePath) {
  return `sha256:${fileSha256(filePath)}`;
}

function fileEvidence(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: path.resolve(filePath),
    bytes: stat.size,
    sha256: fileSha256(filePath),
  };
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function timestamp(value, label) {
  const parsed = Date.parse(value);
  requireEvidence(Number.isFinite(parsed), `${label} is not an ISO timestamp`);
  return parsed;
}

function inputSelectsAgent(value, normalizedAgentName) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => inputSelectsAgent(entry, normalizedAgentName));
  }
  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    if (["agent", "agenttype", "agentname", "customagent", "customagentname"].includes(normalizedKey)) {
      return String(entry).toLowerCase() === normalizedAgentName;
    }
    return inputSelectsAgent(entry, normalizedAgentName);
  });
}

export function toolCallIdentifiesAgent(toolCall, agentName) {
  const normalizedAgentName = String(agentName).toLowerCase();
  return String(toolCall?.title ?? "").toLowerCase().includes(normalizedAgentName)
    || inputSelectsAgent(toolCall?.rawInput, normalizedAgentName);
}

export function hasToolEvidence(run, agentName) {
  return (run?.toolCalls ?? []).some((toolCall) => toolCallIdentifiesAgent(toolCall, agentName));
}

function inputSelectsExactAgentType(value, expectedAgentType) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => inputSelectsExactAgentType(entry, expectedAgentType));
  }
  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    if (normalizedKey === "agenttype") {
      return String(entry).toLowerCase() === expectedAgentType;
    }
    return inputSelectsExactAgentType(entry, expectedAgentType);
  });
}

export function toolCallSelectsProductAgent(toolCall, agentName) {
  return inputSelectsExactAgentType(
    toolCall?.rawInput,
    `${PRODUCT_AGENT_PREFIX}${String(agentName).toLowerCase()}`,
  );
}

function productAgentCalls(run, agentName) {
  return (run?.toolCalls ?? []).map((toolCall, index) => ({ toolCall, index }))
    .filter(({ toolCall }) => toolCallSelectsProductAgent(toolCall, agentName));
}

function completedProductAgentCalls(run, agentName) {
  return productAgentCalls(run, agentName)
    .filter(({ toolCall }) => toolCall.status === "completed");
}

function acceptedChoices(run) {
  const responses = run?.elicitationResponses ?? [];
  return responses.map(({ response }, index) => {
    requireEvidence(response?.action === "accept", `Structured response ${index + 1} was not accepted`);
    return Object.values(response.content ?? {}).map(String).join(" ");
  });
}

function validateHostRun(run) {
  requireEvidence(run && typeof run === "object", "ACP run evidence is missing");
  requireEvidence((run.hostErrors ?? []).length === 0, `ACP host failed: ${(run.hostErrors ?? []).join(", ")}`);
  const promptResults = run.promptResults?.length > 0
    ? run.promptResults
    : (run.promptResult ? [run.promptResult] : []);
  requireEvidence(promptResults.length > 0, "ACP prompt results are missing");
  requireEvidence(
    promptResults.every((result) => result?.stopReason === "end_turn"),
    "ACP prompt did not reach end_turn",
  );
}

function validateStartApproval(run, approvalMode, scopeMode) {
  if (approvalMode === "structured") {
    const choices = acceptedChoices(run);
    requireEvidence(choices.some((choice) => /start batch/i.test(choice)), "Structured response did not select Start batch");
    if (scopeMode === "default-config") {
      requireEvidence(
        choices.some((choice) => /process repositories from repos\.json/i.test(choice)),
        "Structured response did not select configured repositories",
      );
    }
  } else if (approvalMode === "explicit-follow-up") {
    requireEvidence((run.elicitationRequests ?? []).length === 0, "Explicit follow-up mode received an elicitation request");
    requireEvidence((run.elicitationResponses ?? []).length === 0, "Explicit follow-up mode received an elicitation response");
    const expectedTurns = scopeMode === "default-config" ? 3 : 2;
    requireEvidence(run.userPrompts?.length === expectedTurns, `Expected ${expectedTurns} explicit user turns, found ${run.userPrompts?.length ?? 0}`);
    requireEvidence(run.promptResults?.length === expectedTurns, `Expected ${expectedTurns} ACP prompt results, found ${run.promptResults?.length ?? 0}`);
    requireEvidence(run.userPrompts[0] !== "Start batch", "Initial Review request was itself Start batch");
    if (scopeMode === "default-config") {
      requireEvidence(
        run.userPrompts[1] === "Process repositories from repos.json",
        "Second user turn did not select configured repositories exactly",
      );
    }
    requireEvidence(run.userPrompts.at(-1) === "Start batch", "Final user turn was not exactly Start batch");
  } else {
    throw new ProductEvidenceError(`Unsupported approval evidence mode: ${approvalMode}`);
  }
  return {
    mode: approvalMode,
    scopeMode,
    userPrompts: [...(run.userPrompts ?? [])],
    promptStopReasons: (run.promptResults ?? [run.promptResult]).filter(Boolean).map((result) => result.stopReason),
    elicitationCount: run.elicitationRequests?.length ?? 0,
  };
}

function validateProductAgentOrder(run, repositoryCount, approvalMode, scopeMode) {
  const probeCalls = completedProductAgentCalls(run, "batch-mode-probe");
  const reviewCalls = productAgentCalls(run, "batch-review");
  const coordinatorCalls = productAgentCalls(run, "batch-coordinator");
  const assessmentCalls = productAgentCalls(run, "batch-assessment");
  requireEvidence(reviewCalls.length === 1, `Expected one exact batch-review agent call, found ${reviewCalls.length}`);
  requireEvidence(coordinatorCalls.length === 1, `Expected one exact batch-coordinator agent call, found ${coordinatorCalls.length}`);
  requireEvidence(
    assessmentCalls.length === repositoryCount,
    `Expected ${repositoryCount} exact batch-assessment agent calls, found ${assessmentCalls.length}`,
  );
  requireEvidence(
    probeCalls.length === 1,
    `Expected one exact batch-mode-probe call, found ${probeCalls.length}`,
  );
  requireEvidence(probeCalls[0].index < reviewCalls[0].index, "batch-review ran before the mandatory config probe");
  requireEvidence(reviewCalls[0].index < coordinatorCalls[0].index, "batch-coordinator ran before batch-review");
  requireEvidence(
    assessmentCalls.every(({ index }) => coordinatorCalls[0].index < index),
    "A batch-assessment call ran before batch-coordinator",
  );
}

function canaryPath(fixture, canaryName) {
  const [repositoryName, ...segments] = canaryName.split("/");
  const repository = fixture.repositories.find((candidate) => candidate.name === repositoryName);
  requireEvidence(repository, `Canary references unknown repository: ${canaryName}`);
  requireEvidence(segments.length > 0, `Canary has no repository-relative path: ${canaryName}`);
  return path.join(repository.path, ...segments);
}

export function verifyProductSourceCanaries(fixture) {
  const actual = {};
  const changed = [];
  for (const [canaryName, expectedDigest] of Object.entries(fixture.canaries ?? {})) {
    const filePath = canaryPath(fixture, canaryName);
    if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
      actual[canaryName] = null;
      changed.push(canaryName);
      continue;
    }
    actual[canaryName] = fileSha256(filePath);
    if (actual[canaryName] !== expectedDigest) changed.push(canaryName);
  }
  return { valid: changed.length === 0, changed, actual };
}

export function computeProductFixtureDigest(fixture) {
  const hash = crypto.createHash("sha256");
  hash.update("batch-assessment-product-fixture-v1\0");
  for (const canaryName of Object.keys(fixture.canaries ?? {}).sort()) {
    hash.update(canaryName);
    hash.update("\0");
    hash.update(fs.readFileSync(canaryPath(fixture, canaryName)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function listBatchRoots(launchRoot) {
  const batchesRoot = path.join(path.resolve(launchRoot), ".github", "modernize", "batches");
  if (!fs.existsSync(batchesRoot)) return [];
  return fs.readdirSync(batchesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(batchesRoot, entry.name))
    .sort();
}

export function discoverNewBatchRoot(launchRoot, previousRoots = []) {
  const previous = new Set(previousRoots.map((entry) => path.resolve(entry)));
  const created = listBatchRoots(launchRoot).filter((entry) =>
    !previous.has(path.resolve(entry))
    && fs.statSync(path.join(entry, "review.json"), { throwIfNoEntry: false })?.isFile());
  requireEvidence(created.length === 1, `Expected one new batch root, found ${created.length}`);
  return created[0];
}

function validateReviewRoot(fixture, batchRoot) {
  const expectedParent = path.join(path.resolve(fixture.launchRoot), ".github", "modernize", "batches");
  requireEvidence(isPathInside(expectedParent, batchRoot), "Batch root escapes the fixture batches directory");
  const requiredFiles = [
    "review.json",
    "REVIEW.md",
    path.join("scratch", "resolved-repos.json"),
    path.join("scratch", "inspected-repos.json"),
  ];
  for (const relativePath of requiredFiles) {
    requireEvidence(
      fs.statSync(path.join(batchRoot, relativePath), { throwIfNoEntry: false })?.isFile(),
      `Review artifact is missing: ${relativePath}`,
    );
  }
  const review = readJson(path.join(batchRoot, "review.json"), "batch review");
  requireEvidence(review.status === "ready_for_approval", "Review was not ready for approval");
  requireEvidence(review.batchRoot === path.resolve(batchRoot), "Review batchRoot does not match its directory");
  requireEvidence(path.isAbsolute(review.batchAttemptScriptPath ?? ""), "Review batchAttemptScriptPath is not absolute");
  requireEvidence(fs.statSync(review.batchAttemptScriptPath, { throwIfNoEntry: false })?.isFile(), "Review batchAttemptScriptPath is missing");
  requireEvidence(review.configSha256 && /^[a-f0-9]{64}$/.test(review.configSha256), "Review config digest is invalid");
  requireEvidence(
    review.selectedExecutionUnitIds?.length === fixture.repositories.length,
    "Review did not select every fixture repository",
  );
  return review;
}

export function validateCancelledProductRun({
  fixture,
  batchRoot,
  acpRun,
  approvalMode = "structured",
  scopeMode = "explicit",
} = {}) {
  validateHostRun(acpRun);
  if (approvalMode === "structured") {
    const choices = acceptedChoices(acpRun);
    requireEvidence(choices.some((choice) => /cancel/i.test(choice)), "Structured response did not select Cancel");
    if (scopeMode === "default-config") {
      requireEvidence(
        choices.some((choice) => /process repositories from repos\.json/i.test(choice)),
        "Structured response did not select configured repositories before Cancel",
      );
    }
  } else if (approvalMode === "explicit-follow-up") {
    requireEvidence((acpRun.elicitationRequests ?? []).length === 0, "Explicit Cancel received an elicitation request");
    requireEvidence((acpRun.elicitationResponses ?? []).length === 0, "Explicit Cancel received an elicitation response");
    const expectedTurns = scopeMode === "default-config" ? 3 : 2;
    requireEvidence(acpRun.userPrompts?.length === expectedTurns, `Expected ${expectedTurns} explicit Cancel turns, found ${acpRun.userPrompts?.length ?? 0}`);
    requireEvidence(acpRun.promptResults?.length === expectedTurns, `Expected ${expectedTurns} explicit Cancel results, found ${acpRun.promptResults?.length ?? 0}`);
    requireEvidence(acpRun.userPrompts[0] !== "Cancel", "Initial Review request was itself Cancel");
    if (scopeMode === "default-config") {
      requireEvidence(acpRun.userPrompts[1] === "Process repositories from repos.json", "Second user turn did not select configured repositories exactly");
    }
    requireEvidence(acpRun.userPrompts.at(-1) === "Cancel", "Final user turn was not exactly Cancel");
  } else {
    throw new ProductEvidenceError(`Unsupported cancel approval mode: ${approvalMode}`);
  }
  const probeCalls = completedProductAgentCalls(acpRun, "batch-mode-probe");
  const reviewCalls = productAgentCalls(acpRun, "batch-review");
  const coordinatorCalls = productAgentCalls(acpRun, "batch-coordinator");
  requireEvidence(
    probeCalls.length === (scopeMode === "default-config" ? 1 : 0),
    `Expected ${scopeMode === "default-config" ? 1 : 0} exact batch-mode-probe calls, found ${probeCalls.length}`,
  );
  requireEvidence(reviewCalls.length === 1, `Expected one exact batch-review call, found ${reviewCalls.length}`);
  requireEvidence(coordinatorCalls.length === 0, "Cancel unexpectedly invoked batch-coordinator");
  if (scopeMode === "default-config") {
    const orderedCalls = (acpRun.toolCalls ?? []);
    requireEvidence(
      orderedCalls.indexOf(probeCalls[0].toolCall) < orderedCalls.indexOf(reviewCalls[0].toolCall),
      "Cancel Review ran before scope selection",
    );
  }
  const review = validateReviewRoot(fixture, path.resolve(batchRoot));
  const forbidden = [
    "selection.json",
    "assessment-input.json",
    "manifest.json",
    "state.json",
    "events.jsonl",
    "lease.json",
    "attempts",
    "repos",
    "summary.json",
    "summary.md",
    "finalization.json",
  ];
  const unexpected = forbidden.filter((relativePath) => fs.existsSync(path.join(batchRoot, relativePath)));
  requireEvidence(unexpected.length === 0, `Cancel left approval-bearing artifacts: ${unexpected.join(", ")}`);
  const canaries = verifyProductSourceCanaries(fixture);
  requireEvidence(canaries.valid, `Cancel changed source canaries: ${canaries.changed.join(", ")}`);
  return {
    status: "passed",
    batchId: review.batchId,
    batchRoot: path.resolve(batchRoot),
    approvalMode,
    scopeMode,
    elicitationCount: acpRun.elicitationRequests?.length ?? 0,
    sourceCanaries: canaries,
    review: fileEvidence(path.join(batchRoot, "review.json")),
  };
}

function requireControlFiles(batchRoot) {
  for (const relativePath of [
    "review.json",
    "manifest.json",
    "state.json",
    "events.jsonl",
    "summary.json",
    "summary.md",
    "finalization.json",
  ]) {
    requireEvidence(
      fs.statSync(path.join(batchRoot, relativePath), { throwIfNoEntry: false })?.isFile(),
      `Batch control artifact is missing: ${relativePath}`,
    );
  }
  requireEvidence(!fs.existsSync(path.join(batchRoot, "lease.json")), "Finalized batch retained its lease");
}

function validateEventLog(events, batchId) {
  const eventIds = new Set();
  for (const [index, event] of events.entries()) {
    requireEvidence(event.sequence === index + 1, `Event sequence is not contiguous at ${index + 1}`);
    requireEvidence(event.batchId === batchId, `Event ${event.sequence} has the wrong batchId`);
    requireEvidence(UUID_PATTERN.test(event.eventId), `Event ${event.sequence} has an invalid eventId`);
    requireEvidence(!eventIds.has(event.eventId), `Event ${event.sequence} repeats an eventId`);
    eventIds.add(event.eventId);
    timestamp(event.at, `Event ${event.sequence} timestamp`);
  }
}

function expectedSummaryCounts(units) {
  return {
    total: units.length,
    completed: units.filter((unit) => unit.status === "completed").length,
    completedWithIssues: units.filter((unit) => unit.status === "completed_with_issues").length,
    failed: units.filter((unit) => ["protocol_error", "failed", "interrupted"].includes(unit.status)).length,
  };
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  return JSON.stringify([...new Set(actual)].sort()) === JSON.stringify([...new Set(expected)].sort());
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function reportPayload(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/<script type=["']application\/json["'] id=["']report-data["']>([\s\S]*?)<\/script>/i);
  requireEvidence(match, `Published HTML has no report-data payload: ${htmlPath}`);
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new ProductEvidenceError(`Published HTML report-data is malformed: ${error.message}`);
  }
}

function validatePublishedReport({ fixture, state, summary, finalization, attempts }) {
  const expectedParent = path.join(fixture.launchRoot, ".github", "modernize", "assessment");
  const reportRoot = path.resolve(finalization.reportDirectoryPath ?? "");
  const indexPath = path.resolve(finalization.reportIndexPath ?? "");
  const aggregatePath = path.resolve(finalization.aggregateReportPath ?? "");
  requireEvidence(path.dirname(reportRoot) === path.resolve(expectedParent), "Published report is outside the launch-root assessment directory");
  requireEvidence(/^reports-\d{14}$/.test(path.basename(reportRoot)), "Published report directory does not use the shared reports-timestamp convention");
  requireEvidence(indexPath === path.join(reportRoot, "index.html"), "Published report index path is not canonical");
  requireEvidence(aggregatePath === path.join(reportRoot, "aggregate-report.json"), "Published aggregate path is not canonical");
  requireEvidence(fs.statSync(indexPath, { throwIfNoEntry: false })?.isFile(), "Published report index is missing");
  requireEvidence(fs.statSync(aggregatePath, { throwIfNoEntry: false })?.isFile(), "Published aggregate report is missing");
  requireEvidence(directoryDigest(reportRoot) === finalization.reportDirectoryDigest, "Finalization report directory digest mismatch");
  requireEvidence(fileDigest(indexPath) === finalization.reportIndexDigest, "Finalization report index digest mismatch");
  requireEvidence(fileDigest(aggregatePath) === finalization.aggregateReportDigest, "Finalization aggregate report digest mismatch");
  requireEvidence(summary.reports?.directory === reportRoot, "Summary report directory mismatch");
  requireEvidence(summary.reports?.index === indexPath, "Summary report index mismatch");
  requireEvidence(summary.reports?.aggregate === aggregatePath, "Summary aggregate report mismatch");
  requireEvidence(summary.reports?.digest === finalization.reportDirectoryDigest, "Summary report digest mismatch");
  const aggregate = readJson(aggregatePath, "published aggregate report");
  requireEvidence(aggregate.producer === "GitHub Copilot Modernization Plugin", "Aggregate producer mismatch");
  requireEvidence(aggregate.platform === "copilot-cli-plugin", "Aggregate platform mismatch");
  requireEvidence(aggregate.metadata?.batchId === state.batchId, "Aggregate batch identity mismatch");
  requireEvidence(aggregate.metadata?.status === state.status, "Aggregate status mismatch");
  requireEvidence(Array.isArray(aggregate.projects), "Aggregate projects are missing");
  requireEvidence(aggregate.rules && typeof aggregate.rules === "object", "Aggregate rules are missing");
  const extension = aggregate.extensions?.["github-copilot-modernization"];
  requireEvidence(extension?.schema === "github-copilot-modernization/batch-assessment/v1", "Plugin aggregate extension is missing");
  requireEvidence(extension.batchId === state.batchId, "Aggregate extension batch identity mismatch");
  requireEvidence(extension.status === state.status, "Aggregate extension status mismatch");
  requireEvidence(extension.counts?.total === attempts.length, "Aggregate repository count mismatch");
  requireEvidence(extension.counts?.completed === summary.counts.completed, "Aggregate completed count mismatch");
  requireEvidence(extension.counts?.completedWithIssues === summary.counts.completedWithIssues, "Aggregate issue count mismatch");
  requireEvidence(extension.counts?.failed === summary.counts.failed, "Aggregate failed count mismatch");
  const expectedBySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const expectedByState = {};
  const expectedTopRecommendations = [];
  const expectedPlanningSupported = { supported: 0, unsupported: 0, unavailable: 0 };
  const repositoryReports = new Map((extension.repositories ?? []).map((repository) => [repository.executionUnitId, repository]));
  for (const attempt of attempts) {
    const repository = repositoryReports.get(attempt.executionUnitId);
    requireEvidence(repository, `Aggregate is missing ${attempt.executionUnitId}`);
    requireEvidence(repository.status === attempt.status, `${attempt.executionUnitId} aggregate status mismatch`);
    if (SUCCESS_UNIT_STATUSES.has(attempt.status)) {
      requireEvidence(repository.reports, `${attempt.executionUnitId} has no published report snapshot`);
      for (const [field, artifactName] of [["json", "report"], ["html", "html"]]) {
        const publishedPath = path.resolve(reportRoot, repository.reports[field]);
        requireEvidence(isPathInside(reportRoot, publishedPath), `${attempt.executionUnitId} published ${field} escapes the report root`);
        requireEvidence(fs.statSync(publishedPath, { throwIfNoEntry: false })?.isFile(), `${attempt.executionUnitId} published ${field} is missing`);
        const expectedDigest = `sha256:${attempt.artifacts[artifactName].sha256}`;
        requireEvidence(fileDigest(publishedPath) === expectedDigest, `${attempt.executionUnitId} published ${field} differs from its canonical artifact`);
        requireEvidence(repository.reports.digests[field] === expectedDigest, `${attempt.executionUnitId} published ${field} digest is not recorded`);
      }
      const payload = reportPayload(path.resolve(reportRoot, repository.reports.html));
      const reportConfig = payload.intent?.assessment_config ?? {};
      requireEvidence(sameJson(repository.assessmentConfig, reportConfig), `${attempt.executionUnitId} assessment config mismatch`);
      requireEvidence(sameJson(extension.assessmentConfig, reportConfig), "Aggregate assessment config mismatch");
      requireEvidence(sameJson(repository.findings.bySeverity, payload.counts.by_severity), `${attempt.executionUnitId} severity counts mismatch`);
      const sortedState = Object.fromEntries(Object.entries(payload.counts.by_state).sort(([left], [right]) => left.localeCompare(right)));
      requireEvidence(sameJson(repository.findings.byState, sortedState), `${attempt.executionUnitId} state counts mismatch`);
      for (const [severity, count] of Object.entries(payload.counts.by_severity)) {
        expectedBySeverity[severity] += count;
      }
      for (const [stateName, count] of Object.entries(payload.counts.by_state)) {
        expectedByState[stateName] = (expectedByState[stateName] ?? 0) + count;
      }
      const recommendation = {
        kind: payload.top_recommendation.kind,
        summary: payload.top_recommendation.summary,
        nextAction: payload.top_recommendation.next_action,
        prefilledPrompt: payload.top_recommendation.prefilled_prompt,
      };
      requireEvidence(sameJson(repository.topRecommendation, recommendation), `${attempt.executionUnitId} top recommendation mismatch`);
      expectedTopRecommendations.push({ identity: repository.identity, ...recommendation });
      const expectedPlanning = repository.language === "java" || repository.language === "dotnet";
      requireEvidence(repository.planningSupported === expectedPlanning, `${attempt.executionUnitId} planning support mismatch`);
      expectedPlanningSupported[expectedPlanning ? "supported" : "unsupported"] += 1;
    } else {
      requireEvidence(repository.reports === null, `${attempt.executionUnitId} failure unexpectedly has a report snapshot`);
      requireEvidence(repository.assessmentConfig === null, `${attempt.executionUnitId} failure has assessment config evidence`);
      requireEvidence(repository.topRecommendation === null, `${attempt.executionUnitId} failure has a top recommendation`);
      requireEvidence(repository.planningSupported === null, `${attempt.executionUnitId} failure has planning support evidence`);
      expectedPlanningSupported.unavailable += 1;
    }
  }
  const sortedExpectedState = Object.fromEntries(Object.entries(expectedByState).sort(([left], [right]) => left.localeCompare(right)));
  requireEvidence(sameJson(extension.counts.bySeverity, expectedBySeverity), "Aggregate severity counts mismatch");
  requireEvidence(sameJson(extension.counts.byState, sortedExpectedState), "Aggregate state counts mismatch");
  requireEvidence(sameJson(extension.topRecommendations, expectedTopRecommendations), "Aggregate top recommendations mismatch");
  requireEvidence(sameJson(extension.planningSupported, expectedPlanningSupported), "Aggregate planning support mismatch");
  requireEvidence(sameJson(summary.findings?.bySeverity, expectedBySeverity), "Summary severity counts mismatch");
  requireEvidence(sameJson(summary.findings?.byState, sortedExpectedState), "Summary state counts mismatch");
  requireEvidence(sameJson(summary.topRecommendations, expectedTopRecommendations), "Summary top recommendations mismatch");
  requireEvidence(sameJson(summary.planningSupported, expectedPlanningSupported), "Summary planning support mismatch");
  return {
    directory: { path: reportRoot, digest: finalization.reportDirectoryDigest },
    index: fileEvidence(indexPath),
    aggregate: fileEvidence(aggregatePath),
  };
}

function validateResultArtifacts(result, batchRoot, workspacePath, request) {
  const artifacts = {};
  const canonicalRoots = [batchRoot, workspacePath].map((root) => fs.realpathSync.native(root));
  const addArtifact = (name, artifactPath) => {
    requireEvidence(path.isAbsolute(artifactPath), `Result artifact ${name} is not absolute`);
    requireEvidence(fs.statSync(artifactPath, { throwIfNoEntry: false })?.isFile(), `Result artifact ${name} is missing`);
    const canonicalArtifact = fs.realpathSync.native(artifactPath);
    requireEvidence(
      canonicalRoots.some((root) => isPathInside(root, canonicalArtifact)),
      `Result artifact ${name} escapes the attempt roots`,
    );
    artifacts[name] = fileEvidence(canonicalArtifact);
  };
  for (const [name, artifactPath] of Object.entries(result.artifacts ?? {})) {
    addArtifact(name, artifactPath);
  }
  if (SUCCESS_UNIT_STATUSES.has(result.status)) {
    requireEvidence(result.evidence?.artifactValidation === "passed", "Successful result lacks passed artifact validation");
    requireEvidence(artifacts.report, "Successful Assessment has no report artifact");
    requireEvidence(artifacts.html, "Successful Assessment has no HTML artifact");
    const report = readJson(artifacts.report.path, "Assessment report");
    requireEvidence(report.version === "1.1.0", "Assessment report has an unsupported version");
    requireEvidence(report.metadata?.runId === request.runId, "Assessment report runId does not match request");
    requireEvidence(report.metadata?.language === request.language, "Assessment report language does not match request");
    requireEvidence(
      sameStringSet(report.metadata?.domains, request.decisions?.domains),
      "Assessment report domains do not match request",
    );
    for (const field of ["categories", "findings", "security"]) {
      requireEvidence(Array.isArray(report[field]), `Assessment report ${field} is not an array`);
    }
    requireEvidence(report.metadata?.totalFindings === report.findings.length, "Assessment report finding count is inconsistent");
    requireEvidence(artifacts.html.bytes > 10_000, "Assessment HTML artifact is incomplete");
    const html = fs.readFileSync(artifacts.html.path, "utf8");
    const payloadMatch = html.match(/<script type=["']application\/json["'] id=["']report-data["']>([\s\S]*?)<\/script>/i);
    requireEvidence(payloadMatch, "Assessment HTML has no report-data payload");
    let payload;
    try {
      payload = JSON.parse(payloadMatch[1]);
    } catch (error) {
      throw new ProductEvidenceError(`Assessment HTML report-data is invalid: ${error.message}`);
    }
    requireEvidence(payload.meta?.run_id === request.runId, "Assessment HTML run_id does not match request");
    if (request.decisions?.analysisCoverage === "full") {
      for (const skillId of FACT_SKILL_IDS) {
        addArtifact(`fact:${skillId}`, path.join(path.dirname(artifacts.report.path), "facts", `${skillId}.md`));
      }
    }
    if (request.decisions?.domains?.includes("security")) {
      const securityRoot = path.join(
        path.dirname(request.resultPath),
        "scratch",
        "engines",
        "security",
        "incoming",
      );
      for (const skillId of SECURITY_SKILL_IDS) {
        addArtifact(`security:${skillId}`, path.join(securityRoot, `${skillId}.json`));
      }
    }
    if (["java", "dotnet"].includes(request.language)
        && request.decisions?.domains?.some((domain) => domain !== "security")) {
      if (!artifacts.appcat) {
        const defaultAppcatPath = path.join(
          workspacePath,
          ".github",
          "modernize",
          ".memory",
          "runs",
          request.runId,
          "appcat",
          "report.json",
        );
        if (fs.statSync(defaultAppcatPath, { throwIfNoEntry: false })?.isFile()) {
          addArtifact("appcat", defaultAppcatPath);
        }
      }
      requireEvidence(artifacts.appcat, "AppCAT Assessment has no AppCAT artifact");
      const appcat = readJson(artifacts.appcat.path, "AppCAT report");
      requireEvidence(appcat && typeof appcat === "object" && !Array.isArray(appcat), "AppCAT report is not an object");
    }
  }
  return artifacts;
}

function matchingFixtureRepository(fixture, workspacePath) {
  const matches = fixture.repositories.filter(
    (repository) => path.resolve(repository.path) === path.resolve(workspacePath),
  );
  requireEvidence(matches.length === 1, `Attempt workspace is not a fixture repository: ${workspacePath}`);
  return matches[0];
}

function validateAttempt({ fixture, batchRoot, batchId, unit, events, summaryResult }) {
  requireEvidence(TERMINAL_UNIT_STATUSES.has(unit.status), `Execution unit is not terminal: ${unit.executionUnitId}`);
  requireEvidence(UUID_PATTERN.test(unit.invocationId), `Execution unit has an invalid invocationId: ${unit.executionUnitId}`);
  requireEvidence(unit.attempt === 1, `Execution unit did not use its first attempt: ${unit.executionUnitId}`);
  const startedAt = timestamp(unit.startedAt, `${unit.executionUnitId} startedAt`);
  const finishedAt = timestamp(unit.finishedAt, `${unit.executionUnitId} finishedAt`);
  requireEvidence(startedAt <= finishedAt, `${unit.executionUnitId} finished before it started`);

  const startedEvents = events.filter((event) => event.type === "attempt_started"
    && event.executionUnitId === unit.executionUnitId);
  const finishedEvents = events.filter((event) => event.type === "attempt_finished"
    && event.executionUnitId === unit.executionUnitId);
  requireEvidence(startedEvents.length === 1, `${unit.executionUnitId} has ${startedEvents.length} start events`);
  requireEvidence(finishedEvents.length === 1, `${unit.executionUnitId} has ${finishedEvents.length} finish events`);
  const startedEvent = startedEvents[0];
  const finishedEvent = finishedEvents[0];
  requireEvidence(startedEvent.invocationId === unit.invocationId, `${unit.executionUnitId} start event invocation mismatch`);
  requireEvidence(finishedEvent.invocationId === unit.invocationId, `${unit.executionUnitId} finish event invocation mismatch`);
  requireEvidence(startedEvent.sequence < finishedEvent.sequence, `${unit.executionUnitId} event order is invalid`);
  requireEvidence(timestamp(startedEvent.at, "attempt_started timestamp") >= startedAt, `${unit.executionUnitId} start event predates state`);
  requireEvidence(timestamp(finishedEvent.at, "attempt_finished timestamp") >= finishedAt, `${unit.executionUnitId} finish event predates state`);

  const requestPath = path.resolve(startedEvent.payload?.requestPath ?? "");
  const resultPath = path.resolve(startedEvent.payload?.resultPath ?? "");
  requireEvidence(isPathInside(path.join(batchRoot, "attempts"), requestPath), `${unit.executionUnitId} request escapes attempts`);
  requireEvidence(path.basename(requestPath) === "request.json", `${unit.executionUnitId} request path is invalid`);
  requireEvidence(path.basename(resultPath) === "result.json", `${unit.executionUnitId} result path is invalid`);
  requireEvidence(path.dirname(requestPath) === path.dirname(resultPath), `${unit.executionUnitId} request/result are not colocated`);
  requireEvidence(fs.statSync(requestPath, { throwIfNoEntry: false })?.isFile(), `${unit.executionUnitId} request is missing`);
  const request = readJson(requestPath, `${unit.executionUnitId} request`);
  for (const [field, expected] of Object.entries({
    batchId,
    invocationId: unit.invocationId,
    repoId: unit.repoId,
    executionUnitId: unit.executionUnitId,
    phase: "assessment",
    attempt: 1,
    mode: "batch-headless",
    phaseApproved: true,
    resultPath,
  })) {
    requireEvidence(request[field] === expected, `${unit.executionUnitId} request ${field} mismatch`);
  }
  requireEvidence(request.runId === `batch-${unit.invocationId.toLowerCase()}`, `${unit.executionUnitId} request runId mismatch`);
  requireEvidence(path.isAbsolute(request.assessmentCliPath ?? ""), `${unit.executionUnitId} request assessmentCliPath is not absolute`);
  requireEvidence(fs.statSync(request.assessmentCliPath, { throwIfNoEntry: false })?.isFile(), `${unit.executionUnitId} request assessmentCliPath is missing`);
  requireEvidence(
    ["java", "dotnet", "javascript", "typescript"].includes(request.language),
    `${unit.executionUnitId} request language is unsupported`,
  );
  matchingFixtureRepository(fixture, request.workspacePath);
  requireEvidence(unit.resultPath === resultPath, `${unit.executionUnitId} state resultPath mismatch`);

  let result = null;
  let artifacts = {};
  if (fs.existsSync(resultPath)) {
    result = readJson(resultPath, `${unit.executionUnitId} result`);
    for (const [field, expected] of Object.entries({
      batchId,
      invocationId: unit.invocationId,
      repoId: unit.repoId,
      executionUnitId: unit.executionUnitId,
      phase: "assessment",
      attempt: 1,
    })) {
      requireEvidence(result[field] === expected, `${unit.executionUnitId} result ${field} mismatch`);
    }
    const committedStatus = result.status === "skipped" ? "failed" : result.status;
    requireEvidence(unit.status === committedStatus, `${unit.executionUnitId} result/state status mismatch`);
    requireEvidence(timestamp(result.completedAt, `${unit.executionUnitId} completedAt`) <= finishedAt, `${unit.executionUnitId} result postdates commit`);
    artifacts = validateResultArtifacts(result, batchRoot, request.workspacePath, request);
  } else {
    requireEvidence(unit.status === "protocol_error", `${unit.executionUnitId} is missing a non-protocol-error result`);
  }

  if (SUCCESS_UNIT_STATUSES.has(unit.status)) {
    requireEvidence(fs.statSync(path.join(path.dirname(requestPath), "scratch"), { throwIfNoEntry: false })?.isDirectory(), `${unit.executionUnitId} scratch is missing`);
  }
  const repoStatePath = path.join(batchRoot, "repos", `${unit.repoId}.json`);
  const repoState = readJson(repoStatePath, `${unit.repoId} repository state`);
  const validation = repoState.validations?.[unit.executionUnitId];
  requireEvidence(validation, `${unit.executionUnitId} repository validation is missing`);
  requireEvidence(validation.status === (result?.status ?? "protocol_error"), `${unit.executionUnitId} repository validation status mismatch`);
  const validationPath = path.join(path.dirname(requestPath), "validation.json");
  const validationRecord = readJson(validationPath, `${unit.executionUnitId} validation record`);
  for (const [field, expected] of Object.entries({
    batchId,
    invocationId: unit.invocationId,
    repoId: unit.repoId,
    executionUnitId: unit.executionUnitId,
    phase: "assessment",
    attempt: 1,
    requestDigest: fileDigest(requestPath),
    resultDigest: result ? fileDigest(resultPath) : null,
  })) {
    requireEvidence(validationRecord[field] === expected, `${unit.executionUnitId} validation ${field} mismatch`);
  }
  requireEvidence(validationRecord.status === validation.status, `${unit.executionUnitId} validation record status mismatch`);
  requireEvidence(validationRecord.valid === validation.valid, `${unit.executionUnitId} validation record validity mismatch`);
  requireEvidence(
    JSON.stringify(validationRecord.artifacts) === JSON.stringify(validation.artifacts),
    `${unit.executionUnitId} validation record artifacts mismatch`,
  );
  requireEvidence(
    JSON.stringify(validationRecord.artifactDigests) === JSON.stringify(Object.fromEntries(
      Object.entries(artifacts).map(([name, artifact]) => [name, `sha256:${artifact.sha256}`]),
    )),
    `${unit.executionUnitId} validation artifact digest mismatch`,
  );
  requireEvidence(summaryResult?.status === unit.status, `${unit.executionUnitId} summary status mismatch`);
  for (const artifactName of Object.keys(artifacts)) {
    requireEvidence(
      path.resolve(summaryResult.artifacts?.[artifactName] ?? "") === path.resolve(artifacts[artifactName].path),
      `${unit.executionUnitId} summary artifact ${artifactName} mismatch`,
    );
  }

  return {
    repoId: unit.repoId,
    executionUnitId: unit.executionUnitId,
    invocationId: unit.invocationId,
    status: unit.status,
    startedAt: unit.startedAt,
    finishedAt: unit.finishedAt,
    startSequence: startedEvent.sequence,
    finishSequence: finishedEvent.sequence,
    request: fileEvidence(requestPath),
    result: result ? fileEvidence(resultPath) : null,
    validation: fileEvidence(validationPath),
    scratchPath: path.join(path.dirname(requestPath), "scratch"),
    artifacts,
  };
}

export function validateCompletedProductRun({
  fixture,
  batchRoot,
  acpRun,
  approvalMode = "structured",
  scopeMode = "explicit",
} = {}) {
  validateHostRun(acpRun);
  const approval = validateStartApproval(acpRun, approvalMode, scopeMode);
  validateProductAgentOrder(acpRun, fixture.repositories.length, approvalMode, scopeMode);
  const root = path.resolve(batchRoot);
  validateReviewRoot(fixture, root);
  requireControlFiles(root);
  const manifest = readJson(path.join(root, "manifest.json"), "batch manifest");
  const state = readJson(path.join(root, "state.json"), "batch state");
  const summary = readJson(path.join(root, "summary.json"), "batch summary");
  const finalization = readJson(path.join(root, "finalization.json"), "Assessment finalization journal");
  const events = readEvents(path.join(root, "events.jsonl"));
  requireEvidence(manifest.batchId === state.batchId && state.batchId === summary.batchId, "Batch identity differs across control artifacts");
  requireEvidence(manifest.action === "assessment" && manifest.executionMode === "local", "Manifest is outside the Batch Assessment boundary");
  requireEvidence(manifest.assessment?.phaseApproved === true, "Manifest lacks approved Assessment input");
  requireEvidence(manifest.assessment?.decisions?.maxConcurrency === 1, "Manifest does not enforce maxConcurrency 1");
  requireEvidence(TERMINAL_BATCH_STATUSES.has(state.status), `Batch state is not terminal: ${state.status}`);
  requireEvidence(summary.status === state.status, "Summary status does not match state");
  requireEvidence(finalization.batchId === state.batchId, "Finalization batch identity mismatch");
  requireEvidence(finalization.status === state.status, "Finalization status does not match state");
  requireEvidence(finalization.releaseReady === true && finalization.released === true, "Finalization did not release the lease");
  requireEvidence(finalization.summaryJsonDigest === fileDigest(path.join(root, "summary.json")), "Finalization summary JSON digest mismatch");
  requireEvidence(finalization.summaryMarkdownDigest === fileDigest(path.join(root, "summary.md")), "Finalization summary Markdown digest mismatch");
  requireEvidence(state.executionUnits?.length === fixture.repositories.length, "Batch state does not contain both fixture repositories");
  requireEvidence(
    manifest.selectedExecutionUnitIds?.length === state.executionUnits.length,
    "Manifest selection does not match state units",
  );
  validateEventLog(events, state.batchId);
  const completedEvents = events.filter((event) => event.type === "batch_completed");
  requireEvidence(completedEvents.length === 1, `Expected one batch_completed event, found ${completedEvents.length}`);
  const summaryResults = new Map((summary.results ?? []).map((result) => [result.executionUnitId, result]));
  const attempts = state.executionUnits.map((unit) => validateAttempt({
    fixture,
    batchRoot: root,
    batchId: state.batchId,
    unit,
    events,
    summaryResult: summaryResults.get(unit.executionUnitId),
  }));
  requireEvidence(new Set(attempts.map((attempt) => attempt.invocationId)).size === attempts.length, "Attempts reused an invocationId");
  for (let index = 1; index < attempts.length; index += 1) {
    const previous = attempts[index - 1];
    const current = attempts[index];
    requireEvidence(
      timestamp(previous.finishedAt, `${previous.executionUnitId} finishedAt`) <= timestamp(current.startedAt, `${current.executionUnitId} startedAt`),
      `${current.executionUnitId} started before ${previous.executionUnitId} finished`,
    );
    requireEvidence(previous.finishSequence < current.startSequence, "Attempt events are not strictly sequential");
  }
  requireEvidence(
    JSON.stringify(summary.counts) === JSON.stringify(expectedSummaryCounts(state.executionUnits)),
    "Summary counts do not match terminal state",
  );
  const userReport = validatePublishedReport({ fixture, state, summary, finalization, attempts });
  const canaries = verifyProductSourceCanaries(fixture);
  requireEvidence(canaries.valid, `Assessment changed source canaries: ${canaries.changed.join(", ")}`);
  return {
    status: "passed",
    batchId: state.batchId,
    batchRoot: root,
    batchStatus: state.status,
    elicitationCount: acpRun.elicitationRequests?.length ?? 0,
    approval,
    sequential: true,
    sourceCanaries: canaries,
    attempts,
    userReport,
    controlArtifacts: {
      manifest: fileEvidence(path.join(root, "manifest.json")),
      state: fileEvidence(path.join(root, "state.json")),
      events: fileEvidence(path.join(root, "events.jsonl")),
      summary: fileEvidence(path.join(root, "summary.json")),
      finalization: fileEvidence(path.join(root, "finalization.json")),
    },
  };
}
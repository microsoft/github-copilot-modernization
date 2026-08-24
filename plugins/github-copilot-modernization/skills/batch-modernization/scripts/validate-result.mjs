import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { assertSafePersistedValue } from "./batch-state.mjs";
import { canonicalPath, isPathInside } from "./inspect-workspaces.mjs";
import { validateSchema } from "./schema-validator.mjs";
import {
  FACT_SKILL_IDS,
  SECURITY_SKILL_IDS,
} from "../../assessment/scripts/assessment-catalog.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(scriptRoot, "..", "schemas", "attempt-result.schema.json");
const compatibilitySchemaPath = path.resolve(scriptRoot, "..", "schemas", "compatibility-report.v1.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const compatibilitySchema = JSON.parse(fs.readFileSync(compatibilitySchemaPath, "utf8"));
const SUCCESS_STATUSES = new Set(["completed", "completed_with_issues"]);
const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "skipped", "not_applicable"]);
const SUCCESS_CRITERIA_STATUSES = new Set(["passed", "exempt", "not_applicable"]);
const SECURITY_ENTRY_STATUSES = new Set(["FOUND", "NOT_FOUND"]);
const SECURITY_TASK_STATUSES = new Set(["success", "succeeded", "completed", "ok", "not_applicable"]);
const MINIMUM_HTML_BYTES = 10_000;
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const ASSESSMENT_CONFIG_FIELDS = [
  "targetRuntime",
  "targetComputeServices",
  "enableContainerization",
  "targetOS",
  "minimumCveSeverity",
  "cveScanScope",
];

function normalizedAssessmentConfig(value = {}) {
  return Object.fromEntries(ASSESSMENT_CONFIG_FIELDS
    .filter((name) => value[name] !== undefined)
    .map((name) => [name, value[name]]));
}

function readJsonArtifact(filePath, label, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateIdentity(result, expected, errors) {
  for (const field of [
    "batchId",
    "invocationId",
    "repoId",
    "executionUnitId",
    "phase",
    "attempt",
  ]) {
    if (expected[field] !== undefined && result[field] !== expected[field]) {
      errors.push(`${field} does not match the expected attempt`);
    }
  }
}

function resolveArtifactPaths(result, { batchRoot, workspacePath }, errors) {
  const roots = [];
  for (const [label, rootPath] of [["batchRoot", batchRoot], ["workspacePath", workspacePath]]) {
    try {
      roots.push(canonicalPath(rootPath));
    } catch (error) {
      errors.push(`${label} is unavailable: ${error.message}`);
    }
  }
  const artifacts = {};
  for (const [name, artifactPath] of Object.entries(result.artifacts ?? {})) {
    if (!path.isAbsolute(artifactPath)) {
      errors.push(`artifact ${name} must use an absolute path`);
      continue;
    }
    if (!fs.existsSync(artifactPath)) {
      errors.push(`artifact ${name} does not exist`);
      continue;
    }
    let canonicalArtifact;
    try {
      canonicalArtifact = canonicalPath(artifactPath);
    } catch (error) {
      errors.push(`artifact ${name} cannot be resolved: ${error.message}`);
      continue;
    }
    if (!fs.statSync(canonicalArtifact).isFile()) {
      errors.push(`artifact ${name} must be a file`);
      continue;
    }
    if (!roots.some((root) => isPathInside(root, canonicalArtifact))) {
      errors.push(`artifact ${name} escapes the batch and workspace roots`);
      continue;
    }
    artifacts[name] = canonicalArtifact;
  }
  return artifacts;
}

function requireArtifact(artifacts, name, errors) {
  if (!artifacts[name]) errors.push(`required artifact ${name} is missing or invalid`);
  return artifacts[name];
}

function reportIdForRunId(runId) {
  const raw = String(runId);
  const timestampParts = raw.match(/\d+/g) ?? [];
  const timestamp = timestampParts.join("").slice(0, 14);
  if (/^\d{14}$/.test(timestamp)) return timestamp;
  if (/^\d+$/.test(raw)) return raw;
  return raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  const actualValues = [...new Set(actual)].sort();
  const expectedValues = [...new Set(expected)].sort();
  return JSON.stringify(actualValues) === JSON.stringify(expectedValues);
}

function countBucketTotal(value, label, errors, requiredKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`assessment HTML ${label} must be an object`);
    return null;
  }
  const keys = Object.keys(value);
  if (requiredKeys && !isDeepStrictEqual([...keys].sort(), [...requiredKeys].sort())) {
    errors.push(`assessment HTML ${label} must contain exactly ${requiredKeys.join(", ")}`);
    return null;
  }
  if (keys.some((key) => !key || !Number.isInteger(value[key]) || value[key] < 0)) {
    errors.push(`assessment HTML ${label} must contain non-negative integer counts`);
    return null;
  }
  return keys.reduce((total, key) => total + value[key], 0);
}

function validateTopRecommendation(value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.kind !== "string" || !value.kind
      || typeof value.summary !== "string" || !value.summary
      || ![null, "string"].includes(value.next_action === null ? null : typeof value.next_action)
      || ![null, "string"].includes(value.prefilled_prompt === null ? null : typeof value.prefilled_prompt)) {
    errors.push("assessment HTML top_recommendation is malformed");
  }
}

function validateAssessmentPolicy(policy, errors) {
  if (!policy || typeof policy !== "object") {
    errors.push("assessment validation policy is required");
    return false;
  }
  if (typeof policy.runId !== "string" || !policy.runId) {
    errors.push("assessment validation policy requires runId");
  }
  if (!["java", "dotnet", "javascript", "typescript"].includes(policy.language)) {
    errors.push("assessment validation policy requires a supported language");
  }
  if (!Array.isArray(policy.domains)
      || (policy.domains.length === 0
        && !["javascript", "typescript"].includes(policy.language))) {
    errors.push("assessment validation policy requires domains");
  }
  if (!["issue-only", "full"].includes(policy.analysisCoverage)) {
    errors.push("assessment validation policy requires issue-only or full coverage");
  }
  if (!path.isAbsolute(policy.attemptDirectory ?? "")) {
    errors.push("assessment validation policy requires an absolute attemptDirectory");
  }
  if (!path.isAbsolute(policy.workspacePath ?? "")) {
    errors.push("assessment validation policy requires an absolute workspacePath");
  }
  return errors.length === 0;
}

function validateCompatibilityReport(report, policy, errors) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    errors.push("assessment report must contain an object");
    return;
  }
  errors.push(...validateSchema(report, compatibilitySchema, compatibilitySchemaPath)
    .map((error) => `assessment report ${error}`));
  const metadata = report.metadata ?? {};
  if (metadata.runId !== policy.runId) {
    errors.push("assessment report runId does not match the attempt request");
  }
  if (metadata.id !== reportIdForRunId(policy.runId)) {
    errors.push("assessment report id does not match its runId");
  }
  if (metadata.language !== policy.language) {
    errors.push("assessment report language does not match the attempt request");
  }
  if (!sameStringSet(metadata.domains, policy.domains)) {
    errors.push("assessment report domains do not match the attempt request");
  }
  if (!isDeepStrictEqual(
    normalizedAssessmentConfig(metadata.intent?.assessment_config),
    normalizedAssessmentConfig(policy.assessmentConfig),
  )) {
    errors.push("assessment report config does not match the attempt request");
  }
  if (Array.isArray(report.findings) && metadata.totalFindings !== report.findings.length) {
    errors.push("assessment report totalFindings does not match findings[]");
  }
  if (Number.isInteger(metadata.totalActionableFindings)
      && Number.isInteger(metadata.totalFindings)
      && metadata.totalActionableFindings < metadata.totalFindings) {
    errors.push("assessment report totalActionableFindings is less than totalFindings");
  }
  if (Number.isInteger(metadata.totalTrackedFindings)
      && Number.isInteger(metadata.totalActionableFindings)
      && metadata.totalTrackedFindings < metadata.totalActionableFindings) {
    errors.push("assessment report totalTrackedFindings is less than totalActionableFindings");
  }
}

function validateAssessmentHtml(htmlPath, report, policy, errors) {
  const html = fs.readFileSync(htmlPath, "utf8");
  if (Buffer.byteLength(html) <= MINIMUM_HTML_BYTES) {
    errors.push("assessment HTML report is too small to contain the complete payload");
  }
  if (/\{\{[A-Z0-9_]+\}\}/.test(html)) {
    errors.push("assessment HTML report contains unresolved template placeholders");
  }
  const match = html.match(/<script type=["']application\/json["'] id=["']report-data["']>([\s\S]*?)<\/script>/i);
  if (!match) {
    errors.push("assessment HTML report has no embedded report-data payload");
    return;
  }
  let payload;
  try {
    payload = JSON.parse(match[1]);
  } catch (error) {
    errors.push(`assessment HTML report-data is not valid JSON: ${error.message}`);
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push("assessment HTML report-data must contain an object");
    return;
  }
  if (payload.meta?.run_id !== policy.runId) {
    errors.push("assessment HTML run_id does not match the attempt request");
  }
  if (!sameStringSet(payload.selected_groups, policy.domains)) {
    errors.push("assessment HTML selected_groups do not match the attempt request");
  }
  if (!isDeepStrictEqual(
    normalizedAssessmentConfig(payload.intent?.assessment_config),
    normalizedAssessmentConfig(policy.assessmentConfig),
  )) {
    errors.push("assessment HTML config does not match the attempt request");
  }
  if (payload.counts?.total !== report.metadata?.totalTrackedFindings) {
    errors.push("assessment HTML finding count does not match the compatibility report");
  }
  const severityTotal = countBucketTotal(
    payload.counts?.by_severity,
    "severity counts",
    errors,
    SEVERITIES,
  );
  const stateTotal = countBucketTotal(payload.counts?.by_state, "state counts", errors);
  if (severityTotal !== null && severityTotal !== payload.counts?.total) {
    errors.push("assessment HTML severity counts do not sum to total");
  }
  if (stateTotal !== null && stateTotal !== payload.counts?.total) {
    errors.push("assessment HTML state counts do not sum to total");
  }
  validateTopRecommendation(payload.top_recommendation, errors);
}

function validateFullCoverage(reportPath, policy, artifacts, errors) {
  if (policy.analysisCoverage !== "full") return;
  const factsDirectory = path.join(path.dirname(reportPath), "facts");
  for (const skillId of FACT_SKILL_IDS) {
    const factPath = path.join(factsDirectory, `${skillId}.md`);
    const stat = fs.statSync(factPath, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size === 0) {
      errors.push(`full coverage fact is missing or empty: ${skillId}`);
    } else {
      artifacts[`fact:${skillId}`] = canonicalPath(factPath);
    }
  }
}

function securityEntries(document, skillId, errors) {
  if (skillId === "cve-known-vulnerabilities" && Array.isArray(document)) return document;
  const taskStatus = String(document?.status ?? "").toLowerCase();
  if (taskStatus === "not_applicable") return [];
  if (taskStatus === "partial") {
    if (!Array.isArray(document?.result?.evidence) || document.result.evidence.length === 0) {
      errors.push(`partial security task ${skillId} has no failure evidence`);
    }
    if (!Array.isArray(document?.result?.values)) {
      errors.push(`partial security task ${skillId} has no values array`);
      return null;
    }
    return document.result.values;
  }
  if (!SECURITY_TASK_STATUSES.has(taskStatus)) {
    errors.push(`security task ${skillId} has no supported terminal status`);
    return null;
  }
  if (!Array.isArray(document?.result?.values) || document.result.values.length === 0) {
    errors.push(`security task ${skillId} has no terminal rule evidence`);
    return null;
  }
  return document.result.values;
}

function validateSecurityTasks(result, policy, artifacts, errors) {
  if (!policy.domains.includes("security")) return;
  let hasPartialTask = false;
  const incomingDirectory = path.join(policy.attemptDirectory, "scratch", "engines", "security", "incoming");
  for (const skillId of SECURITY_SKILL_IDS) {
    const taskPath = path.join(incomingDirectory, `${skillId}.json`);
    const stat = fs.statSync(taskPath, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      errors.push(`security task evidence is missing: ${skillId}`);
      continue;
    }
    artifacts[`security:${skillId}`] = canonicalPath(taskPath);
    const document = readJsonArtifact(taskPath, `security task ${skillId}`, errors);
    if (document === null) continue;
    if (String(document?.status ?? "").toLowerCase() === "partial") hasPartialTask = true;
    const entries = securityEntries(document, skillId, errors);
    if (!entries) continue;
    for (const [index, entry] of entries.entries()) {
      if (!SECURITY_ENTRY_STATUSES.has(String(entry?.status ?? "").toUpperCase())) {
        errors.push(`security task ${skillId} entry ${index} is not FOUND or NOT_FOUND`);
      }
    }
  }
  if (hasPartialTask && result.status !== "completed_with_issues") {
    errors.push("partial security task evidence requires completed_with_issues");
  }
}

function validateAssessment(result, artifacts, policy, errors) {
  if (!validateAssessmentPolicy(policy, errors)) return;
  const reportPath = requireArtifact(artifacts, "report", errors);
  const htmlPath = requireArtifact(artifacts, "html", errors);
  let report = null;
  if (reportPath) {
    report = readJsonArtifact(reportPath, "assessment report", errors);
    validateCompatibilityReport(report, policy, errors);
    validateFullCoverage(reportPath, policy, artifacts, errors);
  }
  if (htmlPath && report) validateAssessmentHtml(htmlPath, report, policy, errors);
  if (["java", "dotnet"].includes(policy.language)
      && policy.domains.some((domain) => domain !== "security")) {
    if (!artifacts.appcat) {
      const defaultAppcatPath = path.join(
        policy.workspacePath,
        ".github",
        "modernize",
        ".memory",
        "runs",
        policy.runId,
        "appcat",
        "report.json",
      );
      const stat = fs.statSync(defaultAppcatPath, { throwIfNoEntry: false });
      if (stat?.isFile()) {
        const canonicalAppcat = canonicalPath(defaultAppcatPath);
        if (isPathInside(canonicalPath(policy.workspacePath), canonicalAppcat)) {
          artifacts.appcat = canonicalAppcat;
        } else {
          errors.push("artifact appcat escapes the workspace root");
        }
      }
    }
    const appcatPath = requireArtifact(artifacts, "appcat", errors);
    if (appcatPath) {
      const appcat = readJsonArtifact(appcatPath, "AppCAT report", errors);
      if (!appcat || typeof appcat !== "object" || Array.isArray(appcat)) {
        errors.push("AppCAT report must contain an object");
      }
    }
  }
  validateSecurityTasks(result, policy, artifacts, errors);
}

function validatePlanning(artifacts, errors) {
  const planPath = requireArtifact(artifacts, "plan", errors);
  const tasksPath = requireArtifact(artifacts, "tasks", errors);
  if (planPath && !fs.readFileSync(planPath, "utf8").trim()) errors.push("plan.md is empty");
  if (tasksPath) {
    const tasks = readJsonArtifact(tasksPath, "planning tasks", errors);
    if (tasks && !Array.isArray(tasks.tasks)) errors.push("planning tasks must contain a tasks array");
  }
}

function validateExecution(result, artifacts, errors) {
  const summaryPath = requireArtifact(artifacts, "summary", errors);
  const taskStatusPath = requireArtifact(artifacts, "taskStatus", errors);
  if (summaryPath && !fs.readFileSync(summaryPath, "utf8").trim()) errors.push("execution summary is empty");
  if (taskStatusPath) {
    const taskStatus = readJsonArtifact(taskStatusPath, "execution task status", errors);
    if (!taskStatus || !Array.isArray(taskStatus.tasks) || taskStatus.tasks.length === 0) {
      errors.push("execution task status must contain a non-empty tasks array");
    } else {
      for (const [index, task] of taskStatus.tasks.entries()) {
        if (!TERMINAL_TASK_STATUSES.has(task?.status)) {
          errors.push(`execution task ${index} has no supported terminal status`);
        }
      }
    }
  }
  const criteria = result.evidence?.successCriteria;
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
    errors.push("execution evidence must include successCriteria");
    return;
  }
  for (const key of ["build", "tests"]) {
    if (!SUCCESS_CRITERIA_STATUSES.has(criteria[key])) {
      errors.push(`execution successCriteria.${key} must be passed, exempt, or not_applicable`);
    }
  }
}

function validateStatusContract(result, errors) {
  if (result.status === "needs_input") {
    if (!result.needsInput) errors.push("needs_input status requires a needsInput payload");
  } else if (result.needsInput !== null) {
    errors.push("needsInput must be null unless status is needs_input");
  }
  if (result.status === "failed" && !result.error) {
    errors.push("failed status requires an error payload");
  }
  if (SUCCESS_STATUSES.has(result.status) && result.error !== null) {
    errors.push("successful statuses cannot contain an error payload");
  }
  if (SUCCESS_STATUSES.has(result.status) && result.evidence?.artifactValidation !== "passed") {
    errors.push("successful statuses require evidence.artifactValidation to be passed");
  }
}

export function validateAttemptResult(result, {
  expected = {},
  batchRoot,
  workspacePath,
  assessment,
} = {}) {
  const errors = validateSchema(result, schema, schemaPath);
  try {
    assertSafePersistedValue(result);
  } catch (error) {
    errors.push(error.message);
  }
  validateIdentity(result, expected, errors);
  validateStatusContract(result, errors);
  const artifacts = resolveArtifactPaths(result, { batchRoot, workspacePath }, errors);
  if (SUCCESS_STATUSES.has(result.status)) {
    if (result.phase === "assessment") validateAssessment(result, artifacts, assessment, errors);
    if (result.phase === "planning") validatePlanning(artifacts, errors);
    if (result.phase === "execution") validateExecution(result, artifacts, errors);
  }
  return {
    valid: errors.length === 0,
    status: errors.length === 0 ? result.status : "protocol_error",
    errors,
    artifacts,
  };
}

export function validateAttemptResultFile(resultPath, options = {}) {
  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch (error) {
    return {
      valid: false,
      status: "protocol_error",
      errors: [`result file is missing or invalid JSON: ${error.message}`],
      artifacts: {},
    };
  }
  return validateAttemptResult(result, options);
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const resultPath = optionValue("--result");
  const validation = validateAttemptResultFile(resultPath, {
    batchRoot: optionValue("--batch-root"),
    workspacePath: optionValue("--workspace"),
    expected: {
      batchId: optionValue("--batch-id"),
      invocationId: optionValue("--invocation-id"),
      repoId: optionValue("--repo-id"),
      executionUnitId: optionValue("--execution-unit-id"),
      phase: optionValue("--phase"),
      attempt: Number(optionValue("--attempt")),
    },
    assessment: {
      runId: optionValue("--run-id"),
      language: optionValue("--language"),
      domains: optionValue("--domains")?.split(",").filter(Boolean),
      analysisCoverage: optionValue("--coverage"),
      attemptDirectory: optionValue("--attempt-directory"),
      workspacePath: optionValue("--workspace"),
    },
  });
  process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  if (!validation.valid) process.exitCode = 1;
}
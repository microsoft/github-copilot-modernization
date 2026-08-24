import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FACT_SKILL_IDS,
  SECURITY_CWE_SKILL_IDS,
} from "../../assessment/scripts/assessment-catalog.mjs";
import { validateAttemptResult, validateAttemptResultFile } from "./validate-result.mjs";

const identity = {
  batchId: "batch-1",
  invocationId: "4f7e6f2d-8e4f-4e7d-a5d4-3ab29ed8dd3d",
  repoId: "orders",
  executionUnitId: "orders",
  attempt: 1,
};
const runId = `batch-${identity.invocationId}`;
const language = "java";
const domains = ["cloud-readiness"];

function reportIdForRunId(value) {
  const timestamp = (String(value).match(/\d+/g) ?? []).join("").slice(0, 14);
  return /^\d{14}$/.test(timestamp)
    ? timestamp
    : String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-result-"));
  const batchRoot = path.join(root, "batch");
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(batchRoot);
  fs.mkdirSync(workspacePath);
  const attemptDirectory = path.join(batchRoot, "attempt");
  fs.mkdirSync(attemptDirectory);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, batchRoot, workspacePath, attemptDirectory };
}

function writeAssessmentArtifacts(value, {
  selectedDomains = domains,
  analysisCoverage = "issue-only",
  selectedRunId = runId,
  selectedLanguage = language,
  assessmentConfig = {},
  bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  byState = {},
  topRecommendation = {
    kind: "no-findings",
    summary: "No outstanding findings for focus 'overview'.",
    next_action: null,
    prefilled_prompt: null,
  },
} = {}) {
  const reportDirectory = path.join(value.workspacePath, "assessment", reportIdForRunId(selectedRunId));
  fs.mkdirSync(reportDirectory, { recursive: true });
  const report = path.join(reportDirectory, "report.json");
  const html = path.join(value.workspacePath, "assessment", "report.html");
  const reportValue = {
    version: "1.1.0",
    metadata: {
      id: reportIdForRunId(selectedRunId),
      runId: selectedRunId,
      generatedAt: "2026-08-12T12:00:00Z",
      analysisStartTime: "2026-08-12T11:59:00Z",
      analysisEndTime: "2026-08-12T12:00:00Z",
      status: "completed",
      domains: selectedDomains,
      language: selectedLanguage,
      intent: Object.keys(assessmentConfig).length > 0
        ? { assessment_config: assessmentConfig }
        : {},
      totalFindings: 0,
      totalActionableFindings: 0,
      totalTrackedFindings: 0,
    },
    categories: [],
    findings: [],
    security: [],
  };
  fs.writeFileSync(report, `${JSON.stringify(reportValue, null, 2)}\n`);
  const payload = {
    meta: { run_id: selectedRunId },
    intent: Object.keys(assessmentConfig).length > 0
      ? { assessment_config: assessmentConfig }
      : {},
    selected_groups: selectedDomains,
    counts: { total: 0, by_severity: bySeverity, by_state: byState },
    top_recommendation: topRecommendation,
  };
  fs.writeFileSync(
    html,
    `<!doctype html><html><script type="application/json" id="report-data">${JSON.stringify(payload)}</script>${"complete".repeat(2_000)}</html>`,
  );
  const artifacts = { report, html };
  if (selectedDomains.some((domain) => domain !== "security")) {
    const appcat = path.join(value.workspacePath, "assessment", "appcat.json");
    fs.writeFileSync(appcat, "{\"rules\":[],\"incidents\":[]}\n");
    artifacts.appcat = appcat;
  }
  if (analysisCoverage === "full") {
    const factsDirectory = path.join(reportDirectory, "facts");
    fs.mkdirSync(factsDirectory);
    for (const skillId of FACT_SKILL_IDS) {
      fs.writeFileSync(path.join(factsDirectory, `${skillId}.md`), `# ${skillId}\n`);
    }
  }
  if (selectedDomains.includes("security")) {
    const securityDirectory = path.join(
      value.attemptDirectory,
      "scratch",
      "engines",
      "security",
      "incoming",
    );
    fs.mkdirSync(securityDirectory, { recursive: true });
    fs.writeFileSync(path.join(securityDirectory, "cve-known-vulnerabilities.json"), "[]\n");
    for (const skillId of SECURITY_CWE_SKILL_IDS) {
      fs.writeFileSync(
        path.join(securityDirectory, `${skillId}.json`),
        `${JSON.stringify({ status: "success", result: { values: [{ status: "NOT_FOUND" }] } })}\n`,
      );
    }
  }
  return { artifacts, reportValue, report, html, payload };
}

function baseResult(phase, artifacts, extra = {}) {
  return {
    schemaVersion: 1,
    ...identity,
    phase,
    status: "completed",
    artifacts,
    evidence: { artifactValidation: "passed" },
    needsInput: null,
    error: null,
    completedAt: "2026-08-12T12:00:00.000Z",
    ...extra,
  };
}

function options(fixtureValue, phase, assessment = {}) {
  const result = {
    batchRoot: fixtureValue.batchRoot,
    workspacePath: fixtureValue.workspacePath,
    expected: { ...identity, phase },
  };
  if (phase === "assessment") {
    result.assessment = {
      runId,
      language,
      domains,
      analysisCoverage: "issue-only",
      attemptDirectory: fixtureValue.attemptDirectory,
      workspacePath: fixtureValue.workspacePath,
      ...assessment,
    };
  }
  return result;
}

test("assessment completion binds validated JSON and HTML reports to the attempt", (t) => {
  const value = fixture(t);
  const { artifacts } = writeAssessmentArtifacts(value);
  const result = baseResult("assessment", artifacts);
  assert.deepEqual(validateAttemptResult(result, options(value, "assessment")), {
    valid: true,
    status: "completed",
    errors: [],
    artifacts,
  });

  const unverified = baseResult("assessment", artifacts, {
    evidence: { artifactValidation: "not_run" },
  });
  assert.match(
    validateAttemptResult(unverified, options(value, "assessment")).errors.join("\n"),
    /artifactValidation to be passed/,
  );
});

test("assessment completion binds explicit config to JSON and HTML", (t) => {
  const value = fixture(t);
  const assessmentConfig = {
    targetRuntime: "java-21",
    targetComputeServices: ["azure-container-apps"],
    enableContainerization: true,
    targetOS: ["linux"],
    minimumCveSeverity: "high",
    cveScanScope: "all",
  };
  const created = writeAssessmentArtifacts(value, { assessmentConfig });
  const result = baseResult("assessment", created.artifacts);
  const policy = options(value, "assessment", { assessmentConfig });
  assert.deepEqual(validateAttemptResult(result, policy), {
    valid: true,
    status: "completed",
    errors: [],
    artifacts: created.artifacts,
  });

  fs.writeFileSync(created.report, `${JSON.stringify({
    ...created.reportValue,
    metadata: { ...created.reportValue.metadata, intent: {} },
  }, null, 2)}\n`);
  assert.match(validateAttemptResult(result, policy).errors.join("\n"), /report config/);

  fs.writeFileSync(created.report, `${JSON.stringify(created.reportValue, null, 2)}\n`);
  const html = fs.readFileSync(created.html, "utf8").replace(
    JSON.stringify({ assessment_config: assessmentConfig }),
    JSON.stringify({ assessment_config: { ...assessmentConfig, targetRuntime: "java-17" } }),
  );
  fs.writeFileSync(created.html, html);
  assert.match(validateAttemptResult(result, policy).errors.join("\n"), /HTML config/);
});

test("assessment completion rejects incomplete Single summary semantics", (t) => {
  const value = fixture(t);
  const created = writeAssessmentArtifacts(value);
  const malformedPayload = {
    ...created.payload,
    counts: {
      ...created.payload.counts,
      by_severity: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
    },
  };
  fs.writeFileSync(
    created.html,
    `<!doctype html><html><script type="application/json" id="report-data">${JSON.stringify(malformedPayload)}</script>${"complete".repeat(2_000)}</html>`,
  );
  assert.match(
    validateAttemptResult(baseResult("assessment", created.artifacts), options(value, "assessment")).errors.join("\n"),
    /severity counts do not sum/,
  );
});

test("assessment completion rejects malformed, stale, or fabricated reports", (t) => {
  const value = fixture(t);
  const created = writeAssessmentArtifacts(value);
  const result = baseResult("assessment", created.artifacts);

  fs.writeFileSync(created.report, "{}\n");
  assert.match(validateAttemptResult(result, options(value, "assessment")).errors.join("\n"), /metadata is required/);

  created.reportValue.version = "1.0.0";
  created.reportValue.metadata.runId = "stale-run";
  fs.writeFileSync(created.report, `${JSON.stringify(created.reportValue)}\n`);
  const staleErrors = validateAttemptResult(result, options(value, "assessment")).errors.join("\n");
  assert.match(staleErrors, /version/);
  assert.match(staleErrors, /runId does not match/);

  const valid = writeAssessmentArtifacts(value);
  fs.writeFileSync(valid.html, `<html>${"x".repeat(11_000)}</html>`);
  assert.match(
    validateAttemptResult(baseResult("assessment", valid.artifacts), options(value, "assessment")).errors.join("\n"),
    /no embedded report-data payload/,
  );
});

test("assessment completion verifies full facts and terminal security evidence", (t) => {
  const value = fixture(t);
  const selectedDomains = ["security"];
  const created = writeAssessmentArtifacts(value, { selectedDomains, analysisCoverage: "full" });
  const result = baseResult("assessment", created.artifacts);
  const policy = options(value, "assessment", {
    domains: selectedDomains,
    analysisCoverage: "full",
  });
  assert.equal(validateAttemptResult(result, policy).valid, true);

  fs.rmSync(path.join(path.dirname(created.report), "facts", `${FACT_SKILL_IDS[0]}.md`));
  assert.match(validateAttemptResult(result, policy).errors.join("\n"), /full coverage fact is missing/);

  fs.writeFileSync(path.join(path.dirname(created.report), "facts", `${FACT_SKILL_IDS[0]}.md`), "# restored\n");
  const pendingPath = path.join(
    value.attemptDirectory,
    "scratch",
    "engines",
    "security",
    "incoming",
    `${SECURITY_CWE_SKILL_IDS[0]}.json`,
  );
  fs.writeFileSync(pendingPath, '{"status":"success","result":{"values":[{"status":"PENDING"}]}}\n');
  assert.match(validateAttemptResult(result, policy).errors.join("\n"), /not FOUND or NOT_FOUND/);

  fs.writeFileSync(pendingPath, '{"status":"partial","result":{"values":[]}}\n');
  assert.match(validateAttemptResult(
    baseResult("assessment", created.artifacts, { status: "completed_with_issues" }),
    policy,
  ).errors.join("\n"), /partial security task.*failure evidence/);
});

test("JavaScript cloud assessment does not require an AppCAT artifact", (t) => {
  const value = fixture(t);
  const created = writeAssessmentArtifacts(value, { selectedLanguage: "javascript" });
  delete created.artifacts.appcat;
  fs.rmSync(path.join(value.workspacePath, "assessment", "appcat.json"));
  const validation = validateAttemptResult(
    baseResult("assessment", created.artifacts),
    options(value, "assessment", { language: "javascript" }),
  );
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("Java cloud assessment discovers AppCAT at the request-bound run path", (t) => {
  const value = fixture(t);
  const created = writeAssessmentArtifacts(value);
  delete created.artifacts.appcat;
  fs.rmSync(path.join(value.workspacePath, "assessment", "appcat.json"));
  const appcatPath = path.join(
    value.workspacePath,
    ".github",
    "modernize",
    ".memory",
    "runs",
    runId,
    "appcat",
    "report.json",
  );
  fs.mkdirSync(path.dirname(appcatPath), { recursive: true });
  fs.writeFileSync(appcatPath, "{\"rules\":[],\"incidents\":[]}\n");
  const validation = validateAttemptResult(
    baseResult("assessment", created.artifacts),
    options(value, "assessment"),
  );
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(validation.artifacts.appcat, appcatPath);
});

test("planning completion requires plan and a tasks array", (t) => {
  const value = fixture(t);
  const plan = path.join(value.workspacePath, "plan.md");
  const tasks = path.join(value.workspacePath, "tasks.json");
  fs.writeFileSync(plan, "# Plan\n");
  fs.writeFileSync(tasks, '{"tasks":[]}\n');
  assert.equal(
    validateAttemptResult(baseResult("planning", { plan, tasks }), options(value, "planning")).valid,
    true,
  );
  fs.writeFileSync(tasks, "{}\n");
  assert.match(
    validateAttemptResult(baseResult("planning", { plan, tasks }), options(value, "planning")).errors.join("\n"),
    /tasks array/,
  );
});

test("execution completion requires terminal tasks and explicit build/test evidence", (t) => {
  const value = fixture(t);
  const summary = path.join(value.workspacePath, "summary.md");
  const taskStatus = path.join(value.batchRoot, "task-status.json");
  fs.writeFileSync(summary, "# Done\n");
  fs.writeFileSync(taskStatus, '{"tasks":[{"id":"T1","status":"completed"}]}\n');
  const result = baseResult("execution", { summary, taskStatus }, {
    evidence: {
      artifactValidation: "passed",
      successCriteria: { build: "passed", tests: "exempt" },
    },
  });
  assert.equal(validateAttemptResult(result, options(value, "execution")).valid, true);
  fs.writeFileSync(taskStatus, '{"tasks":[{"id":"T1","status":"running"}]}\n');
  assert.match(
    validateAttemptResult(result, options(value, "execution")).errors.join("\n"),
    /no supported terminal status/,
  );
});

test("schema, identity, status, and secret violations become protocol errors", (t) => {
  const value = fixture(t);
  const invalid = {
    ...baseResult("assessment", {}),
    invocationId: "wrong",
    status: "completed",
    needsInput: { requestId: "stale" },
    error: { code: "bad", message: "https://user:secret@example.com/repo.git?token=x", retryable: false },
  };
  delete invalid.executionUnitId;
  const validation = validateAttemptResult(invalid, options(value, "assessment"));
  assert.equal(validation.status, "protocol_error");
  assert.match(validation.errors.join("\n"), /executionUnitId is required/);
  assert.match(validation.errors.join("\n"), /invocationId does not match/);
  assert.match(validation.errors.join("\n"), /needsInput must be null/);
  assert.match(validation.errors.join("\n"), /must not contain URL credentials/);
});

test("artifact paths reject missing, relative, outside, and symlink escapes", (t) => {
  const value = fixture(t);
  const outside = path.join(value.root, "outside.json");
  fs.writeFileSync(outside, "{}\n");
  const relative = baseResult("assessment", { report: "report.json", html: "missing.html" });
  assert.match(validateAttemptResult(relative, options(value, "assessment")).errors.join("\n"), /absolute path/);
  const outsideResult = baseResult("assessment", { report: outside, html: outside });
  assert.match(validateAttemptResult(outsideResult, options(value, "assessment")).errors.join("\n"), /escapes/);

  const link = path.join(value.workspacePath, "linked-report.json");
  try {
    fs.symlinkSync(outside, link, "file");
    const escaped = baseResult("assessment", { report: link, html: link });
    assert.match(validateAttemptResult(escaped, options(value, "assessment")).errors.join("\n"), /escapes/);
  } catch (error) {
    if (!["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) throw error;
  }
});

test("NeedsInput and failed results enforce their payload contracts without phase artifacts", (t) => {
  const value = fixture(t);
  const needsInput = baseResult("planning", {}, {
    status: "needs_input",
    needsInput: {
      schemaVersion: 1,
      requestId: "q1",
      batchId: identity.batchId,
      invocationId: identity.invocationId,
      repoId: identity.repoId,
      executionUnitId: identity.executionUnitId,
      sourceAttempt: 1,
      status: "pending",
      questions: [{
        id: "target",
        kind: "text",
        prompt: "Target?",
        required: true,
        options: [],
      }],
      answers: [],
    },
  });
  assert.equal(validateAttemptResult(needsInput, options(value, "planning")).valid, true);
  const failed = baseResult("assessment", {}, {
    status: "failed",
    error: { code: "engine_failed", message: "failed", retryable: true },
  });
  assert.equal(validateAttemptResult(failed, options(value, "assessment")).valid, true);
});

test("missing and malformed result files fail closed", (t) => {
  const value = fixture(t);
  const resultPath = path.join(value.batchRoot, "result.json");
  assert.equal(validateAttemptResultFile(resultPath, options(value, "assessment")).status, "protocol_error");
  fs.writeFileSync(resultPath, "{");
  assert.equal(validateAttemptResultFile(resultPath, options(value, "assessment")).valid, false);
});
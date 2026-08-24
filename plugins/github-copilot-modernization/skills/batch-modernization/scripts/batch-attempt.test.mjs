import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { acquireLease, initializeBatch, readLease, readState } from "./batch-state.mjs";
import {
  FACT_SKILL_IDS,
  SECURITY_CWE_SKILL_IDS,
} from "../../assessment/scripts/assessment-catalog.mjs";
import {
  commitAttempt,
  finalizeAssessmentBatch,
  initializeAssessmentBatch,
  openLeaseSession,
  publishAttemptResult,
  startAttempt,
} from "./batch-attempt.mjs";

const batchAttemptCli = fileURLToPath(new URL("./batch-attempt.mjs", import.meta.url));
const CONFIGURED_DECISIONS = {
  domains: ["security"],
  analysisCoverage: "full",
  maxConcurrency: 1,
  targetRuntime: "java-21",
  targetComputeServices: ["azure-container-apps"],
  enableContainerization: true,
  targetOS: ["linux"],
  minimumCveSeverity: "high",
  cveScanScope: "all",
};

function runBatchAttemptCli(args) {
  return spawnSync(process.execPath, [batchAttemptCli, ...args], {
    encoding: "utf8",
    timeout: 15_000,
  });
}

function cliJson(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /ownerToken|BATCH_OWNER_TOKEN/);
  return JSON.parse(result.stdout);
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-attempt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(path.join(workspacePath, "package.json"), "{}\n");
  const unit = {
    schemaVersion: 1,
    repoId: "orders",
    executionUnitId: "orders/api",
    displayName: "orders/api",
    workspacePath,
    gitRoot: workspacePath,
    scopeRoots: [workspacePath],
    languages: ["javascript"],
    source: "include-path",
  };
  const batchRoot = path.join(root, ".github", "modernize", "batches", "batch-1");
  initializeBatch({
    batchRoot,
    manifest: {
      batchId: "batch-1",
      resolvedConfig: { repositories: [{ repoId: "orders", executionUnits: [unit] }] },
      assessment: {
        userRequest: "Assess selected repositories",
        phaseApproved: true,
        inputArtifacts: {},
        decisions: CONFIGURED_DECISIONS,
      },
    },
    state: {
      status: "ready",
      executionUnits: [{
        repoId: "orders",
        executionUnitId: "orders/api",
        phase: "assessment",
        attempt: 0,
        invocationId: null,
        status: "pending",
        resultPath: null,
        startedAt: null,
        finishedAt: null,
      }],
      progress: { wave: 1, eligible: 1, terminal: 0, successful: 0, issues: 0, failed: 0 },
    },
  });
  const { ownerToken } = acquireLease({ batchRoot, invocationId: "coordinator" });
  return { root, batchRoot, workspacePath, ownerToken };
}

function start(fixture) {
  return startAttempt({
    batchRoot: fixture.batchRoot,
    ownerToken: fixture.ownerToken,
    executionUnitId: "orders/api",
    input: {
      userRequest: "Assess selected repositories",
      phaseApproved: true,
      inputArtifacts: {},
      decisions: CONFIGURED_DECISIONS,
    },
    invocationId: "11111111-1111-4111-8111-111111111111",
    now: "2026-08-17T12:00:00.000Z",
  });
}

function assessmentUnit({ repoId, executionUnitId = repoId, workspacePath, gitRoot = workspacePath, language, source = "repository-root" }) {
  return {
    schemaVersion: 1,
    repoId,
    executionUnitId,
    displayName: executionUnitId,
    workspacePath,
    gitRoot,
    scopeRoots: [workspacePath],
    languages: [language],
    source,
  };
}

function resolvedConfig(root, repositories) {
  return {
    schemaVersion: 1,
    configPath: path.join(root, "repos.json"),
    configSha256: "a".repeat(64),
    producer: null,
    repositories: repositories.map(({ repoId, workspacePath, executionUnits, includePaths = [] }) => ({
      repoId,
      name: repoId,
      input: { url: null, path: workspacePath, branch: null, includePaths },
      workspacePath,
      preflightStatus: "ready",
      warnings: [],
      errors: [],
      executionUnits,
      unknownFields: {},
    })),
    apps: [],
    unknownFields: {},
  };
}

function reportIdForRunId(runId) {
  const timestamp = (String(runId).match(/\d+/g) ?? []).join("").slice(0, 14);
  return /^\d{14}$/.test(timestamp)
    ? timestamp
    : String(runId).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function createAssessmentArtifacts(started, name, {
  trackedFindings = 0,
  bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  byState = {},
  topRecommendation = {
    kind: "no-findings",
    summary: "No outstanding findings for focus 'overview'.",
    next_action: null,
    prefilled_prompt: null,
  },
} = {}) {
  const request = started.request ?? JSON.parse(fs.readFileSync(started.requestPath, "utf8"));
  const {
    domains: _domains,
    analysisCoverage: _analysisCoverage,
    maxConcurrency: _maxConcurrency,
    ...assessmentConfig
  } = request.decisions;
  const attemptDirectory = path.dirname(started.requestPath);
  const reportDirectory = path.join(
    request.workspacePath,
    ".github",
    "modernize",
    "assessment",
    "reports",
    `report-${reportIdForRunId(request.runId)}`,
  );
  fs.mkdirSync(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, "report.json");
  const htmlPath = path.join(request.workspacePath, ".github", "modernize", "reports", `${request.runId}.html`);
  const report = {
    version: "1.1.0",
    metadata: {
      id: reportIdForRunId(request.runId),
      runId: request.runId,
      generatedAt: "2026-08-17T12:01:00Z",
      analysisStartTime: "2026-08-17T12:00:00Z",
      analysisEndTime: "2026-08-17T12:01:00Z",
      status: "completed",
      domains: request.decisions.domains,
      language: request.language,
      intent: Object.keys(assessmentConfig).length > 0
        ? { assessment_config: assessmentConfig }
        : {},
      totalFindings: 0,
      totalActionableFindings: 0,
      totalTrackedFindings: trackedFindings,
    },
    categories: [],
    findings: [],
    security: [],
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  const payload = {
    meta: { run_id: request.runId },
    intent: Object.keys(assessmentConfig).length > 0
      ? { assessment_config: assessmentConfig }
      : {},
    selected_groups: request.decisions.domains,
    counts: { total: trackedFindings, by_severity: bySeverity, by_state: byState },
    top_recommendation: topRecommendation,
  };
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><html><title>${name}</title><script type="application/json" id="report-data">${JSON.stringify(payload)}</script>${"complete".repeat(2_000)}</html>`,
  );
  const artifacts = { report: reportPath, html: htmlPath };
  if (request.decisions.domains.some((domain) => domain !== "security")) {
    const appcatPath = path.join(request.workspacePath, ".github", "modernize", ".memory", "runs", request.runId, "appcat", "report.json");
    fs.mkdirSync(path.dirname(appcatPath), { recursive: true });
    fs.writeFileSync(appcatPath, "{\"rules\":[],\"incidents\":[]}\n");
    artifacts.appcat = appcatPath;
  }
  if (request.decisions.analysisCoverage === "full") {
    const factsDirectory = path.join(reportDirectory, "facts");
    fs.mkdirSync(factsDirectory);
    for (const skillId of FACT_SKILL_IDS) {
      fs.writeFileSync(path.join(factsDirectory, `${skillId}.md`), `# ${skillId}\n`);
    }
  }
  if (request.decisions.domains.includes("security")) {
    const securityDirectory = path.join(attemptDirectory, "scratch", "engines", "security", "incoming");
    fs.mkdirSync(securityDirectory, { recursive: true });
    fs.writeFileSync(path.join(securityDirectory, "cve-known-vulnerabilities.json"), "[]\n");
    for (const skillId of SECURITY_CWE_SKILL_IDS) {
      fs.writeFileSync(
        path.join(securityDirectory, `${skillId}.json`),
        `${JSON.stringify({ status: "success", result: { values: [{ status: "NOT_FOUND" }] } })}\n`,
      );
    }
  }
  return artifacts;
}

test("assessment attempt is bound to one unit and commits verified artifacts", (t) => {
  const fixture = createFixture(t);
  const started = start(fixture);
  assert.equal(fs.existsSync(started.requestPath), true);
  assert.equal(started.request.executionUnitId, "orders/api");
  assert.equal(started.request.workspacePath, fixture.workspacePath);
  assert.equal(path.basename(started.request.assessmentCliPath), "assess-cli.mjs");
  assert.equal(fs.statSync(started.request.assessmentCliPath).isFile(), true);
  assert.deepEqual(started.request.decisions, {
    domains: ["security"],
    analysisCoverage: "full",
    maxConcurrency: 1,
    targetRuntime: "java-21",
    targetComputeServices: ["azure-container-apps"],
    enableContainerization: true,
    targetOS: ["linux"],
    minimumCveSeverity: "high",
    cveScanScope: "all",
  });
  assert.equal(Object.hasOwn(started.request, "leaseToken"), false);
  assert.equal(readState(fixture.batchRoot).executionUnits[0].status, "running");

  const artifacts = createAssessmentArtifacts(started, "orders-api");
  const reportPath = artifacts.report;
  const htmlPath = artifacts.html;
  publishAttemptResult({
    requestPath: started.requestPath,
    outcome: {
      status: "completed",
      artifacts,
      evidence: { artifactValidation: "passed" },
      needsInput: null,
      error: null,
    },
    now: "2026-08-17T12:01:00.000Z",
  });
  assert.throws(
    () => publishAttemptResult({
      requestPath: started.requestPath,
      outcome: {
        status: "completed",
        artifacts,
        evidence: { artifactValidation: "passed" },
      },
    }),
    /already exists/,
  );

  assert.throws(
    () => commitAttempt({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      requestPath: started.requestPath,
      now: "2026-08-17T12:01:30.000Z",
      checkpoint: (step) => {
        if (step === "validation") throw new Error("simulated crash after validation");
      },
    }),
    /simulated crash after validation/,
  );
  assert.equal(readState(fixture.batchRoot).executionUnits[0].status, "running");
  assert.equal(fs.existsSync(path.join(path.dirname(started.requestPath), "validation.json")), true);

  assert.throws(
    () => commitAttempt({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      requestPath: started.requestPath,
      now: "2026-08-17T12:02:00.000Z",
      checkpoint: (step) => {
        if (step === "state") throw new Error("simulated crash after state");
      },
    }),
    /simulated crash after state/,
  );
  assert.equal(fs.existsSync(path.join(fixture.batchRoot, "repos", "orders.json")), false);
  assert.throws(
    () => finalizeAssessmentBatch({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
    }),
    (error) => error.code === "validation_commit_incomplete",
  );

  assert.throws(
    () => commitAttempt({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      requestPath: started.requestPath,
      now: "2026-08-17T12:02:30.000Z",
      checkpoint: (step) => {
        if (step === "repo") throw new Error("simulated crash after repo");
      },
    }),
    /simulated crash after repo/,
  );
  assert.equal(fs.existsSync(path.join(fixture.batchRoot, "repos", "orders.json")), true);
  assert.equal(
    fs.readFileSync(path.join(fixture.batchRoot, "events.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => JSON.parse(line).type === "attempt_finished")
      .length,
    0,
  );

  const committed = commitAttempt({
    batchRoot: fixture.batchRoot,
    ownerToken: fixture.ownerToken,
    requestPath: started.requestPath,
    now: "2026-08-17T12:02:45.000Z",
  });
  assert.equal(committed.validation.valid, true);
  assert.equal(committed.state.status, "completed");
  assert.equal(committed.state.executionUnits[0].status, "completed");
  assert.deepEqual(committed.state.progress, {
    wave: 1,
    eligible: 1,
    terminal: 1,
    successful: 1,
    issues: 0,
    failed: 0,
  });
  const revision = committed.state.revision;
  const replayed = commitAttempt({
    batchRoot: fixture.batchRoot,
    ownerToken: fixture.ownerToken,
    requestPath: started.requestPath,
    now: "2026-08-17T12:02:50.000Z",
  });
  assert.equal(replayed.state.revision, revision);
  const events = fs.readFileSync(path.join(fixture.batchRoot, "events.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.type === "attempt_finished").length, 1);

  const originalReport = fs.readFileSync(reportPath);
  fs.appendFileSync(reportPath, "\n");
  assert.throws(
    () => finalizeAssessmentBatch({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
    }),
    (error) => error.code === "validated_artifact_changed",
  );
  fs.writeFileSync(reportPath, originalReport);

  const factPath = path.join(path.dirname(reportPath), "facts", `${FACT_SKILL_IDS[0]}.md`);
  const originalFact = fs.readFileSync(factPath);
  fs.appendFileSync(factPath, "\n");
  assert.throws(
    () => finalizeAssessmentBatch({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
    }),
    (error) => error.code === "validated_artifact_changed",
  );
  fs.writeFileSync(factPath, originalFact);

  const securityPath = path.join(
    path.dirname(started.requestPath),
    "scratch",
    "engines",
    "security",
    "incoming",
    `${SECURITY_CWE_SKILL_IDS[0]}.json`,
  );
  const originalSecurity = fs.readFileSync(securityPath);
  fs.appendFileSync(securityPath, "\n");
  assert.throws(
    () => finalizeAssessmentBatch({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
    }),
    (error) => error.code === "validated_artifact_changed",
  );
  fs.writeFileSync(securityPath, originalSecurity);

  assert.throws(
    () => finalizeAssessmentBatch({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      now: "2026-08-17T12:03:00.000Z",
      checkpoint: (step) => {
        if (step === "summary") throw new Error("simulated crash after summary");
      },
    }),
    /simulated crash after summary/,
  );
  const summaryJson = fs.readFileSync(path.join(fixture.batchRoot, "summary.json"));
  const summaryMarkdown = fs.readFileSync(path.join(fixture.batchRoot, "summary.md"));
  assert.throws(
    () => finalizeAssessmentBatch({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      now: "2026-08-17T12:03:30.000Z",
      checkpoint: (step) => {
        if (step === "event") throw new Error("simulated crash after event");
      },
    }),
    /simulated crash after event/,
  );
  assert.notEqual(readLease(fixture.batchRoot), null);
  assert.throws(
    () => finalizeAssessmentBatch({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      now: "2026-08-17T12:03:45.000Z",
      checkpoint: (step) => {
        if (step === "release-ready") throw new Error("simulated crash after release-ready");
      },
    }),
    /simulated crash after release-ready/,
  );
  assert.notEqual(readLease(fixture.batchRoot), null);
  assert.throws(
    () => finalizeAssessmentBatch({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      now: "2026-08-17T12:04:00.000Z",
      checkpoint: (step) => {
        if (step === "released") throw new Error("simulated crash after release");
      },
    }),
    /simulated crash after release/,
  );
  assert.equal(readLease(fixture.batchRoot), null);
  const finalized = finalizeAssessmentBatch({
    batchRoot: fixture.batchRoot,
    ownerToken: fixture.ownerToken,
    now: "2026-08-17T12:05:00.000Z",
  });
  assert.equal(finalized.summary.status, "completed");
  assert.equal(finalized.summary.results[0].artifacts.report, reportPath);
  assert.equal(fs.existsSync(finalized.paths.markdown), true);
  const userReportRoot = path.join(
    fixture.root,
    ".github",
    "modernize",
    "assessment",
    "reports-20260817120200",
  );
  assert.equal(finalized.paths.reportDirectory, userReportRoot);
  assert.equal(finalized.paths.reportIndex, path.join(userReportRoot, "index.html"));
  assert.equal(finalized.paths.aggregateReport, path.join(userReportRoot, "aggregate-report.json"));
  assert.equal(fs.existsSync(path.join(userReportRoot, "repos", "orders.api", "report.json")), true);
  assert.equal(fs.existsSync(path.join(userReportRoot, "repos", "orders.api", "report.html")), true);
  const aggregate = JSON.parse(fs.readFileSync(finalized.paths.aggregateReport, "utf8"));
  assert.equal(aggregate.metadata.batchId, "batch-1");
  assert.equal(aggregate.metadata.repos[0].identity, "orders/api");
  assert.equal(aggregate.projects[0].properties.repo, "orders/api");
  assert.deepEqual(aggregate.rules, {});
  const extension = aggregate.extensions["github-copilot-modernization"];
  assert.equal(extension.counts.completed, 1);
  assert.deepEqual(extension.assessmentConfig, {
    targetRuntime: "java-21",
    targetComputeServices: ["azure-container-apps"],
    enableContainerization: true,
    targetOS: ["linux"],
    minimumCveSeverity: "high",
    cveScanScope: "all",
  });
  assert.deepEqual(extension.repositories[0].assessmentConfig, extension.assessmentConfig);
  assert.equal(extension.repositories[0].reports.html, "repos/orders.api/report.html");
  assert.equal(finalized.summary.reports.index, finalized.paths.reportIndex);
  assert.equal(readLease(fixture.batchRoot), null);
  assert.deepEqual(fs.readFileSync(finalized.paths.json), summaryJson);
  assert.deepEqual(fs.readFileSync(finalized.paths.markdown), summaryMarkdown);
  const finalization = JSON.parse(fs.readFileSync(path.join(fixture.batchRoot, "finalization.json")));
  assert.equal(finalization.released, true);
  assert.equal(finalization.reportDirectoryPath, userReportRoot);
  assert.match(finalization.reportDirectoryDigest, /^sha256:[a-f0-9]{64}$/);
  const originalIndex = fs.readFileSync(finalized.paths.reportIndex);
  fs.appendFileSync(finalized.paths.reportIndex, "\n");
  assert.throws(
    () => finalizeAssessmentBatch({ batchRoot: fixture.batchRoot, ownerToken: fixture.ownerToken }),
    (error) => error.code === "finalization_record_mismatch",
  );
  fs.writeFileSync(finalized.paths.reportIndex, originalIndex);
  const finalEvents = fs.readFileSync(path.join(fixture.batchRoot, "events.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(finalEvents.filter((event) => event.type === "batch_completed").length, 1);
});

test("lease session retains ownership across stateless CLI processes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-lease-session-"));
  let leaseSessionId;
  t.after(() => {
    if (leaseSessionId) {
      runBatchAttemptCli(["session-release", "--lease-session-id", leaseSessionId]);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repositories = ["orders", "billing"].map((repoId) => {
    const workspacePath = path.join(root, repoId);
    fs.mkdirSync(workspacePath);
    return {
      repoId,
      workspacePath,
      executionUnits: [assessmentUnit({ repoId, workspacePath, language: "java" })],
    };
  });
  const batchRoot = path.join(root, ".github", "modernize", "batches", "lease-session-assessment");
  initializeAssessmentBatch({
    batchRoot,
    resolvedConfig: resolvedConfig(root, repositories),
    selection: { executionUnitIds: ["orders", "billing"], approvedNeedsAttention: [] },
    input: {
      batchId: "lease-session-assessment",
      userRequest: "Assess selected repositories",
      phaseApproved: true,
      inputArtifacts: {},
      decisions: { domains: ["cloud-readiness"], analysisCoverage: "issue-only", maxConcurrency: 1 },
    },
  });

  const opened = cliJson(runBatchAttemptCli([
    "open-session",
    "--batch-root", batchRoot,
    "--invocation-id", "lease-session-test",
    "--execution-unit-id", "orders",
  ]));
  leaseSessionId = opened.leaseSessionId;
  assert.match(leaseSessionId, /^[0-9a-f-]{36}$/i);

  for (const [index, repoId] of ["orders", "billing"].entries()) {
    const started = index === 0
      ? opened
      : cliJson(runBatchAttemptCli([
        "session-start",
        "--lease-session-id", leaseSessionId,
        "--execution-unit-id", repoId,
      ]));
    const artifacts = createAssessmentArtifacts(started, repoId);
    const publishedArtifacts = { ...artifacts };
    delete publishedArtifacts.appcat;
    publishAttemptResult({
      requestPath: started.requestPath,
      outcome: {
        status: "completed",
        artifacts: publishedArtifacts,
        evidence: { artifactValidation: "passed" },
        needsInput: null,
        error: null,
      },
    });
    const committed = cliJson(runBatchAttemptCli([
      "session-commit",
      "--lease-session-id", leaseSessionId,
      "--request", started.requestPath,
    ]));
    assert.equal(committed.validation.valid, true, committed.validation.errors.join("\n"));
  }

  const finalized = cliJson(runBatchAttemptCli([
    "session-finalize-assessment",
    "--lease-session-id", leaseSessionId,
  ]));
  leaseSessionId = null;
  assert.equal(finalized.summary.status, "completed");
  assert.equal(finalized.summary.counts.completed, 2);
  assert.equal(fs.existsSync(finalized.paths.reportIndex), true);
  assert.equal(readLease(batchRoot), null);
});

test("missing result commits protocol_error instead of trusting agent completion", (t) => {
  const fixture = createFixture(t);
  const started = start(fixture);

  const committed = commitAttempt({
    batchRoot: fixture.batchRoot,
    ownerToken: fixture.ownerToken,
    requestPath: started.requestPath,
    now: "2026-08-17T12:02:00.000Z",
  });

  assert.equal(committed.validation.valid, false);
  assert.equal(committed.validation.status, "protocol_error");
  assert.equal(committed.state.executionUnits[0].status, "protocol_error");
  assert.equal(committed.state.status, "failed");
  assert.equal(committed.state.progress.failed, 1);
});

test("unapproved or conflicting attempts fail closed", (t) => {
  const fixture = createFixture(t);
  assert.throws(
    () => startAttempt({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      executionUnitId: "orders/api",
      input: { userRequest: "Assess", phaseApproved: false },
    }),
    /not approved/,
  );
  const started = start(fixture);
  const replayed = start(fixture);
  assert.equal(replayed.requestPath, started.requestPath);
  assert.equal(replayed.state.revision, started.state.revision);
  assert.throws(
    () => startAttempt({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      executionUnitId: "orders/api",
      input: {
        userRequest: "Assess selected repositories",
        phaseApproved: true,
        decisions: CONFIGURED_DECISIONS,
      },
      invocationId: "22222222-2222-4222-8222-222222222222",
    }),
    (error) => error.code === "attempt_artifact_conflict",
  );
});

test("commit rejects request identity tampering before validation", (t) => {
  const fixture = createFixture(t);
  const started = start(fixture);
  const original = JSON.parse(fs.readFileSync(started.requestPath, "utf8"));

  fs.writeFileSync(started.requestPath, `${JSON.stringify({ ...original, repoId: "billing" }, null, 2)}\n`);
  assert.throws(
    () => commitAttempt({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      requestPath: started.requestPath,
    }),
    (error) => error.code === "attempt_request_mismatch" && /repoId/.test(error.message),
  );

  fs.writeFileSync(started.requestPath, `${JSON.stringify({ ...original, batchId: "other-batch" }, null, 2)}\n`);
  assert.throws(
    () => commitAttempt({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      requestPath: started.requestPath,
    }),
    (error) => error.code === "attempt_request_mismatch" && /batchId/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(path.dirname(started.requestPath), "validation.json")), false);
  assert.equal(readState(fixture.batchRoot).executionUnits[0].status, "running");
});

test("lease session releases ownership when the initial attempt cannot start", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-lease-start-failure-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspacePath = path.join(root, "orders");
  fs.mkdirSync(workspacePath);
  const batchRoot = path.join(root, ".github", "modernize", "batches", "lease-start-failure");
  initializeAssessmentBatch({
    batchRoot,
    resolvedConfig: resolvedConfig(root, [{
      repoId: "orders",
      workspacePath,
      executionUnits: [assessmentUnit({ repoId: "orders", workspacePath, language: "java" })],
    }]),
    selection: { executionUnitIds: ["orders"], approvedNeedsAttention: [] },
    input: {
      batchId: "lease-start-failure",
      userRequest: "Assess orders",
      phaseApproved: true,
      inputArtifacts: {},
      decisions: { domains: ["cloud-readiness"], analysisCoverage: "issue-only", maxConcurrency: 1 },
    },
  });

  await assert.rejects(
    openLeaseSession({
      batchRoot,
      invocationId: "failed-session",
      executionUnitId: "unknown-unit",
    }),
    /not scheduled/,
  );
  assert.equal(readLease(batchRoot), null);
  assert.equal(readState(batchRoot).status, "ready");
});

test("start replay repairs state and event after request persistence", (t) => {
  const fixture = createFixture(t);
  assert.throws(
    () => startAttempt({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      executionUnitId: "orders/api",
      input: {
        userRequest: "Assess selected repositories",
        phaseApproved: true,
        decisions: CONFIGURED_DECISIONS,
      },
      invocationId: "33333333-3333-4333-8333-333333333333",
      checkpoint: (step) => {
        if (step === "request") throw new Error("simulated crash after request");
      },
    }),
    /simulated crash after request/,
  );
  assert.equal(readState(fixture.batchRoot).executionUnits[0].status, "pending");

  assert.throws(
    () => startAttempt({
      batchRoot: fixture.batchRoot,
      ownerToken: fixture.ownerToken,
      executionUnitId: "orders/api",
      input: {
        userRequest: "Assess selected repositories",
        phaseApproved: true,
        decisions: CONFIGURED_DECISIONS,
      },
      checkpoint: (step) => {
        if (step === "state") throw new Error("simulated crash after start state");
      },
    }),
    /simulated crash after start state/,
  );
  assert.equal(readState(fixture.batchRoot).executionUnits[0].status, "running");
  assert.equal(fs.readFileSync(path.join(fixture.batchRoot, "events.jsonl"), "utf8"), "");

  const recovered = startAttempt({
    batchRoot: fixture.batchRoot,
    ownerToken: fixture.ownerToken,
    executionUnitId: "orders/api",
    input: {
      userRequest: "Assess selected repositories",
      phaseApproved: true,
      decisions: CONFIGURED_DECISIONS,
    },
  });
  assert.equal(recovered.request.invocationId, "33333333-3333-4333-8333-333333333333");
  assert.equal(recovered.state.executionUnits[0].status, "running");
  const replayed = startAttempt({
    batchRoot: fixture.batchRoot,
    ownerToken: fixture.ownerToken,
    executionUnitId: "orders/api",
    input: {
      userRequest: "Assess selected repositories",
      phaseApproved: true,
      decisions: CONFIGURED_DECISIONS,
    },
  });
  assert.equal(replayed.state.revision, recovered.state.revision);
  const events = fs.readFileSync(path.join(fixture.batchRoot, "events.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.type === "attempt_started").length, 1);
});

test("initialization derives pending units only from approved preflight selections", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-initialize-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(workspacePath);
  const unit = {
    schemaVersion: 1,
    repoId: "orders",
    executionUnitId: "orders",
    displayName: "orders",
    workspacePath,
    gitRoot: workspacePath,
    scopeRoots: [workspacePath],
    languages: ["java"],
    source: "repository-root",
  };
  const resolvedConfig = {
    schemaVersion: 1,
    configPath: path.join(root, "repos.json"),
    configSha256: "a".repeat(64),
    producer: null,
    repositories: [{
      repoId: "orders",
      name: "orders",
      input: { url: null, path: workspacePath, branch: null, includePaths: [] },
      workspacePath,
      preflightStatus: "needs_attention",
      warnings: ["local non-Git workspace"],
      errors: [],
      executionUnits: [unit],
      unknownFields: {},
    }],
    apps: [],
    unknownFields: {},
  };
  const input = {
    batchId: "batch-approved",
    userRequest: "Assess orders",
    phaseApproved: true,
    inputArtifacts: {},
    decisions: { domains: ["cloud-readiness"], analysisCoverage: "issue-only", maxConcurrency: 1 },
  };
  assert.throws(
    () => initializeAssessmentBatch({
      batchRoot: path.join(root, "unapproved"),
      resolvedConfig,
      selection: { executionUnitIds: ["orders"], approvedNeedsAttention: [] },
      input,
    }),
    /explicit attention approval/,
  );

  const initialized = initializeAssessmentBatch({
    batchRoot: path.join(root, "approved"),
    resolvedConfig,
    selection: { executionUnitIds: ["orders"], approvedNeedsAttention: ["orders"] },
    input,
    now: "2026-08-17T11:00:00.000Z",
  });
  assert.equal(initialized.state.status, "ready");
  assert.equal(initialized.state.executionUnits[0].status, "pending");
  assert.deepEqual(initialized.manifest.selectedExecutionUnitIds, ["orders"]);
});

test("Java, .NET, and TypeScript attempts use their Single defaults", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-mixed-assessment-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const specifications = [
    {
      repoId: "java-orders",
      language: "java",
      status: "completed",
      trackedFindings: 3,
      bySeverity: { critical: 1, high: 1, medium: 1, low: 0, info: 0 },
      byState: { new: 2, accepted: 1 },
      topRecommendation: {
        kind: "security",
        summary: "Address critical Java vulnerability",
        next_action: "create-modernization-plan",
        prefilled_prompt: "Fix the Java vulnerability",
      },
    },
    {
      repoId: "dotnet-billing",
      language: "dotnet",
      status: "completed_with_issues",
      trackedFindings: 2,
      bySeverity: { critical: 0, high: 1, medium: 0, low: 1, info: 0 },
      byState: { new: 1, resolved: 1 },
      topRecommendation: {
        kind: "readiness",
        summary: "Move billing configuration out of process",
        next_action: "create-modernization-plan",
        prefilled_prompt: "Plan billing configuration migration",
      },
    },
    {
      repoId: "typescript-portal",
      language: "typescript",
      status: "completed",
      trackedFindings: 1,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 1 },
      byState: { new: 1 },
      topRecommendation: {
        kind: "generic",
        summary: "Update the portal dependencies",
        next_action: null,
        prefilled_prompt: null,
      },
    },
  ];
  const repositories = specifications.map((specification) => {
    const workspacePath = path.join(root, specification.repoId);
    fs.mkdirSync(workspacePath);
    return {
      repoId: specification.repoId,
      workspacePath,
      executionUnits: [assessmentUnit({
        repoId: specification.repoId,
        workspacePath,
        language: specification.language,
      })],
    };
  });
  const batchRoot = path.join(root, ".github", "modernize", "batches", "mixed-assessment");
  initializeAssessmentBatch({
    batchRoot,
    resolvedConfig: resolvedConfig(root, repositories),
    selection: { executionUnitIds: specifications.map(({ repoId }) => repoId), approvedNeedsAttention: [] },
    input: {
      batchId: "mixed-assessment",
      userRequest: "Assess all selected repositories",
      phaseApproved: true,
      inputArtifacts: {},
      decisions: { analysisCoverage: "full", maxConcurrency: 1 },
    },
    now: "2026-08-17T14:00:00.000Z",
  });
  const { ownerToken } = acquireLease({ batchRoot, invocationId: "mixed-coordinator" });
  const requestDirectories = [];

  for (const [index, specification] of specifications.entries()) {
    const started = startAttempt({
      batchRoot,
      ownerToken,
      executionUnitId: specification.repoId,
      invocationId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      now: `2026-08-17T14:0${index}:00.000Z`,
    });
    requestDirectories.push(path.dirname(started.requestPath));
    assert.deepEqual(started.request.decisions.domains, [
      ["java-upgrade", "cloud-readiness"],
      ["cloud-readiness"],
      [],
    ][index]);
    assert.equal(readState(batchRoot).executionUnits.filter((unit) => unit.status === "running").length, 1);
    const artifacts = createAssessmentArtifacts(started, specification.repoId, specification);
    publishAttemptResult({
      requestPath: started.requestPath,
      outcome: {
        status: specification.status,
        artifacts,
        evidence: {
          artifactValidation: "passed",
          ...(specification.language === "typescript" ? { planningSupported: false } : {}),
        },
        needsInput: null,
        error: null,
      },
      now: `2026-08-17T14:0${index}:30.000Z`,
    });
    const committed = commitAttempt({
      batchRoot,
      ownerToken,
      requestPath: started.requestPath,
      now: `2026-08-17T14:0${index}:45.000Z`,
    });
    assert.equal(committed.validation.valid, true, committed.validation.errors.join("\n"));
  }

  assert.equal(new Set(requestDirectories).size, specifications.length);
  assert.deepEqual(
    readState(batchRoot).executionUnits.map(({ status }) => status),
    ["completed", "completed_with_issues", "completed"],
  );
  const typescriptResult = JSON.parse(fs.readFileSync(
    path.join(requestDirectories[2], "result.json"),
    "utf8",
  ));
  assert.equal(typescriptResult.evidence.planningSupported, false);

  const finalized = finalizeAssessmentBatch({
    batchRoot,
    ownerToken,
    now: "2026-08-17T14:04:00.000Z",
  });
  assert.equal(finalized.summary.status, "completed_with_issues");
  assert.deepEqual(finalized.summary.counts, {
    total: 3,
    completed: 2,
    completedWithIssues: 1,
    failed: 0,
  });
  const aggregate = JSON.parse(fs.readFileSync(finalized.paths.aggregateReport, "utf8"));
  const extension = aggregate.extensions["github-copilot-modernization"];
  assert.equal(extension.counts.total, 3);
  assert.deepEqual(extension.counts.bySeverity, {
    critical: 1,
    high: 2,
    medium: 1,
    low: 1,
    info: 1,
  });
  assert.deepEqual(extension.counts.byState, { accepted: 1, new: 4, resolved: 1 });
  assert.deepEqual(extension.planningSupported, { supported: 2, unsupported: 1, unavailable: 0 });
  assert.deepEqual(
    extension.topRecommendations.map(({ identity, summary }) => ({ identity, summary })),
    [
      { identity: "java-orders", summary: "Address critical Java vulnerability" },
      { identity: "dotnet-billing", summary: "Move billing configuration out of process" },
      { identity: "typescript-portal", summary: "Update the portal dependencies" },
    ],
  );
  assert.equal(extension.repositories[0].planningSupported, true);
  assert.equal(extension.repositories[2].planningSupported, false);
  assert.deepEqual(extension.repositories[0].findings.byState, { accepted: 1, new: 2 });
  assert.equal(extension.repositories[0].topRecommendation.summary, "Address critical Java vulnerability");
  assert.equal(aggregate.summary.totalProjects, 3);
  assert.deepEqual(
    extension.repositories.map(({ status }) => status),
    ["completed", "completed_with_issues", "completed"],
  );
  assert.equal(aggregate.metadata.repos[2].language, "typescript");
  assert.deepEqual(finalized.summary.findings.bySeverity, extension.counts.bySeverity);
  assert.deepEqual(finalized.summary.findings.byState, extension.counts.byState);
  assert.deepEqual(finalized.summary.planningSupported, extension.planningSupported);
  assert.match(fs.readFileSync(finalized.paths.reportIndex, "utf8"), /Address critical Java vulnerability/);
  assert.match(fs.readFileSync(finalized.paths.markdown, "utf8"), /Critical: 1/);
});

test("initialization rejects a mixed-language execution unit before state creation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-mixed-language-unit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(workspacePath);
  const batchRoot = path.join(root, "batch");
  const repository = {
    repoId: "mixed",
    workspacePath,
    executionUnits: [{
      ...assessmentUnit({ repoId: "mixed", workspacePath, language: "java" }),
      languages: ["java", "typescript"],
    }],
  };

  assert.throws(
    () => initializeAssessmentBatch({
      batchRoot,
      resolvedConfig: resolvedConfig(root, [repository]),
      selection: { executionUnitIds: ["mixed"], approvedNeedsAttention: [] },
      input: {
        batchId: "mixed-language-unit",
        userRequest: "Assess mixed",
        phaseApproved: true,
        decisions: { analysisCoverage: "issue-only", maxConcurrency: 1 },
      },
    }),
    /exactly one supported language/,
  );
  assert.equal(fs.existsSync(path.join(batchRoot, "manifest.json")), false);
  assert.equal(fs.existsSync(path.join(batchRoot, "state.json")), false);
});

test("initialization rejects unknown decisions before state creation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-unknown-decision-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(workspacePath);
  const batchRoot = path.join(root, "batch");
  const repository = {
    repoId: "orders",
    workspacePath,
    executionUnits: [assessmentUnit({ repoId: "orders", workspacePath, language: "java" })],
  };

  assert.throws(
    () => initializeAssessmentBatch({
      batchRoot,
      resolvedConfig: resolvedConfig(root, [repository]),
      selection: { executionUnitIds: ["orders"], approvedNeedsAttention: [] },
      input: {
        batchId: "unknown-decision",
        userRequest: "Assess orders",
        phaseApproved: true,
        decisions: {
          domains: ["cloud-readiness"],
          analysisCoverage: "issue-only",
          maxConcurrency: 1,
          repositoryScheduling: "sequential",
        },
      },
    }),
    /unsupported fields: repositoryScheduling/,
  );
  assert.equal(fs.existsSync(path.join(batchRoot, "manifest.json")), false);
  assert.equal(fs.existsSync(path.join(batchRoot, "state.json")), false);
});

test("initialization rejects include-path units before creating batch state", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-include-paths-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gitRoot = path.join(root, "portfolio");
  const apiPath = path.join(gitRoot, "services", "api");
  const webPath = path.join(gitRoot, "services", "web");
  fs.mkdirSync(apiPath, { recursive: true });
  fs.mkdirSync(webPath, { recursive: true });
  const units = [
    assessmentUnit({
      repoId: "portfolio",
      executionUnitId: "portfolio/services-api",
      workspacePath: apiPath,
      gitRoot,
      language: "java",
      source: "include-path",
    }),
    assessmentUnit({
      repoId: "portfolio",
      executionUnitId: "portfolio/services-web",
      workspacePath: webPath,
      gitRoot,
      language: "typescript",
      source: "include-path",
    }),
  ];
  const batchRoot = path.join(root, "batch");
  assert.throws(
    () => initializeAssessmentBatch({
      batchRoot,
      resolvedConfig: resolvedConfig(root, [{
        repoId: "portfolio",
        workspacePath: gitRoot,
        executionUnits: units,
        includePaths: ["services/api", "services/web"],
      }]),
      selection: {
        executionUnitIds: units.map(({ executionUnitId }) => executionUnitId),
        approvedNeedsAttention: [],
      },
      input: {
        batchId: "include-paths",
        userRequest: "Assess both portfolio services",
        phaseApproved: true,
        inputArtifacts: {},
        decisions: { domains: ["cloud-readiness"], analysisCoverage: "issue-only", maxConcurrency: 1 },
      },
    }),
    (error) => error.code === "unsupported_execution_unit_source"
      && /portfolio\/services-api/.test(error.message)
      && /whole repositories only/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(batchRoot, "manifest.json")), false);
  assert.equal(fs.existsSync(path.join(batchRoot, "state.json")), false);
  assert.equal(fs.existsSync(path.join(batchRoot, "events.jsonl")), false);

  const cliRoot = path.join(root, "cli");
  const resolvedPath = path.join(root, "resolved.json");
  const selectionPath = path.join(root, "selection.json");
  const inputPath = path.join(root, "input.json");
  fs.writeFileSync(resolvedPath, `${JSON.stringify(resolvedConfig(root, [{
    repoId: "portfolio",
    workspacePath: gitRoot,
    executionUnits: units,
    includePaths: ["services/api", "services/web"],
  }]), null, 2)}\n`);
  fs.writeFileSync(selectionPath, `${JSON.stringify({
    executionUnitIds: [units[0].executionUnitId],
    approvedNeedsAttention: [],
  }, null, 2)}\n`);
  fs.writeFileSync(inputPath, `${JSON.stringify({
    batchId: "include-path-cli",
    userRequest: "Assess one portfolio service",
    phaseApproved: true,
    inputArtifacts: {},
    decisions: { domains: ["cloud-readiness"], analysisCoverage: "issue-only", maxConcurrency: 1 },
  }, null, 2)}\n`);
  const cliResult = runBatchAttemptCli([
    "initialize-assessment",
    "--batch-root", cliRoot,
    "--resolved", resolvedPath,
    "--selection", selectionPath,
    "--input", inputPath,
  ]);
  assert.equal(cliResult.status, 1);
  assert.match(cliResult.stderr, /unsupported_execution_unit_source/);
  assert.equal(fs.existsSync(path.join(cliRoot, "manifest.json")), false);
});
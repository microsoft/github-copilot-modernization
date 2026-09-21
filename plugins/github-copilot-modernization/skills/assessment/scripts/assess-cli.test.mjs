import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { loadMemory, parseYaml, verifyAssessmentArtifacts } from "./assess-cli.mjs";

const temporaryDirectories = [];
const scriptPath = fileURLToPath(new URL("./assess-cli.mjs", import.meta.url));

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "assess-cli-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeFile(directory, name, content) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), content, "utf8");
}

function writeAssessmentIntent(workspacePath, runId, coverage = "issue-only", source = "default") {
  writeFile(
    path.join(workspacePath, ".github", "modernize", ".memory", "runs", runId),
    "intent.yaml",
    `version: 1\nanalysis_coverage: ${JSON.stringify(coverage)}\ncoverage_source: ${JSON.stringify(source)}\n`,
  );
}

function canonicalReport(runId, domains, language = "java") {
  return {
    version: "1.0.0",
    producer: "GitHub Copilot Modernization Plugin",
    metadata: {
      id: runId,
      name: `Report_${runId}`,
      status: "completed",
      domains,
      mode: "issue-only",
      minimumCveSeverity: "high",
      cveScanScope: "direct",
      capabilities: language === "java" ? ["openjdk25"] : [],
      os: language === "java" ? ["windows", "linux"] : [],
    },
    summary: { totalProjects: 1, totalIssues: 0, totalIncidents: 0, totalEffort: 0 },
    projects: [{ path: ".", properties: { appName: "test" }, incidents: [] }],
    rules: {},
    security: [],
  };
}

function normalizedAssessment(runId, domains, findings = [], language = "java") {
  return {
    schemaVersion: 1,
    kind: "github-copilot-modernization/normalized-assessment",
    metadata: {
      id: runId,
      runId,
      language,
      status: "completed",
      domains,
      totalFindings: findings.length,
      totalActionableFindings: findings.length,
      totalTrackedFindings: findings.length,
    },
    categories: [],
    findings,
    security: [],
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("parseYaml handles nested mappings, sequences, and block scalars", () => {
  const parsed = parseYaml(`
version: 1
patches:
  - id: bp-0001
    actual: |
      Use App Service.
      Do not add containers.
    applies_to:
      skills: [assessment, create-modernization-plan]
      intents:
        - cloud-readiness
        - full
`);

  assert.equal(parsed.version, 1);
  assert.equal(parsed.patches[0].id, "bp-0001");
  assert.equal(
    parsed.patches[0].actual,
    "Use App Service.\nDo not add containers.",
  );
  assert.deepEqual(parsed.patches[0].applies_to.intents, [
    "cloud-readiness",
    "full",
  ]);
  assert.deepEqual(parsed.patches[0].applies_to.skills, [
    "assessment",
    "create-modernization-plan",
  ]);
});

test("loadMemory emits the first-run protocol without creating files", () => {
  const parent = createTemporaryDirectory();
  const memoryDir = path.join(parent, "missing-memory");
  const result = loadMemory({
    memoryDir,
    now: new Date("2026-08-11T12:34:56Z"),
  });

  assert.equal(
    result.greeting,
    "First assessment in this repo. I'll set up .memory/ as we go.",
  );
  assert.deepEqual(result.payload, { patches: [] });
  assert.equal(
    result.receipt,
    "loaded@2026-08-11T12:34:56Z findings=0 patches=0/0 suppressions=0",
  );
  assert.equal(fs.existsSync(memoryDir), false);
});

test("loadMemory filters patches by intent and honors the configured cap", () => {
  const memoryDir = createTemporaryDirectory();
  writeFile(
    memoryDir,
    "findings.yaml",
    "version: 1\nfindings:\n  - id: finding-1\n  - id: finding-2\n",
  );
  writeFile(
    memoryDir,
    "suppressions.yaml",
    "version: 1\nrules:\n  - id: rule-1\n",
  );
  writeFile(
    memoryDir,
    "preferences.yaml",
    `version: 1
behavior:
  bias_patches:
    max_loaded_per_run: 1
`,
  );
  writeFile(
    memoryDir,
    "last-intent.yaml",
    "version: 1\nuser_concern: cloud-readiness\n",
  );
  writeFile(
    memoryDir,
    "bias-patches.yaml",
    `version: 1
patches:
  - id: bp-0001
    state: active
    captured_at: 2026-08-01T00:00:00Z
    actual: Use App Service.
    applies_to:
      skills: [assessment, create-modernization-plan]
      intents: [cloud-readiness, full]
  - id: bp-0002
    state: active
    captured_at: 2026-08-02T00:00:00Z
    actual: Keep the database external.
    applies_to:
      intents:
        - cloud-readiness
  - id: bp-0003
    state: active
    captured_at: 2026-08-03T00:00:00Z
    actual: Security only.
    applies_to:
      intents:
        - security
  - id: bp-0004
    state: retired
    actual: Old preference.
`,
  );

  const result = loadMemory({
    memoryDir,
    intent: "cloud-readiness",
    now: new Date("2026-08-11T12:34:56Z"),
  });

  assert.equal(result.payload.patches.length, 1);
  assert.equal(result.payload.patches[0].id, "bp-0002");
  assert.deepEqual(result.payload.patches[0].applies_to.intents, [
    "cloud-readiness",
  ]);
  assert.match(result.greeting, /Loaded 2 known findings/);
  assert.match(result.greeting, /1 active suppression rules/);
  assert.match(result.greeting, /1 additional active patches not loaded/);
  assert.match(result.greeting, /1 retired patches in archive/);
  assert.equal(
    result.receipt,
    "loaded@2026-08-11T12:34:56Z findings=2 patches=1/3 suppressions=1",
  );
});

test("load-memory command runs through the Node executable", () => {
  const parent = createTemporaryDirectory();
  const memoryDir = path.join(parent, "missing-memory");
  const result = spawnSync(
    process.execPath,
    [scriptPath, "load-memory", "--memory-dir", memoryDir, "--intent", "unknown"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^=== GREETING ===$/m);
  assert.match(result.stdout, /findings=0 patches=0\/0 suppressions=0/);
});

test("bootstrap creates an independent Assessment runtime in every target workspace", () => {
  const parent = createTemporaryDirectory();
  const workspaces = ["java", "dotnet", "typescript"].map((name) => path.join(parent, name));
  const destinations = workspaces.map((workspacePath) => {
    fs.mkdirSync(workspacePath);
    const result = spawnSync(
      process.execPath,
      [scriptPath, "bootstrap", "--workspace-path", workspacePath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).destination;
  });

  assert.equal(new Set(destinations).size, workspaces.length);
  for (const [index, destination] of destinations.entries()) {
    assert.equal(
      destination,
      path.join(workspaces[index], ".github", "modernize", ".runtime", "assessment"),
    );
    assert.equal(fs.existsSync(path.join(destination, "assess-cli.mjs")), true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(destination, "solution-mapping.json"), "utf8")),
      JSON.parse(fs.readFileSync(path.resolve(path.dirname(scriptPath), "..", "resources", "solution-mapping.json"), "utf8")),
    );
    assert.equal(fs.readFileSync(path.join(destination, ".gitignore"), "utf8"), "*\n!.gitignore\n");
  }
});

test("a bootstrapped runtime can bootstrap another workspace with solution mapping", () => {
  const parent = createTemporaryDirectory();
  const firstWorkspace = path.join(parent, "first");
  const secondWorkspace = path.join(parent, "second");
  fs.mkdirSync(firstWorkspace);
  fs.mkdirSync(secondWorkspace);
  const first = spawnSync(
    process.execPath,
    [scriptPath, "bootstrap", "--workspace-path", firstWorkspace],
    { encoding: "utf8" },
  );
  assert.equal(first.status, 0, first.stderr);
  const runtimeCli = JSON.parse(first.stdout).cliPath;
  const second = spawnSync(
    process.execPath,
    [runtimeCli, "bootstrap", "--workspace-path", secondWorkspace],
    { encoding: "utf8" },
  );
  assert.equal(second.status, 0, second.stderr);
  const secondRuntime = JSON.parse(second.stdout).destination;
  assert.equal(fs.existsSync(path.join(secondRuntime, "solution-mapping.json")), true);
});

test("prepare-run CLI passes batch scratch and concurrency options", () => {
  const workspacePath = createTemporaryDirectory();
  const attemptScratchRoot = path.join(workspacePath, "batch", "attempt-1");
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "prepare-run",
      "--workspace-path", workspacePath,
      "--run-id", "20260817-130000",
      "--language", "java",
      "--domains", "security",
      "--coverage", "full",
      "--attempt-scratch-root", attemptScratchRoot,
      "--max-concurrency", "1",
      "--target-runtime", "java-21",
      "--target-compute-services", "azure-container-apps,app-service",
      "--enable-containerization", "true",
      "--target-os", "linux",
      "--minimum-cve-severity", "high",
      "--cve-scan-scope", "all",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.attemptScratchRoot, path.resolve(attemptScratchRoot));
  assert.equal(plan.coverageSource, "approved-batch");
  assert.equal(fs.statSync(attemptScratchRoot).isDirectory(), true);
  assert.deepEqual(plan.batches.map((batch) => batch.maxConcurrency), [1, 1]);
  assert.deepEqual(plan.assessmentConfig, {
    targetRuntime: "java-21",
    targetComputeServices: ["azure-container-apps", "app-service"],
    enableContainerization: true,
    targetOS: ["linux"],
    minimumCveSeverity: "high",
    cveScanScope: "all",
  });
  assert.equal(
    plan.batches.flatMap((batch) => batch.tasks).every(
      (taskEntry) => !path.relative(attemptScratchRoot, taskEntry.outputPath).startsWith(".."),
    ),
    true,
  );
});

test("prepare-run distinguishes default and explicit full coverage", () => {
  const workspacePath = createTemporaryDirectory();
  const defaultResult = spawnSync(
    process.execPath,
    [
      scriptPath,
      "prepare-run",
      "--workspace-path", workspacePath,
      "--run-id", "20260904-100000",
      "--language", "java",
      "--coverage-source", "default",
    ],
    { encoding: "utf8" },
  );
  assert.equal(defaultResult.status, 0, defaultResult.stderr);
  const defaultPlan = JSON.parse(defaultResult.stdout);
  assert.equal(defaultPlan.analysisCoverage, "issue-only");
  assert.equal(defaultPlan.coverageSource, "default");
  assert.equal(defaultPlan.batches.some((batch) => batch.id === "facts"), false);

  const fullResult = spawnSync(
    process.execPath,
    [
      scriptPath,
      "prepare-run",
      "--workspace-path", workspacePath,
      "--run-id", "20260904-100001",
      "--language", "java",
      "--coverage", "full",
      "--coverage-source", "explicit-user",
    ],
    { encoding: "utf8" },
  );
  assert.equal(fullResult.status, 0, fullResult.stderr);
  const fullPlan = JSON.parse(fullResult.stdout);
  assert.equal(fullPlan.analysisCoverage, "full");
  assert.equal(fullPlan.coverageSource, "explicit-user");
  assert.equal(fullPlan.batches.find((batch) => batch.id === "facts").tasks.length, 6);

  const untrustedFull = spawnSync(
    process.execPath,
    [
      scriptPath,
      "prepare-run",
      "--workspace-path", workspacePath,
      "--run-id", "20260904-100002",
      "--language", "java",
      "--coverage", "full",
    ],
    { encoding: "utf8" },
  );
  assert.equal(untrustedFull.status, 2);
  assert.match(untrustedFull.stderr, /Full coverage requires an explicit-user or approved-batch source/);
});

test("verify-artifacts rejects a success claim without persisted reports", () => {
  const workspacePath = createTemporaryDirectory();
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "verify-artifacts",
      "--workspace-path", workspacePath,
      "--run-id", "20260831-120000",
      "--language", "java",
      "--domains", "java-upgrade,cloud-readiness",
      "--coverage", "issue-only",
      "--report", path.join(workspacePath, "missing-report.json"),
      "--normalized-assessment", path.join(workspacePath, "missing-normalized-assessment.json"),
      "--html", path.join(workspacePath, "missing-report.html"),
      "--appcat-report", path.join(workspacePath, "missing-appcat.json"),
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /report artifact does not exist/);
});

test("verify-artifacts returns counts only from valid on-disk artifacts", async () => {
  const workspacePath = createTemporaryDirectory();
  const runId = "20260831-120001";
  const outcomePath = path.join(workspacePath, "attempt", "outcome.json");
  const domains = ["java-upgrade", "cloud-readiness"];
  const reportPath = path.join(workspacePath, ".github", "modernize", "assessment", "reports", `report-${runId}`, "report.json");
  const normalizedAssessmentPath = path.join(workspacePath, ".github", "modernize", ".memory", "runs", runId, "normalized-assessment.json");
  const htmlPath = path.join(workspacePath, ".github", "modernize", "reports", `${runId}-assess.html`);
  const appcatPath = path.join(workspacePath, ".github", "modernize", ".memory", "runs", runId, "appcat", "report.json");
  const report = canonicalReport(runId, domains);
  const normalized = normalizedAssessment(
    runId,
    domains,
    [{ id: "finding-1", severity: "high", state: "new" }],
  );
  const htmlPayload = {
    meta: { run_id: runId },
    selected_groups: domains,
    counts: { total: 1 },
    top_recommendation: { summary: "Address finding-1" },
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(normalizedAssessmentPath), { recursive: true });
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.mkdirSync(path.dirname(appcatPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report)}\n`, "utf8");
  fs.writeFileSync(normalizedAssessmentPath, `${JSON.stringify(normalized)}\n`, "utf8");
  fs.writeFileSync(
    htmlPath,
    `<script type="application/json" id="report-data">${JSON.stringify(htmlPayload)}</script>${"x".repeat(10_000)}`,
    "utf8",
  );
  fs.writeFileSync(appcatPath, '{"rules":[]}\n', "utf8");
  writeAssessmentIntent(workspacePath, runId);

  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "verify-artifacts",
      "--workspace-path", workspacePath,
      "--run-id", runId,
      "--language", "java",
      "--domains", domains.join(","),
      "--coverage", "issue-only",
      "--report", reportPath,
      "--normalized-assessment", normalizedAssessmentPath,
      "--html", htmlPath,
      "--appcat-report", appcatPath,
      "--outcome", outcomePath,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, "success");
  assert.equal(receipt.artifactValidation, "passed");
  assert.equal(receipt.completionEvidence.artifactValidation, "passed");
  assert.equal(receipt.completionEvidence.runId, runId);
  assert.equal(receipt.language, "java");
  assert.deepEqual(receipt.domains, domains);
  assert.equal(receipt.analysisCoverage, "issue-only");
  assert.equal(receipt.coverageSource, "default");
  assert.equal(receipt.completionEvidence.coverageSource, "default");
  assert.equal(receipt.planningSupported, true);
  assert.deepEqual(receipt.findingCounts, {
    total: 1,
    tracked: 1,
    bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    byState: { new: 1 },
  });
  assert.deepEqual(receipt.completionEvidence.findingCounts, receipt.findingCounts);
  assert.equal(receipt.artifacts.report, fs.realpathSync.native(reportPath));
  assert.equal(
    receipt.artifacts.normalizedAssessment,
    fs.realpathSync.native(normalizedAssessmentPath),
  );
  assert.equal(receipt.artifacts.html, fs.realpathSync.native(htmlPath));
  assert.equal(receipt.artifacts.appcat, fs.realpathSync.native(appcatPath));
  assert.deepEqual(JSON.parse(fs.readFileSync(outcomePath, "utf8")), {
    status: "completed",
    artifacts: receipt.artifacts,
    evidence: {
      artifactValidation: "passed",
      planningSupported: true,
      language: "java",
      domains,
      analysisCoverage: "issue-only",
      coverageSource: "default",
      findingCounts: receipt.findingCounts,
      topRecommendation: receipt.topRecommendation,
      partialTasks: [],
    },
    needsInput: null,
    error: null,
  });

  writeAssessmentIntent(workspacePath, runId, "issue-only", "inferred");
  await assert.rejects(
    verifyAssessmentArtifacts({
      workspacePath,
      runId,
      language: "java",
      domains,
      analysisCoverage: "issue-only",
      reportPath,
      normalizedAssessmentPath,
      htmlPath,
      appcatReportPath: appcatPath,
    }),
    /unsupported assessment coverage source/,
  );
});

test("verify-artifacts preserves the release report and keeps normalized data internal", () => {
  const workspacePath = createTemporaryDirectory();
  const runId = "20260831-120010";
  const domains = ["java-upgrade", "cloud-readiness"];
  const reportDirectory = path.join(
    workspacePath,
    ".github",
    "modernize",
    "assessment",
    "reports",
    `report-${runId}`,
  );
  const reportPath = path.join(reportDirectory, "report.json");
  const normalizedAssessmentPath = path.join(
    workspacePath,
    ".github",
    "modernize",
    ".memory",
    "runs",
    runId,
    "normalized-assessment.json",
  );
  const htmlPath = path.join(workspacePath, ".github", "modernize", "reports", `${runId}-assess.html`);
  const appcatPath = path.join(workspacePath, ".github", "modernize", ".memory", "runs", runId, "appcat", "report.json");
  const canonicalReport = {
    version: "1.0.0",
    producer: "Java AppCAT CLI",
    metadata: {
      id: runId,
      name: `Report_${runId}`,
      status: "completed",
      domains,
      mode: "issue-only",
      capabilities: ["openjdk25"],
      os: ["windows", "linux"],
      minimumCveSeverity: "high",
      cveScanScope: "direct",
    },
    summary: { totalProjects: 1, totalIssues: 1, totalIncidents: 2, totalEffort: 8 },
    projects: [{
      path: ".",
      issues: 1,
      storyPoints: 8,
      properties: {
        appName: "orders",
        jdkVersion: "17",
        frameworks: ["Spring Boot"],
        languages: ["Java"],
        tools: ["Maven"],
      },
      incidents: [],
    }],
    rules: {},
    security: [],
  };
  const normalizedAssessment = {
    schemaVersion: 1,
    kind: "github-copilot-modernization/normalized-assessment",
    metadata: {
      runId,
      language: "java",
      status: "completed",
      domains,
      totalFindings: 1,
      totalTrackedFindings: 1,
    },
    categories: [],
    findings: [{ id: "finding-1", severity: "high", state: "new" }],
    security: [],
  };
  const htmlPayload = {
    meta: { run_id: runId },
    selected_groups: domains,
    counts: { total: 1 },
    top_recommendation: { summary: "Address finding-1" },
  };
  fs.mkdirSync(reportDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.mkdirSync(path.dirname(appcatPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(canonicalReport)}\n`, "utf8");
  fs.mkdirSync(path.dirname(normalizedAssessmentPath), { recursive: true });
  fs.writeFileSync(normalizedAssessmentPath, `${JSON.stringify(normalizedAssessment)}\n`, "utf8");
  fs.writeFileSync(
    htmlPath,
    `<script type="application/json" id="report-data">${JSON.stringify(htmlPayload)}</script>${"x".repeat(10_000)}`,
    "utf8",
  );
  fs.writeFileSync(appcatPath, '{"version":"1.0.0"}\n', "utf8");
  writeAssessmentIntent(workspacePath, runId);

  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "verify-artifacts",
      "--workspace-path", workspacePath,
      "--run-id", runId,
      "--language", "java",
      "--domains", domains.join(","),
      "--coverage", "issue-only",
      "--report", reportPath,
      "--normalized-assessment", normalizedAssessmentPath,
      "--html", htmlPath,
      "--appcat-report", appcatPath,
      "--presentation", "user",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\*\*Assessment complete\.\*\*/);
  assert.match(result.stdout, /orders/);
  assert.match(result.stdout, /1 issue type across 2 incidents/);
  assert.doesNotMatch(result.stdout, /normalized-assessment\.json/);
  assert.match(result.stdout, /verification\.json/);
  assert.doesNotMatch(result.stdout, /Proceed to planning\?/);
  assert.doesNotMatch(result.stdout, /assessment-verification/);
  assert.doesNotMatch(result.stdout, /"completionEvidence"/);
  const verificationPath = path.join(reportDirectory, "verification.json");
  const receipt = JSON.parse(fs.readFileSync(verificationPath, "utf8"));
  assert.equal(receipt.artifactValidation, "passed");
  assert.equal(receipt.completionEvidence.artifactValidation, "passed");
  assert.equal(receipt.artifacts.report, fs.realpathSync.native(reportPath));
  assert.equal(receipt.artifacts.normalizedAssessment, fs.realpathSync.native(normalizedAssessmentPath));
  assert.equal(receipt.artifacts.verification, fs.realpathSync.native(verificationPath));

  const relativeResult = spawnSync(
    process.execPath,
    [
      scriptPath,
      "verify-artifacts",
      "--workspace-path", workspacePath,
      "--run-id", runId,
      "--language", "java",
      "--domains", domains.join(","),
      "--coverage", "issue-only",
      "--report", path.relative(workspacePath, reportPath),
      "--normalized-assessment", path.relative(workspacePath, normalizedAssessmentPath),
      "--html", path.relative(workspacePath, htmlPath),
      "--appcat-report", path.relative(workspacePath, appcatPath),
      "--presentation", "user",
    ],
    { encoding: "utf8" },
  );

  assert.equal(relativeResult.status, 0, relativeResult.stderr);
  assert.match(relativeResult.stdout, /^\*\*Assessment complete\.\*\*/);
});

test("verify-artifacts rejects malformed, stale, and incomplete report sets", async (t) => {
  const workspacePath = createTemporaryDirectory();
  const runId = "20260831-120002";
  const domains = ["cloud-readiness"];
  const reportPath = path.join(workspacePath, "assessment", "report.json");
  const normalizedAssessmentPath = path.join(workspacePath, "runs", runId, "normalized-assessment.json");
  const htmlPath = path.join(workspacePath, "reports", "report.html");
  const appcatReportPath = path.join(workspacePath, "runs", runId, "appcat", "report.json");
  const report = canonicalReport(runId, domains);
  const normalized = normalizedAssessment(runId, domains);
  const htmlPayload = {
    meta: { run_id: runId },
    selected_groups: domains,
    counts: { total: 0 },
    top_recommendation: { kind: "no-findings", summary: "No findings" },
  };
  const options = {
    workspacePath,
    runId,
    language: "java",
    domains,
    analysisCoverage: "issue-only",
    reportPath,
    normalizedAssessmentPath,
    htmlPath,
    appcatReportPath,
  };
  const writeReport = (value = report) => {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(value)}\n`, "utf8");
    writeAssessmentIntent(workspacePath, runId);
  };
  const writeNormalizedAssessment = (value = normalized) => {
    fs.mkdirSync(path.dirname(normalizedAssessmentPath), { recursive: true });
    fs.writeFileSync(normalizedAssessmentPath, `${JSON.stringify(value)}\n`, "utf8");
  };
  const writeHtml = () => {
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(
      htmlPath,
      `<script type="application/json" id="report-data">${JSON.stringify(htmlPayload)}</script>${"x".repeat(10_000)}`,
      "utf8",
    );
  };

  await t.test("malformed normalized assessment JSON", async () => {
    writeReport();
    writeNormalizedAssessment();
    writeHtml();
    fs.writeFileSync(normalizedAssessmentPath, "{", "utf8");
    await assert.rejects(
      verifyAssessmentArtifacts(options),
      /normalized assessment artifact is not valid JSON/,
    );
  });

  await t.test("unsupported canonical report version", async () => {
    writeReport({ ...report, version: "1.1.0" });
    writeNormalizedAssessment();
    writeHtml();
    await assert.rejects(
      verifyAssessmentArtifacts(options),
      /public report v1\.0\.0 contract/,
    );
  });

  await t.test("mismatched run identity", async () => {
    writeReport();
    writeNormalizedAssessment({
      ...normalized,
      metadata: { ...normalized.metadata, runId: "different-run" },
    });
    writeHtml();
    fs.mkdirSync(path.dirname(appcatReportPath), { recursive: true });
    fs.writeFileSync(appcatReportPath, "{}\n", "utf8");
    await assert.rejects(verifyAssessmentArtifacts(options), /does not match the completed run/);
  });

  await t.test("missing HTML", async () => {
    writeReport();
    writeNormalizedAssessment();
    fs.rmSync(htmlPath, { force: true });
    await assert.rejects(verifyAssessmentArtifacts(options), /HTML report artifact does not exist/);
  });

  await t.test("missing AppCAT", async () => {
    writeReport();
    writeNormalizedAssessment();
    writeHtml();
    fs.rmSync(appcatReportPath, { force: true });
    await assert.rejects(verifyAssessmentArtifacts(options), /AppCAT report artifact does not exist/);
  });
});

test("verify-artifacts rejects non-terminal CVE evidence", async () => {
  const workspacePath = createTemporaryDirectory();
  const runId = "20260831-120003";
  const reportPath = path.join(workspacePath, "assessment", "report.json");
  const normalizedAssessmentPath = path.join(workspacePath, "runs", runId, "normalized-assessment.json");
  const htmlPath = path.join(workspacePath, "reports", "report.html");
  const securityRoot = path.join(workspacePath, "security");
  const domains = ["security"];
  const report = canonicalReport(runId, domains);
  const normalized = normalizedAssessment(runId, domains);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(normalizedAssessmentPath), { recursive: true });
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.mkdirSync(securityRoot, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report)}\n`, "utf8");
  fs.writeFileSync(normalizedAssessmentPath, `${JSON.stringify(normalized)}\n`, "utf8");
  fs.writeFileSync(
    htmlPath,
    `<script type="application/json" id="report-data">${JSON.stringify({
      meta: { run_id: runId },
      selected_groups: domains,
      counts: { total: 0 },
      top_recommendation: null,
    })}</script>${"x".repeat(10_000)}`,
    "utf8",
  );
  writeAssessmentIntent(workspacePath, runId);
  fs.writeFileSync(
    path.join(securityRoot, "cve-known-vulnerabilities.json"),
    '[{"status":"PENDING"}]\n',
    "utf8",
  );
  for (const skillId of [
    "cwe-code-quality",
    "cwe-concurrency-synchronization",
    "cwe-credentials-secrets",
    "cwe-file-path-security",
    "cwe-injection-attacks",
    "cwe-memory-safety",
  ]) {
    fs.writeFileSync(
      path.join(securityRoot, `${skillId}.json`),
      '{"status":"success","result":{"values":[{"status":"NOT_FOUND"}]}}\n',
      "utf8",
    );
  }

  await assert.rejects(
    verifyAssessmentArtifacts({
      workspacePath,
      runId,
      language: "java",
      domains,
      analysisCoverage: "issue-only",
      reportPath,
      normalizedAssessmentPath,
      htmlPath,
      securityRoot,
    }),
    /entry 0 is not FOUND or NOT_FOUND/,
  );
});

test("loadMemory warns on unsupported persisted schema versions", () => {
  const memoryDir = createTemporaryDirectory();
  writeFile(memoryDir, "findings.yaml", "version: 2\nfindings: []\n");

  const result = loadMemory({ memoryDir });

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /unsupported schema version/);
});

test("parseYaml preserves empty collection types", () => {
  assert.deepEqual(parseYaml("mapping: {}\nsequence: []\n"), {
    mapping: {},
    sequence: [],
  });
});
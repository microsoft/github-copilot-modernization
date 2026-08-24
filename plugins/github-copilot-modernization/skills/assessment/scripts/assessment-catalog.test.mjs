import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FACT_SKILL_IDS,
  SECURITY_CWE_SKILL_IDS,
  SECURITY_SKILL_IDS,
  archiveFactFiles,
  buildAssessmentPlan,
  prepareAssessmentRun,
} from "./assessment-catalog.mjs";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const assessmentRoot = path.dirname(scriptsRoot);
const pluginSkillsRoot = path.dirname(assessmentRoot);

test("full coverage contains exactly the six canonical fact skills", () => {
  const plan = buildAssessmentPlan({ analysisCoverage: "full" });
  const facts = plan.batches.find((batch) => batch.id === "facts");

  assert.deepEqual(FACT_SKILL_IDS, [
    "architecture-diagram",
    "dependency-map",
    "api-service-contracts",
    "data-architecture",
    "configuration-inventory",
    "business-workflows",
  ]);
  assert.deepEqual(facts.tasks.map((task) => task.skillId), FACT_SKILL_IDS);
  assert.equal(facts.maxConcurrency, 6);
  assert.equal(plan.maxConcurrentSubagents, 6);
});

test("security contains one CVE task and six CWE category tasks", () => {
  const plan = buildAssessmentPlan({ domains: ["security"] });
  const security = plan.batches.find((batch) => batch.id === "security");

  assert.equal(SECURITY_CWE_SKILL_IDS.length, 6);
  assert.equal(SECURITY_SKILL_IDS.length, 7);
  assert.deepEqual(security.tasks.map((task) => task.skillId), SECURITY_SKILL_IDS);
  assert.equal(security.maxConcurrency, 7);
  assert.equal(plan.maxConcurrentSubagents, 7);
});

test("security and facts stay separate and never require 12-way concurrency", () => {
  const plan = buildAssessmentPlan({
    domains: ["security", "cloud-readiness"],
    analysisCoverage: "full",
  });

  assert.deepEqual(plan.batches.map((batch) => batch.id), ["security", "facts"]);
  assert.deepEqual(plan.batches.map((batch) => batch.maxConcurrency), [7, 6]);
  assert.equal(plan.maxConcurrentSubagents, 7);
});

test("filesystem contains only the canonical fact and security skill inventories", () => {
  const factSkillDirectories = FACT_SKILL_IDS.filter((skillId) =>
    fs.existsSync(path.join(pluginSkillsRoot, skillId, "SKILL.md")));
  const securitySkillDirectories = SECURITY_SKILL_IDS.filter((skillId) =>
    fs.existsSync(path.join(pluginSkillsRoot, skillId, "SKILL.md")));

  assert.deepEqual(factSkillDirectories, FACT_SKILL_IDS);
  assert.deepEqual(securitySkillDirectories, SECURITY_SKILL_IDS);
  assert.equal(fs.existsSync(path.join(assessmentRoot, "security-skills")), false);
});

test("assessment entry points contain no assessment MCP dependency", () => {
  const pluginRoot = path.dirname(pluginSkillsRoot);
  const files = [
    path.join(assessmentRoot, "SKILL.md"),
    path.join(pluginRoot, "agents", "assessment-coordinator.agent.md"),
    path.join(pluginRoot, "agents", "batch-assessment.agent.md"),
    path.join(pluginRoot, "agents", "batch-coordinator.agent.md"),
    path.join(pluginRoot, "agents", "modernize-java-assessment.agent.md"),
    path.join(pluginRoot, "agents", "modernize.agent.md"),
  ];
  const assessmentMcpPattern = /appmod-(?:run-assessment|precheck-assessment|cwe-rules-assessment|cve-assessment)/i;

  for (const filePath of files) {
    assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), assessmentMcpPattern, filePath);
  }
});

test("unknown domains are dropped and invalid coverage is rejected", () => {
  const plan = buildAssessmentPlan({
    domains: ["cloud-readiness", "unknown", "cloud-readiness"],
  });

  assert.deepEqual(plan.domains, ["cloud-readiness"]);
  assert.deepEqual(plan.appcat, ["cloud-readiness"]);
  assert.deepEqual(plan.batches, []);
  assert.throws(
    () => buildAssessmentPlan({ analysisCoverage: "source-only" }),
    /Unsupported analysis coverage/,
  );
});

test("prepare creates one local run and clears only canonical task outputs", (t) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "assessment-catalog-"));
  t.after(() => fs.rmSync(workspacePath, { recursive: true, force: true }));

  const staleFact = path.join(
    workspacePath,
    ".github",
    "modernize",
    "assessment",
    "engines",
    "facts",
    "architecture-diagram.md",
  );
  fs.mkdirSync(path.dirname(staleFact), { recursive: true });
  fs.writeFileSync(staleFact, "stale", "utf8");

  const prepared = prepareAssessmentRun({
    workspacePath,
    runId: "20260812-120000",
    language: "java",
    domains: ["security", "cloud-readiness"],
    analysisCoverage: "full",
  });

  assert.equal(prepared.maxConcurrentSubagents, 7);
  assert.equal(fs.existsSync(staleFact), false);
  assert.equal(fs.existsSync(path.join(prepared.runDir, "intent.yaml")), true);
  assert.equal(fs.existsSync(path.join(prepared.runDir, "selected-skills.yaml")), true);
  assert.equal(fs.existsSync(prepared.findingsPath), true);
});

test("prepare preserves an existing findings document", (t) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "assessment-existing-findings-"));
  t.after(() => fs.rmSync(workspacePath, { recursive: true, force: true }));
  const findingsPath = path.join(workspacePath, ".github", "modernize", ".memory", "findings.yaml");
  const existing = "version: 1\nfindings:\n  - id: existing\n";
  fs.mkdirSync(path.dirname(findingsPath), { recursive: true });
  fs.writeFileSync(findingsPath, existing, "utf8");

  prepareAssessmentRun({
    workspacePath,
    runId: "20260820-120000",
    language: "java",
    domains: ["cloud-readiness"],
  });

  assert.equal(fs.readFileSync(findingsPath, "utf8"), existing);
});

test("batch preparation isolates task outputs and bounds concurrency", (t) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "assessment-batch-"));
  t.after(() => fs.rmSync(workspacePath, { recursive: true, force: true }));

  const canonicalFact = path.join(
    workspacePath,
    ".github",
    "modernize",
    "assessment",
    "engines",
    "facts",
    "architecture-diagram.md",
  );
  fs.mkdirSync(path.dirname(canonicalFact), { recursive: true });
  fs.writeFileSync(canonicalFact, "single-mode-output", "utf8");
  const attemptScratchRoot = path.join(workspacePath, ".github", "modernize", ".batch", "attempt-1");

  const prepared = prepareAssessmentRun({
    workspacePath,
    runId: "20260817-120000",
    language: "java",
    domains: ["security"],
    analysisCoverage: "full",
    attemptScratchRoot,
    maxConcurrency: 1,
    assessmentConfig: {
      targetRuntime: "java-21",
      targetComputeServices: ["azure-container-apps"],
      enableContainerization: true,
      targetOS: ["linux"],
      minimumCveSeverity: "high",
      cveScanScope: "all",
    },
  });

  assert.equal(prepared.attemptScratchRoot, path.resolve(attemptScratchRoot));
  assert.equal(fs.statSync(attemptScratchRoot).isDirectory(), true);
  assert.equal(prepared.maxConcurrentSubagents, 1);
  assert.deepEqual(prepared.assessmentConfig, {
    targetRuntime: "java-21",
    targetComputeServices: ["azure-container-apps"],
    enableContainerization: true,
    targetOS: ["linux"],
    minimumCveSeverity: "high",
    cveScanScope: "all",
  });
  const intent = fs.readFileSync(path.join(prepared.runDir, "intent.yaml"), "utf8");
  assert.match(intent, /assessment_config:/);
  assert.match(intent, /targetRuntime: "java-21"/);
  assert.match(intent, /targetComputeServices:\n    - "azure-container-apps"/);
  assert.match(intent, /enableContainerization: true/);
  assert.match(intent, /targetOS:\n    - "linux"/);
  assert.match(intent, /minimumCveSeverity: "high"/);
  assert.match(intent, /cveScanScope: "all"/);
  assert.deepEqual(prepared.batches.map((batch) => batch.maxConcurrency), [1, 1]);
  assert.equal(fs.readFileSync(canonicalFact, "utf8"), "single-mode-output");
  for (const taskEntry of prepared.batches.flatMap((batch) => batch.tasks)) {
    assert.equal(path.relative(attemptScratchRoot, taskEntry.outputPath).startsWith(".."), false);
  }
});

test("concurrency ceilings of one and seven preserve the same Assessment task set", (t) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "assessment-concurrency-"));
  t.after(() => fs.rmSync(workspacePath, { recursive: true, force: true }));
  const taskSignature = (plan) => plan.batches.flatMap((batch) =>
    batch.tasks.map((taskEntry) => `${batch.id}:${taskEntry.skillId}`));

  const sequential = prepareAssessmentRun({
    workspacePath,
    runId: "20260817-121000",
    language: "java",
    domains: ["security"],
    analysisCoverage: "full",
    attemptScratchRoot: path.join(workspacePath, "attempt-sequential"),
    maxConcurrency: 1,
  });
  const maximum = prepareAssessmentRun({
    workspacePath,
    runId: "20260817-122000",
    language: "java",
    domains: ["security"],
    analysisCoverage: "full",
    attemptScratchRoot: path.join(workspacePath, "attempt-maximum"),
    maxConcurrency: 7,
  });

  assert.deepEqual(taskSignature(sequential), taskSignature(maximum));
  assert.deepEqual(sequential.batches.map(({ maxConcurrency }) => maxConcurrency), [1, 1]);
  assert.deepEqual(maximum.batches.map(({ maxConcurrency }) => maxConcurrency), [7, 6]);
});

test("archive requires and copies exactly six fact documents", (t) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "assessment-facts-"));
  t.after(() => fs.rmSync(workspacePath, { recursive: true, force: true }));
  const reportPath = path.join(
    workspacePath,
    ".github",
    "modernize",
    "assessment",
    "reports",
    "report-1",
    "report.json",
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, "{}", "utf8");

  const incomplete = archiveFactFiles({ workspacePath, reportPath, analysisCoverage: "full" });
  assert.deepEqual(incomplete.missing, FACT_SKILL_IDS);

  const sourceDir = path.join(
    workspacePath,
    ".github",
    "modernize",
    "assessment",
    "engines",
    "facts",
  );
  fs.mkdirSync(sourceDir, { recursive: true });
  for (const skillId of FACT_SKILL_IDS) {
    fs.writeFileSync(path.join(sourceDir, `${skillId}.md`), `# ${skillId}\n`, "utf8");
  }

  const complete = archiveFactFiles({ workspacePath, reportPath, analysisCoverage: "full" });
  assert.equal(complete.archived.length, 6);
  assert.deepEqual(complete.missing, []);
  assert.equal(
    fs.existsSync(path.join(path.dirname(reportPath), "facts", "business-workflows.md")),
    true,
  );
});

test("archive reads batch facts from an attempt-scoped root", (t) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "assessment-batch-facts-"));
  t.after(() => fs.rmSync(workspacePath, { recursive: true, force: true }));
  const reportPath = path.join(workspacePath, "reports", "report-1", "report.json");
  const factsRoot = path.join(workspacePath, "attempts", "1", "engines", "facts");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(factsRoot, { recursive: true });
  fs.writeFileSync(reportPath, "{}", "utf8");
  for (const skillId of FACT_SKILL_IDS) {
    fs.writeFileSync(path.join(factsRoot, `${skillId}.md`), `# ${skillId}\n`, "utf8");
  }

  const result = archiveFactFiles({
    workspacePath,
    reportPath,
    analysisCoverage: "full",
    factsRoot,
  });

  assert.equal(result.archived.length, 6);
  assert.equal(fs.existsSync(path.join(path.dirname(reportPath), "facts", "dependency-map.md")), true);
});

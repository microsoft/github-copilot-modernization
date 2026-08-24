import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generateCompatibilityReport,
  integrateAppcatReport,
  readYaml,
  recordAssessmentResult,
  updateFindingStates,
  writeYamlAtomic,
} from "./assess-state.mjs";

const NOW = "2026-08-11T12:00:00.000Z";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "assess-state-"));
  const memoryDir = path.join(root, ".memory");
  const runId = "2026-08-11T12-00-00Z-security";
  const runDir = path.join(memoryDir, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  return { root, memoryDir, runId, runDir, findingsPath: path.join(memoryDir, "findings.yaml") };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
}

test("recordAssessmentResult converts wrapper FOUND values and preserves state", () => {
  const state = fixture();
  const inputPath = path.join(state.root, "cve.json");
  const result = {
    result: {
      values: [
        {
          status: "FOUND",
          cveId: "CVE-2026-1234",
          packageName: "example-lib",
          severity: "mandatory",
          title: "CVE-2026-1234 in example-lib",
          evidence: { files: ["pom.xml:17"] },
        },
        { status: "NOT_FOUND", cveId: "CVE-2026-9999", severity: "critical" },
      ],
    },
  };
  writeJson(inputPath, result);

  recordAssessmentResult({
    skill: "cve-known-vulnerabilities",
    inputPath,
    findingsPath: state.findingsPath,
    runId: state.runId,
    runDir: state.runDir,
    now: NOW,
  });
  const first = readYaml(state.findingsPath);
  assert.equal(first.findings.length, 1);
  assert.equal(first.findings[0].severity, "high");
  assert.equal(first.findings[0].location, "pom.xml");
  assert.equal(first.findings[0].line, 17);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state.runDir, "cve-known-vulnerabilities.json"))), result);

  const originalId = first.findings[0].id;
  result.result.values[0].evidence.files = ["pom.xml:99"];
  writeJson(inputPath, result);
  recordAssessmentResult({
    skill: "cve-known-vulnerabilities",
    inputPath,
    findingsPath: state.findingsPath,
    runId: "moved-line-run",
    runDir: state.runDir,
    now: "2026-08-11T18:00:00.000Z",
  });
  const moved = readYaml(state.findingsPath);
  assert.equal(moved.findings.length, 1);
  assert.equal(moved.findings[0].id, originalId);
  assert.equal(moved.findings[0].line, 99);

  moved.findings[0].state = "acknowledged";
  moved.findings[0].state_reason = "owned by platform team";
  moved.findings[0].first_seen = "2026-08-01T00:00:00.000Z";
  writeYamlAtomic(state.findingsPath, moved);
  recordAssessmentResult({
    skill: "cve-known-vulnerabilities",
    inputPath,
    findingsPath: state.findingsPath,
    runId: "second-run",
    runDir: state.runDir,
    now: "2026-08-12T00:00:00.000Z",
  });
  const merged = readYaml(state.findingsPath).findings[0];
  assert.equal(merged.state, "acknowledged");
  assert.equal(merged.state_reason, "owned by platform team");
  assert.equal(merged.first_seen, "2026-08-01T00:00:00.000Z");
  assert.deepEqual(merged.runs, [state.runId, "moved-line-run", "second-run"]);
});

test("recordAssessmentResult applies suppressions and reopens regressions", () => {
  const state = fixture();
  const inputPath = path.join(state.root, "cwe.json");
  const result = {
    result: {
      values: [{
        id: "CWE-89",
        status: "FOUND",
        severity: "mandatory",
        name: "SQL injection in fixture",
        evidence: { files: ["src/test/Fixture.java:12"], explanation: "Test-only fixture." },
      }],
    },
  };
  writeJson(inputPath, result);
  writeYamlAtomic(path.join(state.memoryDir, "suppressions.yaml"), {
    version: 1,
    rules: [{
      id: "tests",
      description: "Ignore test fixtures",
      match: { location_glob: "**/src/test/**" },
      action: "suppress",
    }],
  });

  recordAssessmentResult({
    skill: "cwe-injection-attacks",
    inputPath,
    findingsPath: state.findingsPath,
    runId: state.runId,
    runDir: state.runDir,
    now: NOW,
  });
  let finding = readYaml(state.findingsPath).findings[0];
  assert.equal(finding.state, "suppressed");
  assert.match(finding.state_reason, /suppression:tests/);

  writeYamlAtomic(path.join(state.memoryDir, "suppressions.yaml"), { version: 1, rules: [] });
  recordAssessmentResult({
    skill: "cwe-injection-attacks",
    inputPath,
    findingsPath: state.findingsPath,
    runId: "without-suppression",
    runDir: state.runDir,
    now: "2026-08-12T00:00:00.000Z",
  });
  finding = readYaml(state.findingsPath).findings[0];
  assert.equal(finding.state, "new");

  finding.state = "resolved";
  finding.state_reason = "fixed";
  writeYamlAtomic(state.findingsPath, { version: 1, findings: [finding] });
  recordAssessmentResult({
    skill: "cwe-injection-attacks",
    inputPath,
    findingsPath: state.findingsPath,
    runId: "regression-run",
    runDir: state.runDir,
    now: "2026-08-13T00:00:00.000Z",
  });
  finding = readYaml(state.findingsPath).findings[0];
  assert.equal(finding.state, "new");
  assert.match(finding.state_reason, /regression/);
});

test("updateFindingStates performs locked explicit transitions", () => {
  const state = fixture();
  writeYamlAtomic(state.findingsPath, {
    version: 1,
    findings: [{ id: "finding-1", skill: "fact-test", state: "new", runs: [state.runId] }],
  });

  const result = updateFindingStates({
    findingsPath: state.findingsPath,
    ids: ["finding-1"],
    state: "acknowledged",
    reason: "Reviewed in sprint planning",
    now: NOW,
  });

  assert.equal(result.changed, 1);
  assert.equal(result.findings[0].state, "acknowledged");
  assert.equal(result.findings[0].state_reason, "Reviewed in sprint planning");
});

test("integrateAppcatReport aggregates rules and drops discovery incidents", () => {
  const state = fixture();
  const reportPath = path.join(state.root, "appcat.json");
  writeJson(reportPath, {
    rules: {
      "azure-aws-config-s3-03000": {
        title: "AWS S3 usage detected",
        description: "Replace AWS S3 with Azure Blob Storage.",
        effort: 5,
        labels: ["category=aws-s3", "domain=cloud-readiness"],
        links: [{ url: "https://example.test/s3", title: "Migration guide" }],
      },
    },
    projects: [{ incidents: [
      {
        ruleId: "azure-aws-config-s3-03000",
        location: "src/S3.java",
        line: 20,
        targets: { "azure-container-apps": { severity: "mandatory" } },
      },
      {
        ruleId: "azure-aws-config-s3-03000",
        location: "src/S3.java",
        line: 41,
        targets: { "azure-container-apps": { severity: "optional" } },
      },
      { ruleId: "discover-java-files-00001", location: "src/S3.java", line: 1 },
      {
        ruleId: "unknown-platform-01000",
        location: "src/Unknown.java",
        line: 5,
        targets: { "azure-container-apps": { severity: "mandatory" } },
      },
    ] }],
  });

  const result = integrateAppcatReport({
    reportPath,
    findingsPath: state.findingsPath,
    runId: state.runId,
    target: "azure-container-apps",
    now: NOW,
  });
  assert.equal(result.incidents, 4);
  assert.equal(result.converted, 2);
  const findings = readYaml(state.findingsPath).findings;
  const finding = findings.find((entry) => entry.skill === "appcat::aws-s3");
  assert.equal(finding.skill, "appcat::aws-s3");
  assert.equal(finding.severity, "high");
  assert.equal(finding.occurrences, 2);
  assert.deepEqual(finding.locations, [
    { file: "src/S3.java", line: 20 },
    { file: "src/S3.java", line: 41 },
  ]);
  assert.match(finding.evidence, /azure-aws-config-s3-03000/);
  const unclassified = findings.find((entry) => entry.title.startsWith("Unclassified:"));
  assert.equal(unclassified.severity, "info");
});

test("generateCompatibilityReport maps AppCAT, CVE, and CWE findings to kbIds", () => {
  const state = fixture();
  writeYamlAtomic(state.findingsPath, {
    version: 1,
    findings: [
      {
        id: "appcat::aws-s3::one",
        skill: "appcat::aws-s3",
        source: "appcat",
        severity: "medium",
        title: "AWS S3 usage",
        evidence: "AppCAT rules: azure-aws-config-s3-03000",
      },
      {
        id: "appcat::aws-s3::second",
        skill: "appcat::aws-s3",
        source: "appcat",
        severity: "medium",
        title: "Another AWS S3 issue",
        evidence: "AppCAT rules: azure-aws-config-s3-03001",
      },
      { id: "cve::two", skill: "cve-known-vulnerabilities", severity: "critical", title: "CVE-2026-1" },
      { id: "cwe::three", skill: "cwe-injection-attacks", severity: "high", title: "CWE-89" },
      { id: "resolved::four", skill: "appcat::aws-s3", source: "appcat", severity: "medium", title: "Resolved S3", evidence: "AppCAT rules: azure-aws-config-s3-03000", state: "resolved" },
      { id: "fact::five", skill: "informational-metadata", severity: "info", title: "Application name: demo", state: "new" },
    ],
  });
  writeYamlAtomic(path.join(state.runDir, "intent.yaml"), { version: 1, user_concern: "security" });
  const mappingPath = path.join(state.root, "solution-mapping.json");
  writeJson(mappingPath, {
    solutions: [
      { solutionId: "s3-to-azure-blob-storage", name: "Migrate S3", tooltip: "Use Blob Storage" },
      { solutionId: "scan-and-resolve-cve-vulnerabilities", name: "Resolve CVEs" },
      { solutionId: "scan-and-resolve-cwe-vulnerabilities", name: "Resolve CWEs" },
    ],
    rules: [
      { ruleId: "azure-aws-config-s3-03000", solution: "s3-to-azure-blob-storage" },
      { ruleId: "azure-aws-config-s3-03001", solution: "s3-to-azure-blob-storage" },
    ],
  });

  const { reportPath, report } = generateCompatibilityReport({
    memoryDir: state.memoryDir,
    runId: state.runId,
    outputDir: path.join(state.root, ".github", "modernize"),
    language: "java",
    solutionMappingPath: mappingPath,
    now: NOW,
  });
  assert.equal(path.basename(path.dirname(reportPath)), "report-20260811120000");
  assert.equal(report.metadata.language, "java");
  assert.equal(report.findings.length, 4);
  assert.equal(report.metadata.totalTrackedFindings, 6);
  assert.equal(report.categories.some((category) => category.sourceSkill === "informational-metadata"), false);
  assert.equal(report.categories.filter((category) => category.sourceSkill === "appcat::aws-s3").length, 2);
  assert.equal(report.security.length, 2);
  const kbIds = report.categories.flatMap((category) => category.solutions.map((solution) => solution.kbId));
  assert.deepEqual(new Set(kbIds), new Set([
    "s3-to-azure-blob-storage",
    "scan-and-resolve-cve-vulnerabilities",
    "scan-and-resolve-cwe-vulnerabilities",
  ]));
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, "utf8")), report);
  assert.equal(readYaml(path.join(state.runDir, "findings.yaml")).findings.length, 6);
});
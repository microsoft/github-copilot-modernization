import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generateCanonicalAssessmentReport,
  generateNormalizedAssessment,
  integrateAppcatReport,
  publishCanonicalAppcatReport,
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

test("generateNormalizedAssessment maps AppCAT, CVE, and CWE findings to kbIds", () => {
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

  const { reportPath, report } = generateNormalizedAssessment({
    memoryDir: state.memoryDir,
    runId: state.runId,
    language: "java",
    solutionMappingPath: mappingPath,
    now: NOW,
  });
  assert.equal(reportPath, path.join(state.runDir, "normalized-assessment.json"));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, "github-copilot-modernization/normalized-assessment");
  assert.equal("version" in report, false);
  assert.equal(report.metadata.language, "java");
  assert.equal(report.findings.length, 4);
  assert.equal(report.metadata.totalFindings, 4);
  assert.equal(report.metadata.totalActionableFindings, 4);
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

test("generateNormalizedAssessment uses one internal run-scoped filename", () => {
  const state = fixture();
  writeYamlAtomic(state.findingsPath, { version: 1, findings: [] });
  writeYamlAtomic(path.join(state.runDir, "intent.yaml"), {
    version: 1,
    captured_at: NOW,
    language: "java",
    selected_groups: ["java-upgrade", "cloud-readiness"],
    analysis_coverage: "issue-only",
  });
  const mappingPath = path.join(state.root, "solution-mapping.json");
  writeJson(mappingPath, { solutions: [], rules: [] });

  const { reportPath } = generateNormalizedAssessment({
    memoryDir: state.memoryDir,
    runId: state.runId,
    language: "java",
    solutionMappingPath: mappingPath,
    now: NOW,
  });

  assert.equal(reportPath, path.join(state.runDir, "normalized-assessment.json"));
  assert.equal(fs.existsSync(reportPath), true);
});

test("publishCanonicalAppcatReport restores the public release report contract", () => {
  const state = fixture();
  writeYamlAtomic(state.findingsPath, {
    version: 1,
    findings: [{
      id: "cve::one",
      skill: "cve-known-vulnerabilities",
      severity: "critical",
      title: "CVE-2026-1",
      location: "pom.xml",
      state: "new",
      rationale: "Upgrade the dependency.",
    }],
  });
  const sourcePath = path.join(state.runDir, "appcat", "report.json");
  const source = {
    version: "1.0.0",
    producer: "Java AppCAT CLI",
    metadata: {
      analysisStartTime: NOW,
      analysisEndTime: "2026-08-11T12:01:00.000Z",
      status: "Complete",
      privacyMode: "Protected",
      privacyModeHelpUrl: "https://aka.ms/appcat-privacy-mode",
      targetIds: ["azure-aks", "azure-appservice", "azure-container-apps"],
      targetDisplayNames: ["AKS", "App Service", "Container Apps"],
      capabilities: [],
      os: [],
    },
    summary: { totalProjects: 1, totalIssues: 1, totalIncidents: 1, totalEffort: 5 },
    projects: [{ path: ".", issues: 1, storyPoints: 5, properties: {}, incidents: [] }],
    rules: {},
  };
  writeJson(sourcePath, source);

  const { reportPath, report } = publishCanonicalAppcatReport({
    sourcePath,
    memoryDir: state.memoryDir,
    outputDir: path.join(state.root, "assessment", "reports"),
    runId: state.runId,
    language: "java",
    domains: ["java-upgrade", "cloud-readiness"],
    analysisCoverage: "issue-only",
  });

  assert.equal(path.basename(path.dirname(reportPath)), "report-20260811120000");
  assert.equal(path.basename(reportPath), "report.json");
  assert.equal(report.version, "1.0.0");
  assert.equal(report.producer, "Java AppCAT CLI");
  assert.equal(report.metadata.id, "20260811120000");
  assert.equal(report.metadata.name, "Report_20260811120000");
  assert.equal(report.metadata.status, "completed");
  assert.deepEqual(report.metadata.domains, ["java-upgrade", "cloud-readiness"]);
  assert.equal(report.metadata.mode, "issue-only");
  assert.equal(report.metadata.minimumCveSeverity, "high");
  assert.equal(report.metadata.cveScanScope, "direct");
  assert.equal(report.security.length, 1);
  assert.equal(report.security[0].id, "cve::one");
  assert.deepEqual(report.metadata.capabilities, ["openjdk25"]);
  assert.deepEqual(report.metadata.os, ["windows", "linux"]);
  assert.equal(report.metadata.privacyModeHelpUrl, "https://aka.ms/appmod-privacy-mode");
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, "utf8")), report);
  assert.deepEqual(JSON.parse(fs.readFileSync(sourcePath, "utf8")), source);
});

test("generateCanonicalAssessmentReport preserves non-AppCAT findings in public shape", () => {
  const state = fixture();
  writeYamlAtomic(state.findingsPath, {
    version: 1,
    findings: [
      {
        id: "ncu::left-pad",
        skill: "javascript-dependency-update",
        source: "ncu",
        severity: "medium",
        title: "Update left-pad",
        location: "package.json",
        line: 4,
        state: "new",
        rationale: "A newer dependency version is available.",
        effort: 2,
      },
      {
        id: "cve::one",
        skill: "cve-known-vulnerabilities",
        source: "osv",
        severity: "critical",
        title: "CVE-2026-1",
        location: "package.json",
        state: "new",
        rationale: "Upgrade the affected dependency.",
      },
    ],
  });

  const { reportPath, report } = generateCanonicalAssessmentReport({
    memoryDir: state.memoryDir,
    outputDir: path.join(state.root, "assessment", "reports"),
    workspacePath: state.root,
    runId: state.runId,
    language: "javascript",
    domains: [],
    analysisCoverage: "issue-only",
    now: NOW,
  });

  assert.equal(path.basename(reportPath), "report.json");
  assert.equal(report.version, "1.0.0");
  assert.equal(report.producer, "GitHub Copilot Modernization Plugin");
  assert.equal(report.metadata.id, "20260811120000");
  assert.equal(report.metadata.status, "completed");
  assert.deepEqual(report.metadata.domains, []);
  assert.equal(report.summary.totalIssues, 2);
  assert.equal(report.summary.totalIncidents, 1);
  assert.equal(report.projects[0].incidents[0].ruleId, "ncu::left-pad");
  assert.equal(report.rules["ncu::left-pad"].title, "Update left-pad");
  assert.equal(report.security[0].id, "cve::one");
});
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateAssessmentReportSet } from "./real-repository-runner.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function completeReportFixture(t) {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "real-assessment-report-"));
  t.after(() => fs.rmSync(workspacePath, { recursive: true, force: true }));
  const runId = "20260817120000";
  const compatibilityPath = path.join(workspacePath, "assessment", "report.json");
  const htmlPath = path.join(workspacePath, "assessment", "report.html");
  const appcatPath = path.join(
    workspacePath,
    ".github",
    "modernize",
    ".memory",
    "runs",
    runId,
    "appcat",
    "report.json",
  );
  const resultPath = path.join(workspacePath, "attempt", "result.json");
  writeJson(compatibilityPath, {
    version: "1.1.0",
    metadata: {
      runId,
      status: "completed",
      language: "java",
      domains: ["cloud-readiness"],
      totalFindings: 1,
      totalActionableFindings: 1,
      totalTrackedFindings: 1,
    },
    categories: [{ category: "cloud" }],
    findings: [{ id: "finding-1" }],
    security: [],
  });
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(
    htmlPath,
    `<html><script type="application/json" id="report-data">{}</script>${"complete".repeat(2_000)}</html>`,
    "utf8",
  );
  writeJson(appcatPath, { rules: [], incidents: [] });
  writeJson(resultPath, {
    status: "completed_with_issues",
    artifacts: { report: compatibilityPath, html: htmlPath },
    evidence: { artifactValidation: "passed" },
  });
  return { workspacePath, resultPath, appcatPath };
}

test("real Assessment completeness accepts complete partial results", (t) => {
  const fixture = completeReportFixture(t);
  const evidence = validateAssessmentReportSet(fixture);
  assert.equal(evidence.status, "complete");
  assert.equal(evidence.assessmentStatus, "completed_with_issues");
  assert.equal(evidence.compatibility.bytes > 0, true);
  assert.equal(evidence.html.bytes > 10_000, true);
  assert.equal(evidence.appcat.bytes > 0, true);
});

test("real Assessment completeness rejects a missing AppCAT report", (t) => {
  const fixture = completeReportFixture(t);
  fs.rmSync(fixture.appcatPath);
  assert.throws(() => validateAssessmentReportSet(fixture), /no AppCAT report/);
});
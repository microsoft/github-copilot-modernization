import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyProductHostBlocker,
  createPermissionDenialController,
  finalProductProbeStatus,
  inheritedUnsupportedProbe,
  reusableProbe,
} from "./product-scenario-runner.mjs";
import { validateProductPackage } from "./product-probe.mjs";

const stageRoot = path.dirname(fileURLToPath(import.meta.url));
const evidencePath = path.join(
  stageRoot,
  "evidence",
  `product-probe.${process.platform}-${process.arch}.json`,
);

function probes(status = "passed") {
  return {
    explicitBatchSuccess: { status },
    defaultConfigBatchSelection: { status },
    defaultConfigSingleSelection: { status },
    cancelBeforeApproval: { status },
    unsupportedBatchPlanning: { status },
    unsupportedBatchExecution: { status },
    naturalChildFailureContinuation: { status },
    missingResultContinuation: { status },
    partialAssessmentContinuation: { status },
  };
}

function failureMatrix(status = "passed") {
  return {
    childFailure: { productHostStatus: status },
    missingResult: { productHostStatus: status, controlPlaneStatus: "passed" },
    partialAssessment: { productHostStatus: status, controlPlaneStatus: "passed" },
  };
}

test("product host failures use stable external blocker codes", () => {
  assert.equal(classifyProductHostBlocker(["exceeded your monthly quota"]), "copilot_quota_exhausted");
  assert.equal(classifyProductHostBlocker(["HTTP status 402"]), "copilot_quota_exhausted");
  assert.equal(classifyProductHostBlocker(["authentication failed"]), "copilot_authentication_failed");
  assert.equal(classifyProductHostBlocker(["ACP session/new failed: Authentication required"], { fallback: false }), "copilot_authentication_failed");
  assert.equal(classifyProductHostBlocker(["ordinary product assertion"], { fallback: false }), null);
  assert.equal(classifyProductHostBlocker(["model gpt-test is unavailable"]), "copilot_model_unavailable");
  assert.equal(classifyProductHostBlocker([]), null);
});

test("permission denial controller rejects one matching call and allows later calls once", () => {
  const controller = createPermissionDenialController("batch-assessment");
  const options = [
    { kind: "allow_once", optionId: "once" },
    { kind: "allow_always", optionId: "always" },
  ];
  assert.deepEqual(controller.handler({
    toolCall: {
      toolCallId: "coordinator",
      title: "Invoke batch-coordinator",
      rawInput: { agent_type: "batch-coordinator", prompt: "Invoke batch-assessment next" },
    },
    options,
  }), { outcome: { outcome: "selected", optionId: "once" } });
  assert.deepEqual(controller.handler({
    toolCall: { toolCallId: "first", title: "Task", rawInput: { agent_type: "batch-assessment" } },
    options,
  }), { outcome: { outcome: "cancelled" } });
  assert.deepEqual(controller.handler({
    toolCall: { toolCallId: "second", title: "Invoke batch-assessment" },
    options,
  }), { outcome: { outcome: "selected", optionId: "once" } });
  assert.equal(controller.denials.length, 1);
  assert.equal(controller.denials[0].toolCallId, "first");
  assert.match(controller.denials[0].requestSha256, /^[a-f0-9]{64}$/);
});

test("probe status never reports passed while product-host matrix gaps remain", () => {
  const matrix = failureMatrix();
  matrix.missingResult.productHostStatus = "not_implemented";
  assert.equal(finalProductProbeStatus(probes(), matrix), "incomplete");
  assert.equal(finalProductProbeStatus(probes(), failureMatrix()), "passed");
});

test("host blockers and product failures remain distinguishable", () => {
  const diagnostics = probes();
  diagnostics.missingResultContinuation = { status: "not_supported" };
  diagnostics.partialAssessmentContinuation = { status: "not_supported" };
  const diagnosticMatrix = failureMatrix();
  diagnosticMatrix.missingResult.productHostStatus = "not_run";
  diagnosticMatrix.partialAssessment.productHostStatus = "not_run";
  assert.equal(finalProductProbeStatus(diagnostics, diagnosticMatrix), "passed");

  const blocked = probes();
  blocked.explicitBatchSuccess.status = "blocked";
  assert.equal(finalProductProbeStatus(blocked, failureMatrix()), "blocked");

  const failed = probes();
  failed.cancelBeforeApproval.status = "failed";
  assert.equal(finalProductProbeStatus(failed, failureMatrix()), "failed");
});

test("unsupported natural child failure keeps the matrix incomplete", () => {
  const matrixProbes = probes();
  matrixProbes.naturalChildFailureContinuation = { status: "not_supported" };
  matrixProbes.missingResultContinuation = { status: "not_supported" };
  matrixProbes.partialAssessmentContinuation = { status: "not_supported" };
  assert.equal(finalProductProbeStatus(matrixProbes, failureMatrix()), "incomplete");
});

test("unsupported host probes cannot satisfy failure-matrix coverage", () => {
  const matrixProbes = probes();
  matrixProbes.naturalChildFailureContinuation = { status: "not_supported" };
  const matrix = failureMatrix();
  matrix.childFailure.productHostStatus = "not_supported";
  assert.equal(finalProductProbeStatus(matrixProbes, matrix), "incomplete");
});

test("recorded product-host evidence matches the current package and verdict rules", {
  skip: fs.existsSync(evidencePath) ? false : "product-host evidence is generated by the workflow",
}, () => {
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.platform, `${process.platform}-${process.arch}`);
  assert.equal(evidence.productPackage.sha256, validateProductPackage().sha256);
  assert.equal(finalProductProbeStatus(evidence.probes, evidence.failureMatrix), evidence.status);
  assert.match(evidence.copilotVersion, /GitHub Copilot CLI \d+\.\d+\.\d+/);
  for (const [probeName, matrixName] of [
    ["naturalChildFailureContinuation", "childFailure"],
    ["missingResultContinuation", "missingResult"],
    ["partialAssessmentContinuation", "partialAssessment"],
  ]) {
    assert.equal(
      evidence.failureMatrix[matrixName].productHostStatus,
      evidence.probes[probeName].status === "passed" ? "passed" : "not_run",
    );
  }
  if (evidence.status === "blocked") {
    assert.match(evidence.blocker.code, /^copilot_/);
    assert.equal(Object.values(evidence.probes).some((probe) => probe.status === "blocked"), true);
    assert.match(evidence.probes.explicitBatchSuccess.host.sessionId, /^[A-Fa-f0-9-]{36}$/);
  }
});

test("partial Assessment reuses an unavailable ACP permission capability result", () => {
  assert.deepEqual(inheritedUnsupportedProbe("partialAssessmentContinuation", {
    missingResultContinuation: {
      status: "not_supported",
      code: "acp_permission_events_unavailable",
    },
  }), {
    status: "not_supported",
    code: "acp_permission_events_unavailable",
    reason: "The same ACP host emitted no permission events during the missing-result capability probe",
    inheritedFrom: "missingResultContinuation",
  });
  assert.equal(inheritedUnsupportedProbe("partialAssessmentContinuation", {
    missingResultContinuation: { status: "passed" },
  }), null);
});

test("resume reuses only passed scenarios and unavailable permission diagnostics", () => {
  assert.equal(reusableProbe("explicitBatchSuccess", { status: "passed" }), true);
  assert.equal(reusableProbe("explicitBatchSuccess", { status: "not_supported" }), false);
  assert.equal(reusableProbe("missingResultContinuation", {
    status: "not_supported",
    code: "acp_permission_events_unavailable",
  }), true);
  assert.equal(reusableProbe("missingResultContinuation", { status: "failed" }), false);
});
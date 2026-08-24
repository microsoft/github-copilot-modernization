import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { formatReviewHandoff, prepareBatchReview } from "./prepare-review.mjs";

const scriptPath = fileURLToPath(new URL("./prepare-review.mjs", import.meta.url));

function createRepository(root, name) {
  const repositoryPath = path.join(root, "repos", name);
  fs.mkdirSync(path.join(repositoryPath, "src"), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, "package.json"), `${JSON.stringify({ name })}\n`);
  fs.writeFileSync(path.join(repositoryPath, "src", "index.js"), "export default true;\n");
  return repositoryPath;
}

test("prepareBatchReview writes a read-only handoff", (t) => {
  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-review-test-"));
  t.after(() => fs.rmSync(launchRoot, { recursive: true, force: true }));
  const repositories = ["alpha-service", "beta-service"].map((name) => ({
    name,
    path: createRepository(launchRoot, name),
  }));
  const configPath = path.join(launchRoot, ".github", "modernize", "repos.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({ repos: repositories }, null, 2)}\n`);

  const review = prepareBatchReview({
    configPath,
    launchRoot,
    allowedRoots: [launchRoot],
    domains: ["cloud-readiness"],
    analysisCoverage: "issue-only",
    maxConcurrency: 1,
    targetRuntime: "java-21",
    targetComputeServices: ["azure-container-apps", "app-service"],
    enableContainerization: true,
    targetOS: ["linux"],
    minimumCveSeverity: "high",
    cveScanScope: "all",
    batchId: "review-test",
  });

  assert.deepEqual(review.selectedExecutionUnitIds, ["alpha-service", "beta-service"]);
  assert.deepEqual(review.approvedNeedsAttention, ["alpha-service", "beta-service"]);
  assert.equal(review.groups.needsAttention.length, 2);
  assert.deepEqual(review.decisions, {
    domains: ["cloud-readiness"],
    analysisCoverage: "issue-only",
    maxConcurrency: 1,
    targetRuntime: "java-21",
    targetComputeServices: ["azure-container-apps", "app-service"],
    enableContainerization: true,
    targetOS: ["linux"],
    minimumCveSeverity: "high",
    cveScanScope: "all",
  });
  assert.match(review.configSha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(path.join(review.batchRoot, "review.json")), true);
  assert.equal(fs.existsSync(path.join(review.batchRoot, "REVIEW.md")), true);
  assert.equal(review.reviewPath, path.join(review.batchRoot, "review.json"));
  assert.equal(review.reviewMarkdownPath, path.join(review.batchRoot, "REVIEW.md"));
  assert.equal(path.basename(review.batchAttemptScriptPath), "batch-attempt.mjs");
  assert.equal(fs.statSync(review.batchAttemptScriptPath).isFile(), true);
  assert.match(review.reviewSha256, /^[a-f0-9]{64}$/);
  assert.match(review.reviewMarkdownSha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(review.resolvedReposPath), true);
  assert.equal(fs.existsSync(review.inspectedReposPath), true);
  for (const forbidden of [
    "manifest.json",
    "state.json",
    "lease.json",
    "selection.json",
    "assessment-input.json",
    "attempts",
  ]) {
    assert.equal(fs.existsSync(path.join(review.batchRoot, forbidden)), false);
  }

  const handoff = formatReviewHandoff(review);
  assert.match(handoff, /^# Batch Assessment Review/m);
  assert.match(handoff, /BATCH_REVIEW_READY/);
  assert.match(handoff, new RegExp(`reviewPath: ${review.reviewPath.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}`));
  assert.match(handoff, new RegExp(`reviewSha256: ${review.reviewSha256}`));
  assert.match(handoff, new RegExp(`batchAttemptScriptPath: ${review.batchAttemptScriptPath.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}`));
  assert.match(handoff, /selectedExecutionUnitIds: \["alpha-service","beta-service"\]/);
  assert.match(handoff, /approvedNeedsAttention: \["alpha-service","beta-service"\]/);
  assert.match(handoff, /targetRuntime: "java-21"/);
  assert.match(handoff, /targetComputeServices: \["azure-container-apps","app-service"\]/);
  assert.match(handoff, /enableContainerization: true/);
  assert.match(handoff, /targetOS: \["linux"\]/);
  assert.match(handoff, /minimumCveSeverity: "high"/);
  assert.match(handoff, /cveScanScope: "all"/);
});

test("prepareBatchReview rejects invalid decisions before creating a preview", () => {
  assert.throws(
    () => prepareBatchReview({
      configPath: path.resolve("repos.json"),
      launchRoot: path.resolve("workspace"),
      domains: ["unsupported"],
    }),
    /supported Assessment domains/,
  );
  assert.throws(
    () => prepareBatchReview({
      configPath: path.resolve("repos.json"),
      launchRoot: path.resolve("workspace"),
      targetComputeServices: "azure-container-apps",
    }),
    /targetComputeServices/,
  );
  assert.throws(
    () => prepareBatchReview({
      configPath: path.resolve("repos.json"),
      launchRoot: path.resolve("workspace"),
      enableContainerization: "true",
    }),
    /enableContainerization/,
  );
});

test("prepare-review CLI ignores a dangling domain option and applies the language default", (t) => {
  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-review-cli-default-"));
  t.after(() => fs.rmSync(launchRoot, { recursive: true, force: true }));
  const repositoryPath = createRepository(launchRoot, "alpha-service");
  const configPath = path.join(launchRoot, "repos.json");
  fs.writeFileSync(configPath, `${JSON.stringify({
    repos: [{ name: "alpha-service", path: repositoryPath }],
  })}\n`);
  const result = spawnSync(process.execPath, [
    scriptPath,
    "--config", configPath,
    "--launch-root", launchRoot,
    "--allowed-root", launchRoot,
    "--domain",
    "--coverage", "issue-only",
    "--max-concurrency", "1",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /effectiveAssessments: \[{"executionUnitId":"alpha-service","language":"javascript","domains":\[\]/);
  assert.doesNotMatch(result.stdout, /^domains:/m);
});

test("prepareBatchReview derives Single defaults per execution unit", (t) => {
  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-review-language-defaults-"));
  t.after(() => fs.rmSync(launchRoot, { recursive: true, force: true }));
  const javaPath = path.join(launchRoot, "repos", "java-api");
  const dotnetPath = path.join(launchRoot, "repos", "dotnet-api");
  const typescriptPath = path.join(launchRoot, "repos", "typescript-ui");
  for (const repositoryPath of [javaPath, dotnetPath, typescriptPath]) {
    fs.mkdirSync(repositoryPath, { recursive: true });
  }
  fs.writeFileSync(path.join(javaPath, "pom.xml"), "<project />\n");
  fs.writeFileSync(path.join(dotnetPath, "app.csproj"), "<Project />\n");
  fs.writeFileSync(path.join(typescriptPath, "package.json"), "{}\n");
  fs.writeFileSync(path.join(typescriptPath, "tsconfig.json"), "{}\n");
  const configPath = path.join(launchRoot, "repos.json");
  fs.writeFileSync(configPath, `${JSON.stringify({
    repos: [
      { name: "java-api", path: javaPath },
      { name: "dotnet-api", path: dotnetPath },
      { name: "typescript-ui", path: typescriptPath },
    ],
  })}\n`);

  const review = prepareBatchReview({
    configPath,
    launchRoot,
    allowedRoots: [launchRoot],
    batchId: "language-defaults",
  });

  assert.equal(Object.hasOwn(review.decisions, "domains"), false);
  assert.deepEqual(review.effectiveAssessments, [
    { executionUnitId: "java-api", language: "java", domains: ["java-upgrade", "cloud-readiness"] },
    { executionUnitId: "dotnet-api", language: "dotnet", domains: ["cloud-readiness"] },
    { executionUnitId: "typescript-ui", language: "typescript", domains: [] },
  ]);
});

test("prepareBatchReview reports and excludes a mixed-language execution unit", (t) => {
  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-review-mixed-language-"));
  t.after(() => fs.rmSync(launchRoot, { recursive: true, force: true }));
  const repositoryPath = createRepository(launchRoot, "mixed-api");
  fs.writeFileSync(path.join(repositoryPath, "pom.xml"), "<project />\n");
  const configPath = path.join(launchRoot, "repos.json");
  fs.writeFileSync(configPath, `${JSON.stringify({
    repos: [{ name: "mixed-api", path: repositoryPath }],
  })}\n`);

  const review = prepareBatchReview({
    configPath,
    launchRoot,
    allowedRoots: [launchRoot],
    batchId: "mixed-language",
  });

  assert.equal(review.status, "blocked");
  assert.deepEqual(review.selectedExecutionUnitIds, []);
  assert.deepEqual(review.blockedExecutionUnits, [{
    executionUnitId: "mixed-api",
    languages: ["java", "javascript"],
    reason: "mixed-language execution units are not supported",
  }]);
  assert.match(review.markdown, /mixed-api: java, javascript/);
  assert.match(formatReviewHandoff(review), /BATCH_REVIEW_BLOCKED/);
  assert.equal(fs.existsSync(path.join(review.batchRoot, "manifest.json")), false);
  assert.equal(fs.existsSync(path.join(review.batchRoot, "state.json")), false);
});
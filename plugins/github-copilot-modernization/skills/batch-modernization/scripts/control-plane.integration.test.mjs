import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  acquireLease,
  appendEvent,
  initializeBatch,
  readState,
  updateState,
  writeRepoState,
  writeSummary,
} from "./batch-state.mjs";
import { inspectResolvedRepositories } from "./inspect-workspaces.mjs";
import { resolveReposFile } from "./resolve-repos.mjs";
import { validateSchema } from "./schema-validator.mjs";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptsRoot, "..");
const schemasRoot = path.join(skillRoot, "schemas");
const resolveScript = path.join(scriptsRoot, "resolve-repos.mjs");
const inspectScript = path.join(scriptsRoot, "inspect-workspaces.mjs");

function validate(name, value) {
  const schemaPath = path.join(schemasRoot, name);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert.deepEqual(validateSchema(value, schema, schemaPath), [], name);
}

test("local config flows through resolve, inspect, state, event, repo, and summary artifacts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-control-integration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "portfolio", "orders");
  const projectRoot = path.join(repositoryRoot, "services", "api");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), "{}\n");
  fs.writeFileSync(path.join(repositoryRoot, "excluded.txt"), "not in scope\n");
  const configPath = path.join(root, "portfolio", ".github", "modernize", "repos.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({
    producer: "integration-test",
    repos: [{ name: "orders", path: repositoryRoot, include_paths: ["services/api"] }],
  }, null, 2)}\n`);

  const resolved = resolveReposFile(configPath, { launchRoot: path.join(root, "portfolio") });
  const inspected = inspectResolvedRepositories(resolved, { allowedRoots: [path.join(root, "portfolio")] });
  assert.equal(inspected.repositories[0].preflightStatus, "needs_attention");
  assert.deepEqual(inspected.repositories[0].executionUnits[0].languages, ["javascript"]);
  assert.equal(inspected.repositories[0].executionUnits[0].scopeRoots.includes(repositoryRoot), false);
  validate("resolved-repos.schema.json", inspected);

  const batchRoot = path.join(root, "portfolio", ".github", "modernize", "batches", "batch-1");
  initializeBatch({
    batchRoot,
    manifest: {
      batchId: "batch-1",
      executionMode: "local",
      resolvedConfig: inspected,
    },
  });
  const { ownerToken } = acquireLease({ batchRoot, invocationId: "coordinator-1" });
  const unit = inspected.repositories[0].executionUnits[0];
  const state = updateState({
    batchRoot,
    ownerToken,
    mutate: (current) => ({
      ...current,
      status: "ready",
      executionUnits: [{
        repoId: unit.repoId,
        executionUnitId: unit.executionUnitId,
        phase: "assessment",
        attempt: 0,
        invocationId: null,
        status: "pending",
        resultPath: null,
        startedAt: null,
        finishedAt: null,
      }],
      progress: { wave: 1, eligible: 1, terminal: 0, successful: 0, issues: 0, failed: 0 },
    }),
  });
  validate("batch-state.schema.json", state);
  const event = appendEvent({
    batchRoot,
    ownerToken,
    event: { type: "batch_created", payload: { executionUnits: 1 } },
  });
  validate("event.schema.json", event);
  const repoPath = writeRepoState({
    batchRoot,
    ownerToken,
    repoId: "orders",
    state: { schemaVersion: 1, repoId: "orders", status: "ready", executionUnitIds: [unit.executionUnitId] },
  });
  const summary = writeSummary({
    batchRoot,
    ownerToken,
    summary: { schemaVersion: 1, batchId: "batch-1", status: "ready", repositories: 1 },
    markdown: "# Batch batch-1\n\nReady: 1\n",
  });
  assert.equal(JSON.parse(fs.readFileSync(repoPath, "utf8")).status, "ready");
  assert.equal(JSON.parse(fs.readFileSync(summary.json, "utf8")).repositories, 1);
  assert.equal(readState(batchRoot).revision, 1);
});

test("resolve and inspect CLIs publish atomic JSON artifacts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-control-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "package.json"), "{}\n");
  const configPath = path.join(root, "repos.json");
  fs.writeFileSync(configPath, `${JSON.stringify([{ name: "app", path: workspace }])}\n`);
  const resolvedPath = path.join(root, "out", "resolved.json");
  const resolvedRun = spawnSync(process.execPath, [
    resolveScript,
    "--config", configPath,
    "--launch-root", root,
    "--output", resolvedPath,
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(resolvedRun.status, 0, resolvedRun.stderr);
  assert.equal(JSON.parse(resolvedRun.stdout).outputPath, resolvedPath);
  const inspectedPath = path.join(root, "out", "inspected.json");
  const inspectedRun = spawnSync(process.execPath, [
    inspectScript,
    "inspect",
    "--resolved", resolvedPath,
    "--allowed-root", root,
    "--output", inspectedPath,
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(inspectedRun.status, 0, inspectedRun.stderr);
  const inspected = JSON.parse(fs.readFileSync(inspectedPath, "utf8"));
  assert.deepEqual(inspected.repositories[0].executionUnits[0].languages, ["javascript"]);
  assert.equal(fs.readdirSync(path.dirname(inspectedPath)).some((name) => name.endsWith(".tmp")), false);
});
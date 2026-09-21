import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BatchStateError,
  acquireLease,
  appendEvent,
  assertSchedulingAllowed,
  initializeBatch,
  readLease,
  readState,
  releaseLease,
  takeoverLease,
  updateState,
  writeRepoState,
  writeSummary,
} from "./batch-state.mjs";

const scriptPath = fileURLToPath(new URL("./batch-state.mjs", import.meta.url));

function createBatch(t, manifest = { batchId: "batch-1", config: { url: "https://example.com/repo.git" } }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-state-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeBatch({ batchRoot: root, manifest });
  return root;
}

function spawnAcquire(batchRoot, invocationId) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      scriptPath,
      "acquire-lease",
      "--batch-root",
      batchRoot,
      "--invocation-id",
      invocationId,
    ], { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    windowsHide: true,
  });
}

test("initialization creates immutable manifest and rejects secret-bearing persisted URLs", (t) => {
  const root = createBatch(t);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "manifest.json"))).schemaVersion, 1);
  assert.equal(readState(root).revision, 0);
  assert.throws(() => initializeBatch({ batchRoot: root, manifest: { batchId: "other" } }), /control file already exists/);

  const unsafeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-unsafe-"));
  t.after(() => fs.rmSync(unsafeRoot, { recursive: true, force: true }));
  assert.throws(
    () => initializeBatch({
      batchRoot: unsafeRoot,
      manifest: { batchId: "unsafe", url: "https://user:secret@example.com/repo.git?token=x#frag" },
    }),
    /must not contain URL credentials/,
  );
  assert.equal(fs.existsSync(path.join(unsafeRoot, "manifest.json")), false);

  const unsafeHttpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-unsafe-http-"));
  t.after(() => fs.rmSync(unsafeHttpRoot, { recursive: true, force: true }));
  assert.throws(
    () => initializeBatch({
      batchRoot: unsafeHttpRoot,
      manifest: { batchId: "unsafe-http", url: "http://user:secret@example.com/repo.git?token=x" },
    }),
    /must not contain URL credentials/,
  );
  assert.equal(fs.existsSync(path.join(unsafeHttpRoot, "manifest.json")), false);

  const keyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-secret-key-"));
  t.after(() => fs.rmSync(keyRoot, { recursive: true, force: true }));
  assert.throws(
    () => initializeBatch({ batchRoot: keyRoot, manifest: { batchId: "unsafe-key", accessToken: "value" } }),
    /credential fields/,
  );

  const redactedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-redacted-key-"));
  t.after(() => fs.rmSync(redactedRoot, { recursive: true, force: true }));
  initializeBatch({
    batchRoot: redactedRoot,
    manifest: { batchId: "safe-key", unknownFields: { accessToken: "<redacted>" } },
  });
  assert.equal(fs.existsSync(path.join(redactedRoot, "manifest.json")), true);
});

test("initialization refuses partial pre-existing control files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-partial-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "state.json"), "do not overwrite\n");
  assert.throws(
    () => initializeBatch({ batchRoot: root, manifest: { batchId: "batch-1" } }),
    /state\.json/,
  );
  assert.equal(fs.readFileSync(path.join(root, "state.json"), "utf8"), "do not overwrite\n");
});

test("only one competing process acquires a batch lease", async (t) => {
  const root = createBatch(t);
  const results = await Promise.all([
    spawnAcquire(root, "invocation-a"),
    spawnAcquire(root, "invocation-b"),
  ]);
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 2]);
  assert.equal(readLease(root).schedulingAllowed, true);
});

test("lease acquisition requires a complete initialized batch", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-no-state-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => acquireLease({ batchRoot: root, invocationId: "owner" }), /batch manifest/);
  assert.equal(fs.existsSync(path.join(root, "lease.json")), false);
});

test("wrong owner tokens fail closed for state, events, summaries, and release", (t) => {
  const root = createBatch(t);
  const { ownerToken } = acquireLease({ batchRoot: root, invocationId: "owner" });
  assert.throws(
    () => updateState({ batchRoot: root, ownerToken: "wrong", mutate: (state) => state }),
    /does not match/,
  );
  assert.throws(
    () => appendEvent({ batchRoot: root, ownerToken: "wrong", event: { type: "batch_created" } }),
    /does not match/,
  );
  assert.throws(
    () => writeSummary({ batchRoot: root, ownerToken: "wrong", summary: { schemaVersion: 1 }, markdown: "# Summary" }),
    /does not match/,
  );
  assert.throws(() => releaseLease({ batchRoot: root, ownerToken: "wrong" }), /does not match/);
  releaseLease({ batchRoot: root, ownerToken });
  assert.equal(readLease(root), null);
});

test("owner updates state, event log, repository state, and summary atomically", (t) => {
  const root = createBatch(t);
  const { ownerToken } = acquireLease({ batchRoot: root, invocationId: "owner" });
  const updated = updateState({
    batchRoot: root,
    ownerToken,
    mutate: (state) => ({ ...state, status: "ready" }),
  });
  assert.equal(updated.revision, 1);
  assert.equal(updated.status, "ready");
  assert.match(updated.activeLeaseDigest, /^sha256:/);
  const first = appendEvent({ batchRoot: root, ownerToken, event: { type: "batch_created" } });
  const second = appendEvent({ batchRoot: root, ownerToken, event: { type: "lease_acquired" } });
  assert.deepEqual([first.sequence, second.sequence], [1, 2]);
  const repoPath = writeRepoState({
    batchRoot: root,
    ownerToken,
    repoId: "orders",
    state: { schemaVersion: 1, repoId: "orders", status: "ready" },
  });
  const summaryPaths = writeSummary({
    batchRoot: root,
    ownerToken,
    summary: { schemaVersion: 1, batchId: "batch-1", status: "ready" },
    markdown: "# Batch summary",
  });
  assert.equal(JSON.parse(fs.readFileSync(repoPath)).status, "ready");
  assert.equal(JSON.parse(fs.readFileSync(summaryPaths.json)).status, "ready");
  assert.equal(fs.readFileSync(summaryPaths.markdown, "utf8"), "# Batch summary\n");
  assert.equal(fs.readdirSync(root).some((name) => name.endsWith(".tmp")), false);
});

test("event operation keys make retries idempotent and reject conflicting reuse", (t) => {
  const root = createBatch(t);
  const { ownerToken } = acquireLease({ batchRoot: root, invocationId: "owner" });
  const event = {
    type: "attempt_finished",
    repoId: "orders",
    executionUnitId: "orders",
    invocationId: "11111111-1111-4111-8111-111111111111",
    payload: { phase: "assessment", attempt: 1, status: "completed" },
  };
  const first = appendEvent({
    batchRoot: root,
    ownerToken,
    event,
    operationKey: "commit:orders:assessment:1",
  });
  const replay = appendEvent({
    batchRoot: root,
    ownerToken,
    event: {
      ...event,
      payload: { status: "completed", attempt: 1, phase: "assessment" },
    },
    operationKey: "commit:orders:assessment:1",
    now: "2026-08-18T12:00:00.000Z",
  });
  assert.deepEqual(replay, first);
  assert.equal(fs.readFileSync(path.join(root, "events.jsonl"), "utf8").trim().split(/\r?\n/).length, 1);
  assert.throws(
    () => appendEvent({
      batchRoot: root,
      ownerToken,
      event: { ...event, payload: { ...event.payload, status: "failed" } },
      operationKey: "commit:orders:assessment:1",
    }),
    (error) => error.code === "event_operation_conflict",
  );
});

test("takeover uses compare-and-swap and remains read-only", (t) => {
  const root = createBatch(t);
  const oldOwner = acquireLease({ batchRoot: root, invocationId: "old-owner" });
  const original = readLease(root);
  const takeover = takeoverLease({
    batchRoot: root,
    expectedLeaseDigest: original.leaseFileDigest,
    invocationId: "new-owner",
  });
  assert.equal(takeover.lease.schedulingAllowed, false);
  assert.throws(() => assertSchedulingAllowed(root, takeover.ownerToken), /read-only/);
  assert.throws(
    () => updateState({ batchRoot: root, ownerToken: takeover.ownerToken, mutate: (state) => state }),
    /read-only/,
  );
  assert.throws(
    () => appendEvent({ batchRoot: root, ownerToken: takeover.ownerToken, event: { type: "takeover_recorded" } }),
    /read-only/,
  );
  assert.throws(
    () => updateState({ batchRoot: root, ownerToken: oldOwner.ownerToken, mutate: (state) => state }),
    /does not match/,
  );
  assert.throws(
    () => takeoverLease({
      batchRoot: root,
      expectedLeaseDigest: original.leaseFileDigest,
      invocationId: "loser",
    }),
    /changed before takeover/,
  );
});

test("unknown persisted schema versions are rejected", (t) => {
  const root = createBatch(t);
  const statePath = path.join(root, "state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  fs.writeFileSync(statePath, JSON.stringify({ ...state, schemaVersion: 99 }));
  assert.throws(
    () => readState(root),
    (error) => error instanceof BatchStateError && error.code === "unsupported_schema",
  );
});

test("state and event schema violations fail before persistence", (t) => {
  const root = createBatch(t);
  const { ownerToken } = acquireLease({ batchRoot: root, invocationId: "owner" });
  assert.throws(
    () => updateState({
      batchRoot: root,
      ownerToken,
      mutate: (state) => ({ ...state, status: "invented" }),
    }),
    /violates its v1 schema/,
  );
  assert.throws(
    () => appendEvent({ batchRoot: root, ownerToken, event: { type: "invented" } }),
    /violates its v1 schema/,
  );
  assert.equal(readState(root).status, "draft");
  assert.equal(fs.readFileSync(path.join(root, "events.jsonl"), "utf8"), "");
});

test("state CLI uses environment-only ownership for deterministic operations", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, "manifest-input.json");
  fs.writeFileSync(manifestPath, '{"batchId":"batch-cli"}\n');
  const batchRoot = path.join(root, "batch");
  const initialized = runCli([
    "initialize",
    "--batch-root", batchRoot,
    "--manifest", manifestPath,
  ]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const acquired = runCli([
    "acquire-lease",
    "--batch-root", batchRoot,
    "--invocation-id", "cli-owner",
  ]);
  assert.equal(acquired.status, 0, acquired.stderr);
  const { ownerToken } = JSON.parse(acquired.stdout);
  assert.equal(ownerToken.length > 20, true);

  const withoutToken = runCli([
    "update-status",
    "--batch-root", batchRoot,
    "--status", "ready",
  ]);
  assert.equal(withoutToken.status, 1);
  assert.match(withoutToken.stderr, /owner_token_required/);
  const env = { BATCH_OWNER_TOKEN: ownerToken };
  const updated = runCli([
    "update-status",
    "--batch-root", batchRoot,
    "--status", "ready",
  ], env);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(JSON.parse(updated.stdout).status, "ready");
  assert.equal(runCli(["assert-scheduling", "--batch-root", batchRoot], env).status, 0);
  assert.equal(runCli(["release-lease", "--batch-root", batchRoot], env).status, 0);
});

test("repository state IDs cannot escape the repos directory", (t) => {
  const root = createBatch(t);
  const { ownerToken } = acquireLease({ batchRoot: root, invocationId: "owner" });
  assert.throws(
    () => writeRepoState({
      batchRoot: root,
      ownerToken,
      repoId: "../escape",
      state: { schemaVersion: 1, repoId: "../escape" },
    }),
    /not a safe filename/,
  );
  assert.equal(fs.existsSync(path.join(root, "escape.json")), false);
});
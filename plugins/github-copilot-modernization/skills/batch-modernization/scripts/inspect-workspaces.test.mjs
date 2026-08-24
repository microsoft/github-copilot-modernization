import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  assertCanonicalContainment,
  cloneRepository,
  detectProjectLanguages,
  inspectResolvedRepositories,
  redactSecrets,
} from "./inspect-workspaces.mjs";
import { resolveReposDocument } from "./resolve-repos.mjs";

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createGitProject(root, { remote = "https://github.com/contoso/orders.git", branch = "main" } = {}) {
  fs.mkdirSync(root, { recursive: true });
  git(root, "init");
  git(root, "config", "user.email", "batch@example.test");
  git(root, "config", "user.name", "Batch Test");
  fs.writeFileSync(path.join(root, "pom.xml"), "<project/>\n");
  git(root, "add", "pom.xml");
  git(root, "commit", "-m", "initial");
  git(root, "branch", "-M", branch);
  git(root, "remote", "add", "origin", remote);
}

test("project detection recognizes Java, .NET, JavaScript, and TypeScript roots", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-languages-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "pom.xml"), "<project/>\n");
  fs.writeFileSync(path.join(root, "demo.csproj"), "<Project/>\n");
  fs.writeFileSync(path.join(root, "package.json"), "{}\n");
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
  assert.deepEqual(detectProjectLanguages(root), ["java", "dotnet", "typescript"]);
});

test("workspace inspection reports clean URL repos ready and dirty repos needs attention", (t) => {
  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-inspect-"));
  t.after(() => fs.rmSync(launchRoot, { recursive: true, force: true }));
  const workspace = path.join(launchRoot, "repos", "orders");
  createGitProject(workspace);
  const resolved = resolveReposDocument({
    repos: [{ name: "orders", url: "git@github.com:contoso/orders.git", branch: "main" }],
  }, { launchRoot });

  const clean = inspectResolvedRepositories(resolved, { allowedRoots: [launchRoot] });
  assert.equal(clean.repositories[0].preflightStatus, "ready");
  assert.deepEqual(clean.repositories[0].executionUnits[0].languages, ["java"]);
  fs.writeFileSync(path.join(workspace, "dirty.txt"), "dirty\n");
  const dirty = inspectResolvedRepositories(resolved, { allowedRoots: [launchRoot] });
  assert.equal(dirty.repositories[0].preflightStatus, "needs_attention");
  assert.match(dirty.repositories[0].warnings.join("\n"), /uncommitted changes/);
});

test("origin and branch mismatches block configured URL workspaces without leaking credentials", (t) => {
  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-origin-"));
  t.after(() => fs.rmSync(launchRoot, { recursive: true, force: true }));
  const workspace = path.join(launchRoot, "repos", "orders");
  createGitProject(workspace, {
    remote: "https://user:secret@github.com/contoso/other.git?token=hidden#fragment",
    branch: "other",
  });
  const resolved = resolveReposDocument({
    repos: [{ name: "orders", url: "https://github.com/contoso/orders.git", branch: "main" }],
  }, { launchRoot });
  const inspected = inspectResolvedRepositories(resolved, { allowedRoots: [launchRoot] });
  const serialized = JSON.stringify(inspected);
  assert.equal(inspected.repositories[0].preflightStatus, "blocked");
  assert.match(inspected.repositories[0].errors.join("\n"), /origin does not match/);
  assert.match(inspected.repositories[0].errors.join("\n"), /current branch/);
  assert.doesNotMatch(serialized, /secret|token=hidden|fragment/);
});

test("include-path units exclude siblings and reject canonical path escapes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-scope-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "batch-outside-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "services", "api"), { recursive: true });
  fs.mkdirSync(path.join(root, "services", "excluded"), { recursive: true });
  fs.writeFileSync(path.join(root, "services", "api", "package.json"), "{}\n");
  fs.writeFileSync(path.join(root, "services", "excluded", "pom.xml"), "<project/>\n");
  const resolved = resolveReposDocument({
    repos: [{ name: "mono", path: root, include_paths: ["services/api"] }],
  }, { launchRoot: root });
  const inspected = inspectResolvedRepositories(resolved, { allowedRoots: [root] });
  assert.equal(inspected.repositories[0].executionUnits.length, 1);
  assert.deepEqual(inspected.repositories[0].executionUnits[0].languages, ["javascript"]);
  assert.equal(inspected.repositories[0].executionUnits[0].workspacePath.includes("excluded"), false);
  assert.throws(() => assertCanonicalContainment(root, outside), /escapes the approved root/);

  const linkPath = path.join(root, "escape-link");
  try {
    fs.symlinkSync(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => assertCanonicalContainment(root, linkPath), /escapes the approved root/);
  } catch (error) {
    if (!["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) throw error;
  }
});

test("missing, unauthorized, and unsupported local workspaces fail closed", (t) => {
  const allowed = fs.mkdtempSync(path.join(os.tmpdir(), "batch-allowed-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "batch-denied-"));
  t.after(() => fs.rmSync(allowed, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const resolved = resolveReposDocument({
    repos: [
      { name: "missing", path: path.join(allowed, "missing") },
      { name: "denied", path: outside },
      { name: "unsupported", path: allowed },
    ],
  }, { launchRoot: allowed });
  const inspected = inspectResolvedRepositories(resolved, { allowedRoots: [allowed] });
  assert.deepEqual(inspected.repositories.map((repo) => repo.preflightStatus), ["blocked", "blocked", "blocked"]);
});

test("clone publishes a complete temporary directory atomically and cleans failed attempts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-clone-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "repos", "orders");
  const seen = [];
  const successSpawn = (_command, args) => {
    const temporaryPath = args.at(-1);
    assert.equal(args.at(-2), "https://example.com/orders.git");
    seen.push(temporaryPath);
    fs.mkdirSync(temporaryPath, { recursive: true });
    fs.writeFileSync(path.join(temporaryPath, "complete.txt"), "ready\n");
    return { status: 0, stdout: "", stderr: "" };
  };
  cloneRepository({
    url: "https://user:secret@example.com/orders.git?token=x#fragment",
    targetPath: target,
    allowedRoot: root,
    spawnSyncImpl: successSpawn,
  });
  assert.equal(fs.readFileSync(path.join(target, "complete.txt"), "utf8"), "ready\n");
  assert.equal(seen[0].startsWith(path.join(root, "repos", ".orders.clone-")), true);
  assert.equal(fs.existsSync(seen[0]), false);

  const failedTarget = path.join(root, "repos", "failed");
  let failedTemporaryPath;
  const failedSpawn = (_command, args) => {
    failedTemporaryPath = args.at(-1);
    fs.mkdirSync(failedTemporaryPath, { recursive: true });
    return {
      status: 1,
      stdout: "",
      stderr: "fatal: https://user:secret@example.com/orders.git?token=x#fragment failed",
    };
  };
  assert.throws(
    () => cloneRepository({
      url: "https://user:secret@example.com/orders.git?token=x#fragment",
      targetPath: failedTarget,
      allowedRoot: root,
      spawnSyncImpl: failedSpawn,
    }),
    (error) => {
      assert.doesNotMatch(error.message, /secret|token=x|fragment/);
      return true;
    },
  );
  assert.equal(fs.existsSync(failedTarget), false);
  assert.equal(fs.existsSync(failedTemporaryPath), false);
});

test("redaction removes credentials from free-form errors", () => {
  const redacted = redactSecrets("failed https://user:token@example.com/org/repo.git?secret=x#frag");
  assert.doesNotMatch(redacted, /user|token|secret=x|frag/);
  assert.equal(redacted, "failed https://example.com/org/repo.git");
  const http = redactSecrets("failed http://user:token@example.com/org/repo.git?secret=x#frag");
  assert.doesNotMatch(http, /user|token|secret=x|frag/);
  assert.equal(http, "failed <redacted-git-url>");
});

test("workspace inspection rejects malformed resolved documents before touching paths", () => {
  assert.throws(
    () => inspectResolvedRepositories({ schemaVersion: 1, repositories: [] }, { allowedRoots: [] }),
    /violates the v1 schema/,
  );
});
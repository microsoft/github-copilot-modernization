import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ConfigValidationError,
  normalizeRemoteIdentity,
  resolveReposDocument,
  resolveReposFile,
  sanitizeGitUrl,
} from "./resolve-repos.mjs";

const launchRoot = path.resolve(os.tmpdir(), "batch-control-test-root");

test("v1 config resolves deterministic repository and root execution-unit identities", () => {
  const result = resolveReposDocument([
    { name: "Orders API", url: "https://github.com/Contoso/orders.git" },
    { name: "billing", url: "git@github.com:Contoso/billing.git" },
  ], { launchRoot, configPath: path.join(launchRoot, "repos.json") });

  assert.equal(result.producer, null);
  assert.deepEqual(result.repositories.map((repo) => repo.repoId), ["Orders-API", "billing"]);
  assert.equal(result.repositories[0].workspacePath, path.join(launchRoot, "repos", "Orders-API"));
  assert.deepEqual(result.repositories[0].executionUnits.map((unit) => unit.executionUnitId), ["Orders-API"]);
  assert.equal(result.repositories[1].input.url, "ssh://github.com/Contoso/billing.git");
});

test("v2 config preserves unknown fields and creates separate include-path units", () => {
  const result = resolveReposDocument({
    producer: "portfolio",
    future_root: { enabled: true },
    repos: [{
      name: "orders",
      path: path.join(launchRoot, "orders"),
      branch: "ignored",
      include_paths: ["services/api", "services/worker"],
      project_id: "p1",
      future_repo: {
        callback: "http://user:secret@example.com/hook?token=x#fragment",
        accessToken: "plain-secret",
      },
    }],
    apps: [{
      identifier: "commerce",
      repos: ["ORDERS"],
      output: { type: "local" },
      future_app: true,
    }],
  }, { launchRoot });

  const repository = result.repositories[0];
  assert.deepEqual(repository.executionUnits.map((unit) => unit.executionUnitId), [
    "orders/services-api",
    "orders/services-worker",
  ]);
  assert.equal(repository.executionUnits[0].workspacePath, path.join(launchRoot, "orders", "services", "api"));
  assert.deepEqual(repository.unknownFields, {
    project_id: "p1",
    future_repo: { callback: "http://example.com/hook", accessToken: "<redacted>" },
  });
  assert.deepEqual(result.unknownFields, { future_root: { enabled: true } });
  assert.deepEqual(result.apps[0], {
    identifier: "commerce",
    repoIds: ["orders"],
    unknownFields: { output: { type: "local" }, future_app: true },
  });
  assert.doesNotMatch(JSON.stringify(result), /user|secret|token=x|fragment/);
  assert.match(repository.warnings.join("\n"), /branch is ignored/);
});

test("repository IDs avoid cross-platform reserved filenames", () => {
  const result = resolveReposDocument([
    { name: "CON", url: "https://example.com/con.git" },
  ], { launchRoot });
  assert.equal(result.repositories[0].repoId, "repo-CON");
});

test("Git branch validation rejects traversal, lock, reflog, whitespace, and option forms", () => {
  for (const branch of ["feature..next", "feature.lock", "@{bad}", "bad branch", "-danger"]) {
    assert.throws(
      () => resolveReposDocument([
        { name: `repo-${branch.length}`, url: "https://example.com/repo.git", branch },
      ], { launchRoot }),
      /unsupported Git ref characters/,
      branch,
    );
  }
});

test("URL sanitization strips credentials, query, and fragment from persisted forms", () => {
  const sanitized = sanitizeGitUrl("https://user:token@GitHub.com/Contoso/Orders.git?secret=yes#credential");
  assert.equal(sanitized, "https://github.com/Contoso/Orders.git");
  assert.equal(normalizeRemoteIdentity(sanitized), "github.com/contoso/orders");
  assert.equal(sanitizeGitUrl("git@GitHub.com:Contoso/Orders.git"), "ssh://github.com/Contoso/Orders.git");
});

test("config rejects duplicate names, sanitized collisions, bad URLs, scopes, and apps", () => {
  assert.throws(
    () => resolveReposDocument({
      repos: [
        { name: "Orders API", url: "http://example.com/orders.git", include_paths: ["../escape"] },
        { name: "orders-api", path: "relative/path" },
        { name: "ORDERS API", url: "https://example.com/duplicate.git" },
      ],
      apps: [{ identifier: "bad", repos: ["missing"] }],
    }, { launchRoot }),
    (error) => {
      assert.ok(error instanceof ConfigValidationError);
      assert.match(error.message, /protocol must be HTTPS or SSH/);
      assert.match(error.message, /must stay inside the repository/);
      assert.match(error.message, /must be absolute/);
      assert.match(error.message, /duplicates another repository/);
      assert.match(error.message, /collides after path sanitization/);
      assert.match(error.message, /references unknown repository/);
      return true;
    },
  );
});

test("include paths that sanitize to the same unit ID fail closed", () => {
  assert.throws(
    () => resolveReposDocument({
      repos: [{
        name: "orders",
        path: path.join(launchRoot, "orders"),
        include_paths: ["services/api", "services-api"],
      }],
    }, { launchRoot }),
    /produces duplicate execution unit/,
  );
});

test("file loading hashes exact bytes and reports malformed JSON", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-resolve-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, "repos.json");
  fs.writeFileSync(configPath, '[{"name":"orders","url":"https://example.com/orders.git"}]\n');
  const result = resolveReposFile(configPath, { launchRoot: root });
  assert.match(result.configSha256, /^[a-f0-9]{64}$/);
  fs.writeFileSync(configPath, "{");
  assert.throws(() => resolveReposFile(configPath, { launchRoot: root }), /not valid JSON/);
});
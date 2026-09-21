import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { probeDefaultBatchConfig } from "./probe-default-config.mjs";

function fixture(t) {
  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-mode-probe-"));
  t.after(() => fs.rmSync(launchRoot, { recursive: true, force: true }));
  return {
    launchRoot,
    configPath: path.join(launchRoot, ".github", "modernize", "repos.json"),
  };
}

test("default config probe distinguishes absent, file, and invalid paths without mutation", (t) => {
  const value = fixture(t);
  assert.equal(probeDefaultBatchConfig(value).status, "absent");
  assert.deepEqual(fs.readdirSync(value.launchRoot), []);

  fs.mkdirSync(path.dirname(value.configPath), { recursive: true });
  fs.writeFileSync(value.configPath, '{"repos":[]}\n');
  const found = probeDefaultBatchConfig(value);
  assert.equal(found.status, "found");
  assert.equal(found.configPath, value.configPath);

  fs.rmSync(value.configPath);
  fs.mkdirSync(value.configPath);
  assert.equal(probeDefaultBatchConfig(value).status, "invalid");
});

test("default config probe requires an absolute existing launch root", () => {
  assert.throws(() => probeDefaultBatchConfig({ launchRoot: "relative" }), /absolute/);
  assert.throws(
    () => probeDefaultBatchConfig({ launchRoot: path.join(os.tmpdir(), "missing-batch-probe-root") }),
    /existing directory/,
  );
});
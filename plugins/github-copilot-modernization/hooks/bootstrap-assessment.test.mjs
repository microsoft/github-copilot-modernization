import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const hookRoot = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.dirname(hookRoot);
const scriptPath = path.join(hookRoot, "bootstrap-assessment.mjs");

function runBootstrap(rootVariable) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "assessment-hook-test-"));
  const env = { ...process.env };
  for (const name of ["CLAUDE_PLUGIN_ROOT", "COPILOT_PLUGIN_ROOT", "PLUGIN_ROOT"]) {
    delete env[name];
  }
  env[rootVariable] = pluginRoot;

  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env,
    input: JSON.stringify({ cwd: projectRoot }),
  });
  return { projectRoot, result };
}

test("plugin manifest registers the assessment SessionStart hook", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"));
  const hookConfig = JSON.parse(fs.readFileSync(path.join(hookRoot, "hooks.json"), "utf8"));
  const commandHook = hookConfig.hooks.SessionStart[0].hooks[0];

  assert.equal(manifest.hooks, "hooks/hooks.json");
  assert.equal(commandHook.type, "command");
  assert.match(commandHook.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/bootstrap-assessment\.mjs/);
  assert.equal(commandHook.timeout, 30);
});

test("assessment hook bootstraps the complete runtime for every plugin-root alias", (t) => {
  for (const rootVariable of ["CLAUDE_PLUGIN_ROOT", "COPILOT_PLUGIN_ROOT", "PLUGIN_ROOT"]) {
    const { projectRoot, result } = runBootstrap(rootVariable);
    t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

    assert.equal(result.status, 0, `${rootVariable}: ${result.stderr}`);
    const runtimeRoot = path.join(projectRoot, ".github", "modernize", ".runtime", "assessment");
    for (const moduleName of ["assess-cli.mjs", "assess-state.mjs", "assess-report.mjs", "assess-runtime.mjs", "assessment-catalog.mjs"]) {
      assert.equal(
        fs.readFileSync(path.join(runtimeRoot, moduleName), "utf8"),
        fs.readFileSync(path.join(pluginRoot, "skills", "assessment", "scripts", moduleName), "utf8"),
      );
    }
    assert.equal(fs.readFileSync(path.join(runtimeRoot, ".gitignore"), "utf8"), "*\n!.gitignore\n");
    assert.equal(fs.existsSync(path.join(runtimeRoot, "templates", "report.html")), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, "solution-mapping.json")), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, "atomic")), false);
  }
});
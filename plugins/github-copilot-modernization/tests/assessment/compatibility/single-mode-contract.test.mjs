import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const compatibilityRoot = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(compatibilityRoot, "..", "..", "..");
const contract = JSON.parse(
  fs.readFileSync(path.join(compatibilityRoot, "single-mode-contract.json"), "utf8"),
);

test("single-mode baseline covers all compatibility route fixtures", () => {
  assert.equal(contract.schemaVersion, 1);
  assert.deepEqual(
    contract.scenarios.map((scenario) => scenario.id),
    [
      "no-default-config-broad-intent",
      "explicit-current-repository",
      "explicit-assessment",
      "one-specific-task",
      "multiple-specific-tasks",
      "execute-existing-plan",
    ],
  );
  assert.equal(contract.scenarios.every((scenario) => scenario.expected.mode === "single"), true);
});

test("single-mode route and artifact anchors remain present", () => {
  for (const source of contract.sourceAnchors) {
    const filePath = path.join(pluginRoot, source.file);
    const content = fs.readFileSync(filePath, "utf8");
    for (const anchor of source.contains) {
      assert.equal(content.includes(anchor), true, `${source.file} is missing ${JSON.stringify(anchor)}`);
    }
  }
});

test("single-mode artifact baseline keeps both tasks.json compatibility locations", () => {
  const executionSource = contract.sourceAnchors.find(
    (source) => source.file === "agents/execution-coordinator.agent.md",
  );
  assert.ok(executionSource);
  const content = fs.readFileSync(path.join(pluginRoot, executionSource.file), "utf8");
  assert.match(content, /<plan-name>\/tasks\.json/);
  assert.match(content, /<plan-name>\/\.metadata\/tasks\.json/);
});
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateSchema } from "./schema-validator.mjs";
import { resolveReposDocument } from "./resolve-repos.mjs";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const schemasRoot = path.resolve(scriptsRoot, "..", "schemas");
const schemaNames = [
  "resolved-repos.schema.json",
  "execution-unit.schema.json",
  "attempt-request.schema.json",
  "attempt-result.schema.json",
  "batch-state.schema.json",
  "event.schema.json",
  "needs-input.schema.json",
];

function loadSchema(name) {
  const schemaPath = path.join(schemasRoot, name);
  return { schemaPath, schema: JSON.parse(fs.readFileSync(schemaPath, "utf8")) };
}

test("batch-modernization ships exactly the seven v1 protocol schemas", () => {
  assert.deepEqual(
    fs.readdirSync(schemasRoot).filter((name) => name.endsWith(".schema.json")).sort(),
    [...schemaNames].sort(),
  );
  for (const name of schemaNames) {
    const { schema } = loadSchema(name);
    assert.equal(schema.$id, name);
    assert.equal(schema.properties.schemaVersion.const, 1);
    assert.equal(schema.additionalProperties, false);
  }
});

test("resolved config output satisfies the production schema", () => {
  const launchRoot = path.resolve(os.tmpdir(), "batch-schema-root");
  const resolved = resolveReposDocument({
    producer: "portfolio",
    future: true,
    repos: [{
      name: "orders",
      path: path.join(launchRoot, "orders"),
      include_paths: ["api"],
      future_repo: "preserved",
    }],
    apps: [{ identifier: "commerce", repos: ["orders"], future_app: 1 }],
  }, { launchRoot });
  const { schema, schemaPath } = loadSchema("resolved-repos.schema.json");
  assert.deepEqual(validateSchema(resolved, schema, schemaPath), []);
});

test("attempt request schema excludes lease ownership capability", () => {
  const { schema } = loadSchema("attempt-request.schema.json");
  assert.equal(Object.hasOwn(schema.properties, "leaseToken"), false);
  assert.equal(schema.additionalProperties, false);
});
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { loadMemory, parseYaml } from "./assess-cli.mjs";

const temporaryDirectories = [];
const scriptPath = fileURLToPath(new URL("./assess-cli.mjs", import.meta.url));

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "assess-cli-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeFile(directory, name, content) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), content, "utf8");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("parseYaml handles nested mappings, sequences, and block scalars", () => {
  const parsed = parseYaml(`
version: 1
patches:
  - id: bp-0001
    actual: |
      Use App Service.
      Do not add containers.
    applies_to:
      skills: [assessment, create-modernization-plan]
      intents:
        - cloud-readiness
        - full
`);

  assert.equal(parsed.version, 1);
  assert.equal(parsed.patches[0].id, "bp-0001");
  assert.equal(
    parsed.patches[0].actual,
    "Use App Service.\nDo not add containers.",
  );
  assert.deepEqual(parsed.patches[0].applies_to.intents, [
    "cloud-readiness",
    "full",
  ]);
  assert.deepEqual(parsed.patches[0].applies_to.skills, [
    "assessment",
    "create-modernization-plan",
  ]);
});

test("loadMemory emits the first-run protocol without creating files", () => {
  const parent = createTemporaryDirectory();
  const memoryDir = path.join(parent, "missing-memory");
  const result = loadMemory({
    memoryDir,
    now: new Date("2026-08-11T12:34:56Z"),
  });

  assert.equal(
    result.greeting,
    "First assessment in this repo. I'll set up .memory/ as we go.",
  );
  assert.deepEqual(result.payload, { patches: [] });
  assert.equal(
    result.receipt,
    "loaded@2026-08-11T12:34:56Z findings=0 patches=0/0 suppressions=0",
  );
  assert.equal(fs.existsSync(memoryDir), false);
});

test("loadMemory filters patches by intent and honors the configured cap", () => {
  const memoryDir = createTemporaryDirectory();
  writeFile(
    memoryDir,
    "findings.yaml",
    "version: 1\nfindings:\n  - id: finding-1\n  - id: finding-2\n",
  );
  writeFile(
    memoryDir,
    "suppressions.yaml",
    "version: 1\nrules:\n  - id: rule-1\n",
  );
  writeFile(
    memoryDir,
    "preferences.yaml",
    `version: 1
behavior:
  bias_patches:
    max_loaded_per_run: 1
`,
  );
  writeFile(
    memoryDir,
    "last-intent.yaml",
    "version: 1\nuser_concern: cloud-readiness\n",
  );
  writeFile(
    memoryDir,
    "bias-patches.yaml",
    `version: 1
patches:
  - id: bp-0001
    state: active
    captured_at: 2026-08-01T00:00:00Z
    actual: Use App Service.
    applies_to:
      skills: [assessment, create-modernization-plan]
      intents: [cloud-readiness, full]
  - id: bp-0002
    state: active
    captured_at: 2026-08-02T00:00:00Z
    actual: Keep the database external.
    applies_to:
      intents:
        - cloud-readiness
  - id: bp-0003
    state: active
    captured_at: 2026-08-03T00:00:00Z
    actual: Security only.
    applies_to:
      intents:
        - security
  - id: bp-0004
    state: retired
    actual: Old preference.
`,
  );

  const result = loadMemory({
    memoryDir,
    intent: "cloud-readiness",
    now: new Date("2026-08-11T12:34:56Z"),
  });

  assert.equal(result.payload.patches.length, 1);
  assert.equal(result.payload.patches[0].id, "bp-0002");
  assert.deepEqual(result.payload.patches[0].applies_to.intents, [
    "cloud-readiness",
  ]);
  assert.match(result.greeting, /Loaded 2 known findings/);
  assert.match(result.greeting, /1 active suppression rules/);
  assert.match(result.greeting, /1 additional active patches not loaded/);
  assert.match(result.greeting, /1 retired patches in archive/);
  assert.equal(
    result.receipt,
    "loaded@2026-08-11T12:34:56Z findings=2 patches=1/3 suppressions=1",
  );
});

test("load-memory command runs through the Node executable", () => {
  const parent = createTemporaryDirectory();
  const memoryDir = path.join(parent, "missing-memory");
  const result = spawnSync(
    process.execPath,
    [scriptPath, "load-memory", "--memory-dir", memoryDir, "--intent", "unknown"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^=== GREETING ===$/m);
  assert.match(result.stdout, /findings=0 patches=0\/0 suppressions=0/);
});

test("bootstrap creates an independent Assessment runtime in every target workspace", () => {
  const parent = createTemporaryDirectory();
  const workspaces = ["java", "dotnet", "typescript"].map((name) => path.join(parent, name));
  const destinations = workspaces.map((workspacePath) => {
    fs.mkdirSync(workspacePath);
    const result = spawnSync(
      process.execPath,
      [scriptPath, "bootstrap", "--workspace-path", workspacePath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).destination;
  });

  assert.equal(new Set(destinations).size, workspaces.length);
  for (const [index, destination] of destinations.entries()) {
    assert.equal(
      destination,
      path.join(workspaces[index], ".github", "modernize", ".runtime", "assessment"),
    );
    assert.equal(fs.existsSync(path.join(destination, "assess-cli.mjs")), true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(destination, "solution-mapping.json"), "utf8")),
      JSON.parse(fs.readFileSync(path.resolve(path.dirname(scriptPath), "..", "resources", "solution-mapping.json"), "utf8")),
    );
    assert.equal(fs.readFileSync(path.join(destination, ".gitignore"), "utf8"), "*\n!.gitignore\n");
  }
});

test("a bootstrapped runtime can bootstrap another workspace with solution mapping", () => {
  const parent = createTemporaryDirectory();
  const firstWorkspace = path.join(parent, "first");
  const secondWorkspace = path.join(parent, "second");
  fs.mkdirSync(firstWorkspace);
  fs.mkdirSync(secondWorkspace);
  const first = spawnSync(
    process.execPath,
    [scriptPath, "bootstrap", "--workspace-path", firstWorkspace],
    { encoding: "utf8" },
  );
  assert.equal(first.status, 0, first.stderr);
  const runtimeCli = JSON.parse(first.stdout).cliPath;
  const second = spawnSync(
    process.execPath,
    [runtimeCli, "bootstrap", "--workspace-path", secondWorkspace],
    { encoding: "utf8" },
  );
  assert.equal(second.status, 0, second.stderr);
  const secondRuntime = JSON.parse(second.stdout).destination;
  assert.equal(fs.existsSync(path.join(secondRuntime, "solution-mapping.json")), true);
});

test("prepare-run CLI passes batch scratch and concurrency options", () => {
  const workspacePath = createTemporaryDirectory();
  const attemptScratchRoot = path.join(workspacePath, "batch", "attempt-1");
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "prepare-run",
      "--workspace-path", workspacePath,
      "--run-id", "20260817-130000",
      "--language", "java",
      "--domains", "security",
      "--coverage", "full",
      "--attempt-scratch-root", attemptScratchRoot,
      "--max-concurrency", "1",
      "--target-runtime", "java-21",
      "--target-compute-services", "azure-container-apps,app-service",
      "--enable-containerization", "true",
      "--target-os", "linux",
      "--minimum-cve-severity", "high",
      "--cve-scan-scope", "all",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.attemptScratchRoot, path.resolve(attemptScratchRoot));
  assert.equal(fs.statSync(attemptScratchRoot).isDirectory(), true);
  assert.deepEqual(plan.batches.map((batch) => batch.maxConcurrency), [1, 1]);
  assert.deepEqual(plan.assessmentConfig, {
    targetRuntime: "java-21",
    targetComputeServices: ["azure-container-apps", "app-service"],
    enableContainerization: true,
    targetOS: ["linux"],
    minimumCveSeverity: "high",
    cveScanScope: "all",
  });
  assert.equal(
    plan.batches.flatMap((batch) => batch.tasks).every(
      (taskEntry) => !path.relative(attemptScratchRoot, taskEntry.outputPath).startsWith(".."),
    ),
    true,
  );
});

test("loadMemory warns on unsupported persisted schema versions", () => {
  const memoryDir = createTemporaryDirectory();
  writeFile(memoryDir, "findings.yaml", "version: 2\nfindings: []\n");

  const result = loadMemory({ memoryDir });

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /unsupported schema version/);
});

test("parseYaml preserves empty collection types", () => {
  assert.deepEqual(parseYaml("mapping: {}\nsequence: []\n"), {
    mapping: {},
    sequence: [],
  });
});
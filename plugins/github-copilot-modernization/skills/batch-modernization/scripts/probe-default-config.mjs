#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function probeDefaultBatchConfig({ launchRoot } = {}) {
  if (!path.isAbsolute(launchRoot ?? "")) {
    throw new Error("launch-root must be an absolute path");
  }
  const resolvedLaunchRoot = path.resolve(launchRoot);
  const stat = fs.statSync(resolvedLaunchRoot, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) {
    throw new Error("launch-root must be an existing directory");
  }
  const configPath = path.join(resolvedLaunchRoot, ".github", "modernize", "repos.json");
  const configStat = fs.statSync(configPath, { throwIfNoEntry: false });
  return {
    schemaVersion: 1,
    launchRoot: resolvedLaunchRoot,
    configPath,
    status: configStat?.isFile() ? "found" : configStat ? "invalid" : "absent",
  };
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(probeDefaultBatchConfig({
      launchRoot: optionValue("--launch-root"),
    }))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: "batch_mode_probe_failed",
      message: error.message,
    })}\n`);
    process.exitCode = 1;
  }
}
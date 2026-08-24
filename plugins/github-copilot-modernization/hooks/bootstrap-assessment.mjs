#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function readHookInput() {
  try {
    const text = fs.readFileSync(0, "utf8").trim();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

const input = readHookInput();
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
  ?? process.env.COPILOT_PLUGIN_ROOT
  ?? process.env.PLUGIN_ROOT;
const projectRoot = input.cwd
  ?? process.env.CLAUDE_PROJECT_DIR
  ?? process.cwd();

if (!pluginRoot) {
  console.error("Assessment bootstrap failed: plugin root is unavailable.");
  process.exit(2);
}

const source = path.join(pluginRoot, "skills", "assessment");
const destination = path.join(projectRoot, ".github", "modernize", ".runtime", "assessment");
const modules = ["assess-cli.mjs", "assess-state.mjs", "assess-report.mjs", "assess-runtime.mjs", "assessment-catalog.mjs"];

for (const moduleName of modules) {
  copyFile(path.join(source, "scripts", moduleName), path.join(destination, moduleName));
}
copyFile(
  path.join(source, "scripts", "templates", "report.html"),
  path.join(destination, "templates", "report.html"),
);
copyFile(
  path.join(source, "resources", "solution-mapping.json"),
  path.join(destination, "solution-mapping.json"),
);

fs.writeFileSync(path.join(destination, ".gitignore"), "*\n!.gitignore\n", "utf8");
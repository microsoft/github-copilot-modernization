import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.join(pluginRoot, "skills");
const agentsRoot = path.join(pluginRoot, "agents");
const thisFile = fileURLToPath(import.meta.url);

function walkFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}

test("every plugin skill is one direct child of the skills root", () => {
  const skillFiles = walkFiles(skillsRoot).filter((filePath) => path.basename(filePath) === "SKILL.md");
  const nestedSkillFiles = skillFiles.filter(
    (filePath) => path.dirname(path.dirname(filePath)) !== skillsRoot,
  );
  const directoriesWithoutSkills = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((directory) => !fs.existsSync(path.join(skillsRoot, directory, "SKILL.md")));

  assert.deepEqual(nestedSkillFiles, []);
  assert.deepEqual(directoriesWithoutSkills, []);

  for (const skillFile of skillFiles) {
    const directory = path.basename(path.dirname(skillFile));
    const content = fs.readFileSync(skillFile, "utf8");
    const declaredName = content.match(/^name:\s*['"]?([^'"\r\n]+)['"]?$/m)?.[1];
    assert.equal(declaredName, directory, skillFile);
    assert.match(content, /^user-invocable:\s*false$/m, `${skillFile} must be internal`);
  }
});

test("modernize is the only user-invocable plugin agent", () => {
  const agentFiles = fs.readdirSync(agentsRoot)
    .filter((name) => name.endsWith(".agent.md"));
  for (const name of agentFiles) {
    const content = fs.readFileSync(path.join(agentsRoot, name), "utf8");
    const agentName = content.match(/^name:\s*['"]?([^'"\r\n]+)['"]?$/m)?.[1];
    const userInvocable = content.match(/^user-invocable:\s*(true|false)$/m)?.[1];
    assert.ok(agentName, `${name} must declare a name`);
    assert.equal(
      userInvocable,
      agentName === "modernize" ? "true" : "false",
      `${name} has an invalid user-invocable value`,
    );
  }
});

test("plugin functionality does not depend on the external modernize CLI", () => {
  const textExtensions = new Set([".js", ".json", ".md", ".mjs", ".yaml", ".yml"]);
  const forbidden = [
    /modernize[- ]cli/i,
    /\bGet-Command\s+modernize\b/i,
    /\bcommand\s+-v\s+modernize\b/i,
    /^\s*modernize(?:\.exe)?\s+(?:--\S+|assess\b|plan\b|execute\b|run\b)/im,
  ];
  const violations = walkFiles(pluginRoot)
    .filter((filePath) => filePath !== thisFile && textExtensions.has(path.extname(filePath)))
    .flatMap((filePath) => {
      const content = fs.readFileSync(filePath, "utf8");
      return forbidden.some((pattern) => pattern.test(content)) ? [path.relative(pluginRoot, filePath)] : [];
    });

  assert.deepEqual(violations, []);
});
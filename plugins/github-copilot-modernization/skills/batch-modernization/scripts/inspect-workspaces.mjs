import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { normalizeRemoteIdentity, sanitizeGitUrl } from "./resolve-repos.mjs";
import { validateSchema } from "./schema-validator.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const resolvedSchemaPath = path.resolve(scriptRoot, "..", "schemas", "resolved-repos.schema.json");
const resolvedSchema = JSON.parse(fs.readFileSync(resolvedSchemaPath, "utf8"));

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".github",
  "bin",
  "build",
  "dist",
  "node_modules",
  "obj",
  "target",
  "vendor",
]);

export class WorkspaceInspectionError extends Error {
  constructor(message, code = "workspace_inspection_failed") {
    super(message);
    this.name = "WorkspaceInspectionError";
    this.code = code;
  }
}

function canonicalCase(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

export function canonicalPath(inputPath) {
  return fs.realpathSync.native(path.resolve(inputPath));
}

export function isPathInside(rootPath, candidatePath) {
  const root = canonicalCase(path.resolve(rootPath));
  const candidate = canonicalCase(path.resolve(candidatePath));
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertCanonicalContainment(rootPath, candidatePath) {
  const root = canonicalPath(rootPath);
  const candidate = canonicalPath(candidatePath);
  if (!isPathInside(root, candidate)) {
    throw new WorkspaceInspectionError(
      `Canonical path escapes the approved root: ${candidatePath}`,
      "path_escape",
    );
  }
  return { root, candidate };
}

function walkForExtensions(rootPath, extensions, maxEntries = 10_000) {
  const pending = [rootPath];
  let visited = 0;
  while (pending.length > 0 && visited < maxEntries) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) {
          pending.push(path.join(current, entry.name));
        }
      } else if (extensions.has(path.extname(entry.name).toLowerCase())) {
        return true;
      }
      if (visited >= maxEntries) break;
    }
  }
  return false;
}

export function detectProjectLanguages(workspacePath) {
  const exists = (name) => fs.existsSync(path.join(workspacePath, name));
  const entries = fs.existsSync(workspacePath)
    ? fs.readdirSync(workspacePath, { withFileTypes: true })
    : [];
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const languages = [];
  if (
    exists("pom.xml")
    || exists("build.gradle")
    || exists("build.gradle.kts")
    || walkForExtensions(workspacePath, new Set([".java", ".kt", ".scala"]))
  ) {
    languages.push("java");
  }
  if (
    fileNames.some((name) => /\.(?:sln|slnx|csproj)$/i.test(name))
    || walkForExtensions(workspacePath, new Set([".cs"]))
  ) {
    languages.push("dotnet");
  }
  if (exists("package.json")) {
    const hasTypeScript = exists("tsconfig.json")
      || walkForExtensions(workspacePath, new Set([".ts", ".tsx"]));
    languages.push(hasTypeScript ? "typescript" : "javascript");
  }
  return [...new Set(languages)];
}

export function redactSecrets(value) {
  return String(value ?? "")
    .replace(/(?:https?|ssh):\/\/[^\s'"<>]+/gi, (match) => {
      try {
        return sanitizeGitUrl(match.replace(/[),.;]+$/, ""));
      } catch {
        return "<redacted-git-url>";
      }
    })
    .replace(/(?:[^@\s/:]+@)?[^\s/:]+:[^\s]+\.git(?:\?[^\s]*)?(?:#[^\s]*)?/g, (match) => {
      try {
        return sanitizeGitUrl(match);
      } catch {
        return "<redacted-git-url>";
      }
    });
}

function runCommand(executable, args, { cwd, spawnSyncImpl = spawnSync } = {}) {
  const result = spawnSyncImpl(executable, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? "").trim(),
    stderr: redactSecrets(result.stderr ?? result.error?.message ?? ""),
    error: result.error,
  };
}

function gitValue(args, options) {
  const result = runCommand(options.gitExecutable ?? "git", args, options);
  return result.status === 0 ? result.stdout : null;
}

export function inspectGitWorkspace(workspacePath, {
  expectedUrl,
  expectedBranch,
  gitExecutable = "git",
  spawnSyncImpl = spawnSync,
} = {}) {
  const options = { cwd: workspacePath, gitExecutable, spawnSyncImpl };
  const inside = gitValue(["rev-parse", "--is-inside-work-tree"], options);
  if (inside !== "true") {
    return { isGit: false, errors: [], warnings: ["workspace is not a Git repository"] };
  }
  const gitRoot = gitValue(["rev-parse", "--show-toplevel"], options);
  const branch = gitValue(["branch", "--show-current"], options) || null;
  const originRaw = gitValue(["remote", "get-url", "origin"], options);
  const status = gitValue(["status", "--porcelain"], options) ?? "";
  const warnings = [];
  const errors = [];
  let origin = null;
  let originIdentity = null;
  if (originRaw) {
    try {
      origin = sanitizeGitUrl(originRaw);
      originIdentity = normalizeRemoteIdentity(originRaw);
    } catch {
      errors.push("Git origin is not a supported HTTPS or SSH repository URL");
    }
  }
  if (expectedUrl) {
    if (!originIdentity) {
      errors.push("Git origin is missing");
    } else if (originIdentity !== normalizeRemoteIdentity(expectedUrl)) {
      errors.push("Git origin does not match the configured repository URL");
    }
  }
  if (expectedBranch && branch !== expectedBranch) {
    errors.push(`current branch ${JSON.stringify(branch)} does not match configured branch ${JSON.stringify(expectedBranch)}`);
  }
  if (status) warnings.push("workspace has uncommitted changes");
  return {
    isGit: true,
    gitRoot: gitRoot ? canonicalPath(gitRoot) : canonicalPath(workspacePath),
    origin,
    branch,
    dirty: Boolean(status),
    warnings,
    errors,
  };
}

function lexicalPathInside(rootPath, candidatePath) {
  return isPathInside(path.resolve(rootPath), path.resolve(candidatePath));
}

function isAuthorizedWorkspace(workspacePath, allowedRoots) {
  if (!fs.existsSync(workspacePath)) return false;
  const canonicalWorkspace = canonicalPath(workspacePath);
  return allowedRoots.some((root) => {
    if (!fs.existsSync(root)) return false;
    return isPathInside(canonicalPath(root), canonicalWorkspace);
  });
}

function inspectExecutionUnits(repository, canonicalWorkspace, gitRoot) {
  const errors = [];
  const units = [];
  for (const planned of repository.executionUnits) {
    let unitPath;
    try {
      unitPath = canonicalPath(planned.workspacePath);
    } catch {
      errors.push(`${planned.executionUnitId}: project path does not exist`);
      continue;
    }
    if (!isPathInside(canonicalWorkspace, unitPath)) {
      errors.push(`${planned.executionUnitId}: canonical project path escapes the repository workspace`);
      continue;
    }
    const languages = detectProjectLanguages(unitPath);
    if (languages.length === 0) {
      errors.push(`${planned.executionUnitId}: no supported project was detected`);
      continue;
    }
    units.push({
      ...planned,
      workspacePath: unitPath,
      gitRoot,
      scopeRoots: [unitPath],
      languages,
    });
  }
  return { units, errors };
}

export function inspectResolvedRepositories(resolved, {
  allowedRoots = [],
  gitExecutable = "git",
  spawnSyncImpl = spawnSync,
} = {}) {
  const schemaErrors = validateSchema(resolved, resolvedSchema, resolvedSchemaPath);
  if (schemaErrors.length > 0) {
    throw new WorkspaceInspectionError(
      `Resolved repository input violates the v1 schema: ${schemaErrors.join("; ")}`,
      resolved?.schemaVersion === 1 ? "invalid_resolved_input" : "unsupported_schema",
    );
  }
  const repositories = resolved.repositories.map((repository) => {
    const warnings = repository.warnings.filter((warning) => warning !== "workspace inspection pending");
    const errors = [];
    if (!fs.existsSync(repository.workspacePath)) {
      if (repository.input.url) {
        warnings.push("repository clone is required");
        return { ...repository, preflightStatus: "needs_attention", warnings, errors, executionUnits: [] };
      }
      errors.push("local workspace does not exist");
      return { ...repository, preflightStatus: "blocked", warnings, errors, executionUnits: [] };
    }
    if (!isAuthorizedWorkspace(repository.workspacePath, allowedRoots)) {
      errors.push("workspace is outside the approved path roots");
      return { ...repository, preflightStatus: "blocked", warnings, errors, executionUnits: [] };
    }

    const canonicalWorkspace = canonicalPath(repository.workspacePath);
    const git = inspectGitWorkspace(canonicalWorkspace, {
      expectedUrl: repository.input.url,
      expectedBranch: repository.input.branch,
      gitExecutable,
      spawnSyncImpl,
    });
    warnings.push(...git.warnings);
    errors.push(...git.errors);
    if (repository.input.url && !git.isGit) {
      errors.push("configured clone target exists but is not a Git repository");
    }
    const gitRoot = git.isGit ? git.gitRoot : canonicalWorkspace;
    const inspectedUnits = inspectExecutionUnits(repository, canonicalWorkspace, gitRoot);
    errors.push(...inspectedUnits.errors);
    let preflightStatus = "ready";
    if (errors.length > 0 || inspectedUnits.units.length === 0) {
      preflightStatus = inspectedUnits.units.length > 0 && !repository.input.url
        ? "needs_attention"
        : "blocked";
    } else if (warnings.length > 0) {
      preflightStatus = "needs_attention";
    }
    return {
      ...repository,
      workspacePath: canonicalWorkspace,
      preflightStatus,
      warnings,
      errors,
      executionUnits: inspectedUnits.units,
    };
  });
  return { ...resolved, repositories };
}

function ensureCloneTargetAllowed(targetPath, allowedRoot) {
  const parent = path.dirname(path.resolve(targetPath));
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  const canonicalRoot = canonicalPath(allowedRoot);
  const canonicalParent = canonicalPath(parent);
  if (!lexicalPathInside(canonicalRoot, canonicalParent)) {
    throw new WorkspaceInspectionError("Clone target is outside the approved clone root", "path_escape");
  }
}

function operationalCloneUrl(value) {
  sanitizeGitUrl(value);
  if (!value.includes("://")) return value.trim();
  const parsed = new URL(value.trim());
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  if (parsed.protocol === "https:") parsed.username = "";
  return parsed.toString();
}

export function cloneRepository({
  url,
  targetPath,
  branch = null,
  allowedRoot,
  gitExecutable = "git",
  spawnSyncImpl = spawnSync,
} = {}) {
  const transportUrl = operationalCloneUrl(url);
  const absoluteTarget = path.resolve(targetPath);
  ensureCloneTargetAllowed(absoluteTarget, allowedRoot);
  if (fs.existsSync(absoluteTarget)) {
    throw new WorkspaceInspectionError("Clone target already exists", "clone_target_exists");
  }
  const temporaryPath = path.join(
    path.dirname(absoluteTarget),
    `.${path.basename(absoluteTarget)}.clone-${crypto.randomUUID()}`,
  );
  const args = ["clone"];
  if (branch) args.push("--branch", branch, "--single-branch");
  args.push("--", transportUrl, temporaryPath);
  const result = runCommand(gitExecutable, args, {
    cwd: path.dirname(absoluteTarget),
    spawnSyncImpl,
  });
  if (result.status !== 0) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
    throw new WorkspaceInspectionError(
      `Git clone failed${result.stderr ? `: ${result.stderr}` : ""}`,
      "clone_failed",
    );
  }
  if (!fs.existsSync(temporaryPath)) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
    throw new WorkspaceInspectionError("Git clone reported success without creating a workspace", "clone_missing_output");
  }
  try {
    fs.renameSync(temporaryPath, absoluteTarget);
  } catch (error) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
    throw new WorkspaceInspectionError(`Unable to publish cloned workspace: ${error.message}`, "clone_publish_failed");
  }
  return absoluteTarget;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function optionValues(name) {
  return process.argv.flatMap((value, index) => value === name ? [process.argv[index + 1]] : []);
}

function emitResult(result) {
  const output = optionValue("--output");
  if (!output) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const outputPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporaryPath, outputPath);
  process.stdout.write(`${JSON.stringify({ outputPath })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    let result;
    if (command === "inspect") {
      const resolvedPath = path.resolve(optionValue("--resolved") ?? "");
      const resolved = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
      result = inspectResolvedRepositories(resolved, {
        allowedRoots: optionValues("--allowed-root").map((root) => path.resolve(root)),
      });
    } else if (command === "clone") {
      const url = process.env.BATCH_CLONE_URL;
      if (!url) throw new WorkspaceInspectionError("BATCH_CLONE_URL is required", "clone_url_required");
      result = {
        workspacePath: cloneRepository({
          url,
          targetPath: optionValue("--target"),
          allowedRoot: optionValue("--allowed-root"),
          branch: optionValue("--branch") ?? null,
        }),
      };
    } else {
      throw new WorkspaceInspectionError(`Unknown command: ${command}`, "unknown_command");
    }
    emitResult(result);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code, message: redactSecrets(error.message) })}\n`);
    process.exitCode = 1;
  }
}
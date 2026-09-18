import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_KEYS = new Set([
  "name",
  "url",
  "path",
  "branch",
  "include_paths",
]);
const ROOT_KEYS = new Set(["producer", "repos", "apps"]);
const APP_KEYS = new Set(["identifier", "repos"]);
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SECRET_KEY = /(?:password|passwd|token|secret|credential|api[-_]?key|access[-_]?key)$/i;

export class ConfigValidationError extends Error {
  constructor(issues) {
    super(`Invalid repos configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

function unknownFields(value, knownKeys) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !knownKeys.has(key))
      .map(([key, entry]) => [key, SECRET_KEY.test(key) ? "<redacted>" : sanitizeUnknownValue(entry)]),
  );
}

function sanitizeUnknownString(value) {
  return value.replace(/(?:https?|ssh):\/\/[^\s'"<>]+/gi, (candidate) => {
    try {
      const parsed = new URL(candidate);
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "<redacted-url>";
    }
  });
}

function sanitizeUnknownValue(value) {
  if (typeof value === "string") return sanitizeUnknownString(value);
  if (Array.isArray(value)) return value.map(sanitizeUnknownValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEY.test(key) ? "<redacted>" : sanitizeUnknownValue(entry),
      ]),
    );
  }
  return value;
}

function ensureObject(value, field, issues) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${field} must be an object`);
    return null;
  }
  return value;
}

function requireString(value, field, issues) {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${field} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

export function sanitizeRepositoryName(name) {
  const sanitized = String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 128);
  return WINDOWS_RESERVED_NAME.test(sanitized) ? `repo-${sanitized}` : sanitized;
}

function isValidBranchName(branch) {
  return !(
    branch === "@"
    || branch.startsWith("-")
    || branch.startsWith("/")
    || branch.endsWith("/")
    || branch.endsWith(".")
    || branch.includes("//")
    || branch.includes("..")
    || branch.includes("@{")
    || /[\u0000-\u0020\u007f~^:?*[\\]/.test(branch)
    || branch.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
  );
}

function parseScpGitUrl(value) {
  if (value.includes("://")) {
    return null;
  }
  const match = value.match(/^(?:[^@/:\s]+@)?([^/:\s]+):(.+)$/);
  if (!match || /^[A-Za-z]:[\\/]/.test(value)) {
    return null;
  }
  return { host: match[1].toLowerCase(), repositoryPath: match[2] };
}

function cleanRepositoryPath(repositoryPath) {
  return repositoryPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
}

export function sanitizeGitUrl(value) {
  if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) {
    throw new Error("Git URL must be a non-empty single-line string");
  }
  const input = value.trim();
  const scp = parseScpGitUrl(input);
  if (scp) {
    const repositoryPath = cleanRepositoryPath(scp.repositoryPath);
    if (!repositoryPath) throw new Error("Git URL has no repository path");
    return `ssh://${scp.host}/${repositoryPath}.git`;
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Git URL must use HTTPS, SSH, or SCP-style SSH syntax");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") {
    throw new Error("Git URL protocol must be HTTPS or SSH");
  }
  const repositoryPath = cleanRepositoryPath(parsed.pathname);
  if (!parsed.hostname || !repositoryPath) {
    throw new Error("Git URL must include a host and repository path");
  }
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${port}/${repositoryPath}.git`;
}

export function normalizeRemoteIdentity(value) {
  const sanitized = sanitizeGitUrl(value);
  const parsed = new URL(sanitized);
  return `${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}/${cleanRepositoryPath(parsed.pathname).toLowerCase()}`;
}

function normalizeIncludePaths(value, field, issues) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return [];
  }
  const normalized = [];
  for (const [index, entry] of value.entries()) {
    const itemField = `${field}[${index}]`;
    const text = requireString(entry, itemField, issues);
    if (!text) continue;
    if (path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text)) {
      issues.push(`${itemField} must be repository-relative`);
      continue;
    }
    const clean = path.posix.normalize(text.replace(/\\/g, "/")).replace(/^\.\//, "");
    if (clean === ".." || clean.startsWith("../") || clean === ".") {
      issues.push(`${itemField} must stay inside the repository and name a project path`);
      continue;
    }
    if (!normalized.includes(clean)) normalized.push(clean);
  }
  return normalized;
}

function expandHome(inputPath, homeDir) {
  if (inputPath === "~") return homeDir;
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

function createExecutionUnits(repoId, workspacePath, includePaths, issues, field) {
  const relativePaths = includePaths.length > 0 ? includePaths : [null];
  const seen = new Set();
  return relativePaths.flatMap((relativePath) => {
    const suffix = relativePath ? sanitizeRepositoryName(relativePath.replaceAll("/", "-")) : "";
    const executionUnitId = suffix ? `${repoId}/${suffix}` : repoId;
    if (seen.has(executionUnitId.toLowerCase())) {
      issues.push(`${field} produces duplicate execution unit ${JSON.stringify(executionUnitId)}`);
      return [];
    }
    seen.add(executionUnitId.toLowerCase());
    const unitPath = relativePath ? path.resolve(workspacePath, ...relativePath.split("/")) : workspacePath;
    return [{
      schemaVersion: 1,
      repoId,
      executionUnitId,
      displayName: relativePath ? `${repoId}/${relativePath}` : repoId,
      workspacePath: unitPath,
      gitRoot: workspacePath,
      scopeRoots: [unitPath],
      languages: ["unknown"],
      source: relativePath ? "include-path" : "repository-root",
    }];
  });
}

function normalizeRepository(raw, index, context, issues) {
  const field = `repos[${index}]`;
  const repository = ensureObject(raw, field, issues);
  if (!repository) return null;
  const name = requireString(repository.name, `${field}.name`, issues);
  const repoId = name ? sanitizeRepositoryName(name) : "";
  if (name && !repoId) issues.push(`${field}.name does not produce a usable repository identifier`);

  const warnings = [];
  let sanitizedUrl = null;
  if (repository.url !== undefined && repository.url !== null) {
    try {
      sanitizedUrl = sanitizeGitUrl(repository.url);
    } catch (error) {
      issues.push(`${field}.url: ${error.message}`);
    }
  }
  let configuredPath = null;
  if (repository.path !== undefined && repository.path !== null) {
    const pathText = requireString(repository.path, `${field}.path`, issues);
    if (pathText) {
      const expanded = expandHome(pathText, context.homeDir);
      if (!path.isAbsolute(expanded)) {
        issues.push(`${field}.path must be absolute`);
      } else {
        configuredPath = path.resolve(expanded);
      }
    }
  }
  if (!sanitizedUrl && !configuredPath) {
    issues.push(`${field} must define url or path`);
  }
  if (sanitizedUrl && configuredPath) {
    warnings.push("Both url and path are present; url takes precedence");
  }

  let branch = null;
  if (repository.branch !== undefined && repository.branch !== null) {
    const branchText = requireString(repository.branch, `${field}.branch`, issues);
    if (branchText && !isValidBranchName(branchText)) {
      issues.push(`${field}.branch contains unsupported Git ref characters`);
    } else if (branchText && sanitizedUrl) {
      branch = branchText;
    } else if (branchText) {
      warnings.push("branch is ignored for a local path repository");
    }
  }

  const includePaths = normalizeIncludePaths(repository.include_paths, `${field}.include_paths`, issues);
  const workspacePath = sanitizedUrl
    ? path.join(context.launchRoot, "repos", repoId || `invalid-${index}`)
    : configuredPath;
  const executionUnits = workspacePath && repoId
    ? createExecutionUnits(repoId, workspacePath, includePaths, issues, `${field}.include_paths`)
    : [];

  return {
    repoId,
    name: name ?? "",
    input: {
      url: sanitizedUrl,
      path: configuredPath,
      branch,
      includePaths,
    },
    workspacePath: workspacePath ?? "",
    preflightStatus: "needs_attention",
    warnings: [...warnings, "workspace inspection pending"],
    errors: [],
    executionUnits,
    unknownFields: unknownFields(repository, REPOSITORY_KEYS),
  };
}

function normalizeApps(rawApps, repositories, issues) {
  if (rawApps === undefined) return [];
  if (!Array.isArray(rawApps)) {
    issues.push("apps must be an array");
    return [];
  }
  const names = new Map(repositories.map((repo) => [repo.name.toLowerCase(), repo.repoId]));
  const identifiers = new Set();
  return rawApps.flatMap((raw, index) => {
    const field = `apps[${index}]`;
    const app = ensureObject(raw, field, issues);
    if (!app) return [];
    const identifier = requireString(app.identifier, `${field}.identifier`, issues);
    if (identifier && identifiers.has(identifier.toLowerCase())) {
      issues.push(`${field}.identifier duplicates another app (case-insensitive)`);
    }
    if (identifier) identifiers.add(identifier.toLowerCase());
    if (!Array.isArray(app.repos)) {
      issues.push(`${field}.repos must be an array`);
      return [];
    }
    const repoIds = [];
    for (const [repoIndex, repositoryName] of app.repos.entries()) {
      const text = requireString(repositoryName, `${field}.repos[${repoIndex}]`, issues);
      if (!text) continue;
      const repoId = names.get(text.toLowerCase());
      if (!repoId) {
        issues.push(`${field}.repos[${repoIndex}] references unknown repository ${JSON.stringify(text)}`);
      } else if (!repoIds.includes(repoId)) {
        repoIds.push(repoId);
      }
    }
    return [{ identifier: identifier ?? "", repoIds, unknownFields: unknownFields(app, APP_KEYS) }];
  });
}

export function resolveReposDocument(document, {
  configPath,
  configSha256,
  launchRoot,
  homeDir = os.homedir(),
} = {}) {
  const issues = [];
  const absoluteLaunchRoot = path.resolve(launchRoot ?? process.cwd());
  let producer = null;
  let rawRepositories;
  let rawApps = [];
  if (Array.isArray(document)) {
    rawRepositories = document;
  } else {
    const root = ensureObject(document, "configuration", issues);
    rawRepositories = root?.repos;
    rawApps = root?.apps;
    producer = root?.producer === undefined || root?.producer === null
      ? null
      : requireString(root.producer, "producer", issues);
    if (root && !Array.isArray(rawRepositories)) issues.push("repos must be an array");
  }
  if (Array.isArray(rawRepositories) && rawRepositories.length === 0) {
    issues.push("repos must contain at least one repository");
  }

  const repositories = Array.isArray(rawRepositories)
    ? rawRepositories.map((repo, index) => normalizeRepository(repo, index, {
      launchRoot: absoluteLaunchRoot,
      homeDir,
    }, issues)).filter(Boolean)
    : [];
  const names = new Set();
  const repoIds = new Set();
  for (const [index, repository] of repositories.entries()) {
    const nameKey = repository.name.toLowerCase();
    const idKey = repository.repoId.toLowerCase();
    if (names.has(nameKey)) issues.push(`repos[${index}].name duplicates another repository (case-insensitive)`);
    if (repoIds.has(idKey)) issues.push(`repos[${index}].name collides after path sanitization`);
    names.add(nameKey);
    repoIds.add(idKey);
  }
  const apps = normalizeApps(rawApps, repositories, issues);
  if (issues.length > 0) throw new ConfigValidationError(issues);

  return {
    schemaVersion: 1,
    configPath: path.resolve(configPath ?? path.join(absoluteLaunchRoot, ".github", "modernize", "repos.json")),
    configSha256: configSha256 ?? crypto.createHash("sha256").update(JSON.stringify(document)).digest("hex"),
    producer,
    repositories,
    apps,
    unknownFields: Array.isArray(document) ? {} : unknownFields(document, ROOT_KEYS),
  };
}

export function resolveReposFile(configPath, options = {}) {
  const absoluteConfigPath = path.resolve(configPath);
  const raw = fs.readFileSync(absoluteConfigPath);
  let document;
  try {
    document = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new ConfigValidationError([`configuration is not valid JSON: ${error.message}`]);
  }
  return resolveReposDocument(document, {
    ...options,
    configPath: absoluteConfigPath,
    configSha256: crypto.createHash("sha256").update(raw).digest("hex"),
  });
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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
  try {
    const result = resolveReposFile(optionValue("--config") ?? "", {
      launchRoot: optionValue("--launch-root") ?? process.cwd(),
    });
    emitResult(result);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
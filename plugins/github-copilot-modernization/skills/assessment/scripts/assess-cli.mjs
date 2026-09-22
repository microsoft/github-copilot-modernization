#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_MAX_PATCHES = 20;
const MINIMUM_HTML_BYTES = 10_000;
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const COVERAGE_SOURCES = new Set(["default", "explicit-user", "approved-batch"]);
const SCALAR_PATTERN = /^(?<key>[A-Za-z0-9_-]+):\s*(?<value>.*)$/;
const BLOCK_INDICATOR_PATTERN = /^[|>][+-]?$/;

function splitInlineSequence(value) {
  const items = [];
  let current = "";
  let quote = null;
  let nestedDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      current += character;
      if (character === "\\" && quote === '"' && index + 1 < value.length) {
        current += value[index + 1];
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "[" || character === "{") {
      nestedDepth += 1;
      current += character;
      continue;
    }
    if (character === "]" || character === "}") {
      nestedDepth -= 1;
      current += character;
      continue;
    }
    if (character === "," && nestedDepth === 0) {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }

  if (current.trim() || value.trim()) {
    items.push(current.trim());
  }
  return items;
}

function coerceScalar(value) {
  const scalar = value.trim();
  if (scalar === "" || scalar === "~" || scalar.toLowerCase() === "null") {
    return null;
  }
  if (scalar.toLowerCase() === "true") {
    return true;
  }
  if (scalar.toLowerCase() === "false") {
    return false;
  }
  if (
    (scalar.startsWith('"') && scalar.endsWith('"')) ||
    (scalar.startsWith("'") && scalar.endsWith("'"))
  ) {
    if (scalar.startsWith('"')) {
      try {
        return JSON.parse(scalar);
      } catch {
        return scalar.slice(1, -1);
      }
    }
    return scalar.slice(1, -1);
  }
  if (scalar.startsWith("[") && scalar.endsWith("]")) {
    const inner = scalar.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return splitInlineSequence(inner).map((item) => coerceScalar(item));
  }
  if (scalar === "{}") {
    return {};
  }
  if (scalar.startsWith("{") && scalar.endsWith("}")) {
    try {
      return JSON.parse(scalar.replaceAll("'", '"'));
    } catch {
      return scalar;
    }
  }
  if (/^-?\d+$/.test(scalar)) {
    return Number.parseInt(scalar, 10);
  }
  if (/^-?(?:\d+\.\d*|\d*\.\d+)$/.test(scalar)) {
    return Number.parseFloat(scalar);
  }
  return scalar;
}

function tokenizeYaml(text) {
  const rawLines = text.split(/\r?\n/);
  const tokens = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    let line = rawLine;
    if (line.includes("#") && !line.includes('"') && !line.includes("'")) {
      line = line.split("#", 1)[0].trimEnd();
    }
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    const scalarMatch = SCALAR_PATTERN.exec(content);

    if (
      scalarMatch &&
      BLOCK_INDICATOR_PATTERN.test(scalarMatch.groups.value.trim())
    ) {
      const indicator = scalarMatch.groups.value.trim();
      const blockLines = [];
      let blockIndent = null;
      let nextIndex = index + 1;

      for (; nextIndex < rawLines.length; nextIndex += 1) {
        const innerLine = rawLines[nextIndex];
        if (!innerLine.trim()) {
          blockLines.push("");
          continue;
        }
        const innerIndent = innerLine.length - innerLine.trimStart().length;
        if (innerIndent <= indent) {
          break;
        }
        blockIndent ??= innerIndent;
        blockLines.push(innerLine.slice(blockIndent));
      }

      while (blockLines.at(-1) === "") {
        blockLines.pop();
      }
      let blockValue = blockLines.join("\n");
      if (indicator.includes("+")) {
        blockValue += "\n";
      }
      tokens.push({
        indent,
        content: `${scalarMatch.groups.key}: ${JSON.stringify(blockValue)}`,
      });
      index = nextIndex - 1;
      continue;
    }

    tokens.push({ indent, content });
  }

  return tokens;
}

export function parseYaml(text) {
  const tokens = tokenizeYaml(text);
  let position = 0;

  function parseBlock(indent) {
    if (position >= tokens.length) {
      return null;
    }
    if (tokens[position].content.startsWith("- ")) {
      return parseSequence(indent);
    }
    return parseMapping(indent);
  }

  function parseMapping(indent) {
    const result = {};
    while (position < tokens.length) {
      const token = tokens[position];
      if (token.indent < indent) {
        break;
      }
      if (token.indent > indent) {
        position += 1;
        continue;
      }

      const match = SCALAR_PATTERN.exec(token.content);
      if (!match) {
        position += 1;
        continue;
      }
      const key = match.groups.key;
      const value = match.groups.value.trim();
      position += 1;
      if (value === "") {
        if (position < tokens.length && tokens[position].indent > indent) {
          result[key] = parseBlock(tokens[position].indent);
        } else {
          result[key] = null;
        }
      } else {
        result[key] = coerceScalar(value);
      }
    }
    return result;
  }

  function parseSequence(indent) {
    const result = [];
    while (position < tokens.length) {
      const token = tokens[position];
      if (token.indent < indent || !token.content.startsWith("- ")) {
        break;
      }
      if (token.indent > indent) {
        position += 1;
        continue;
      }

      const body = token.content.slice(2).trim();
      position += 1;
      if (/^[A-Za-z0-9_-]+:(?:\s|$)/.test(body) && !body.startsWith('"')) {
        tokens.splice(position, 0, { indent: indent + 2, content: body });
        result.push(parseMapping(indent + 2));
      } else if (body === "") {
        if (position < tokens.length && tokens[position].indent > indent) {
          result.push(parseBlock(tokens[position].indent));
        } else {
          result.push(null);
        }
      } else {
        result.push(coerceScalar(body));
      }
    }
    return result;
  }

  return tokens.length === 0 ? {} : parseBlock(tokens[0].indent);
}

function readYaml(filePath, warnings) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return parseYaml(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    warnings.push(`[warn] failed to parse ${filePath}: ${error.message}`);
    return null;
  }
}

function readVersionedYaml(filePath, warnings) {
  const document = readYaml(filePath, warnings);
  if (document && typeof document === "object" && document.version !== undefined && document.version !== 1) {
    warnings.push(`[warn] unsupported schema version in ${filePath}: ${document.version}`);
  }
  return document;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function filterPatches(allPatches, intent, maxPatches) {
  const active = allPatches.filter((patch) => patch?.state === "active");
  const relevant = active.filter((patch) => {
    if (!intent || intent === "unknown") {
      return true;
    }
    const intents = normalizeArray(patch?.applies_to?.intents).map((item) =>
      String(item).toLowerCase(),
    );
    return intents.length === 0 || intents.includes(intent.toLowerCase()) || intents.includes("full");
  });

  relevant.sort((left, right) => {
    const leftTimestamp = String(
      left?.last_reinforced_at ?? left?.captured_at ?? "",
    );
    const rightTimestamp = String(
      right?.last_reinforced_at ?? right?.captured_at ?? "",
    );
    return rightTimestamp.localeCompare(leftTimestamp);
  });

  return {
    loaded: relevant.slice(0, maxPatches),
    totalActive: active.length,
    droppedOverflow: Math.max(0, relevant.length - maxPatches),
  };
}

function oneLine(value, limit = 80) {
  if (!value) {
    return "";
  }
  const flattened = String(value).split(/\s+/).join(" ").trim();
  if (flattened.length <= limit) {
    return flattened;
  }
  return `${flattened.slice(0, limit - 1).trimEnd()}\u2026`;
}

function groupPatchesByIntent(patches) {
  const groups = new Map();
  for (const patch of patches) {
    const intents = normalizeArray(patch?.applies_to?.intents);
    const primaryIntent = String(intents[0] ?? "unscoped");
    const group = groups.get(primaryIntent) ?? [];
    group.push(patch);
    groups.set(primaryIntent, group);
  }
  return groups;
}

function composeGreeting({
  findingsCount,
  suppressionCount,
  lastIntentFocus,
  loadedPatches,
  droppedOverflow,
  retiredCount,
  firstRun,
}) {
  if (firstRun) {
    return "First assessment in this repo. I'll set up .memory/ as we go.";
  }

  const lines = [];
  let base = `Loaded ${findingsCount} known findings`;
  if (suppressionCount > 0) {
    base += ` + ${suppressionCount} active suppression rules`;
  }
  if (loadedPatches.length > 0) {
    base += ` + ${loadedPatches.length} active behavioral patches`;
  }
  base += ".";
  if (lastIntentFocus) {
    base += ` Last time you focused on ${lastIntentFocus}.`;
  }
  lines.push(base);

  if (loadedPatches.length > 0) {
    lines.push("", "Active behavioral patches (hard constraints for this run):");
    const groups = groupPatchesByIntent(loadedPatches);
    for (const intent of [...groups.keys()].sort()) {
      const patches = groups.get(intent);
      const summaries = patches
        .slice(0, 3)
        .map((patch) => `${patch?.id ?? "bp-?"} \"${oneLine(patch?.actual, 60)}\"`)
        .join(", ");
      const more = patches.length > 3 ? ` (+${patches.length - 3} more)` : "";
      lines.push(`  - ${intent}: ${summaries}${more}`);
    }
    if (droppedOverflow > 0) {
      lines.push(
        `  (${droppedOverflow} additional active patches not loaded - exceeded max_loaded_per_run cap)`,
      );
    }
    if (retiredCount > 0) {
      lines.push(`  (${retiredCount} retired patches in archive - not loaded)`);
    }
  }

  return lines.join("\n");
}

function composePatchesPayload(patches) {
  return {
    patches: patches.map((patch) => ({
      id: patch?.id ?? null,
      scope: patch?.scope ?? null,
      source: patch?.source ?? null,
      prior: patch?.prior ?? null,
      actual: patch?.actual ?? null,
      applies_to: patch?.applies_to ?? {},
      reinforce_count: patch?.reinforce_count ?? 1,
      last_reinforced_at: patch?.last_reinforced_at ?? null,
    })),
  };
}

function formatUtcTimestamp(now) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function loadMemory({
  memoryDir,
  intent = "unknown",
  maxPatches,
  now = new Date(),
}) {
  const resolvedMemoryDir = path.resolve(memoryDir);
  const warnings = [];
  const firstRunDirectory = !fs.existsSync(resolvedMemoryDir);
  const findingsData = readVersionedYaml(path.join(resolvedMemoryDir, "findings.yaml"), warnings) ?? {};
  const suppressionsData =
    readVersionedYaml(path.join(resolvedMemoryDir, "suppressions.yaml"), warnings) ?? {};
  const preferences =
    readVersionedYaml(path.join(resolvedMemoryDir, "preferences.yaml"), warnings) ?? {};
  const lastIntent =
    readVersionedYaml(path.join(resolvedMemoryDir, "last-intent.yaml"), warnings) ?? {};
  const biasData =
    readVersionedYaml(path.join(resolvedMemoryDir, "bias-patches.yaml"), warnings) ?? {};

  const findings = normalizeArray(findingsData.findings);
  const suppressions = normalizeArray(suppressionsData.rules);
  const allPatches = normalizeArray(biasData.patches);
  const retiredCount = allPatches.filter((patch) =>
    ["retired", "superseded"].includes(patch?.state),
  ).length;
  const preferenceCap = preferences?.behavior?.bias_patches?.max_loaded_per_run;
  const resolvedCap = Number.isInteger(maxPatches)
    ? maxPatches
    : Number.isInteger(preferenceCap)
      ? preferenceCap
      : DEFAULT_MAX_PATCHES;
  const { loaded, totalActive, droppedOverflow } = filterPatches(
    allPatches,
    intent,
    resolvedCap,
  );
  const focus = lastIntent?.user_concern
    ? String(lastIntent.user_concern).replaceAll("-", " ")
    : null;
  const greeting = composeGreeting({
    findingsCount: findings.length,
    suppressionCount: suppressions.length,
    lastIntentFocus: focus,
    loadedPatches: loaded,
    droppedOverflow,
    retiredCount,
    firstRun: firstRunDirectory && allPatches.length === 0 && findings.length === 0,
  });
  const payload = composePatchesPayload(loaded);
  const receipt = [
    `loaded@${formatUtcTimestamp(now)}`,
    `findings=${findings.length}`,
    `patches=${loaded.length}/${totalActive}`,
    `suppressions=${suppressions.length}`,
  ].join(" ");

  return {
    greeting,
    payload,
    receipt,
    warnings,
    output: [
      "=== GREETING ===",
      greeting,
      "",
      "=== ACTIVE PATCHES ===",
      JSON.stringify(payload, null, 2),
      "",
      "=== RECEIPT TOKEN ===",
      receipt,
    ].join("\n"),
  };
}

function parseCommandLine(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function requireOption(options, name) {
  if (!options[name]) {
    throw new Error(`--${name} is required`);
  }
  return options[name];
}

function splitOption(value) {
  return value
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : undefined;
}

function positiveIntegerOption(options, name) {
  if (options[name] === undefined) {
    return undefined;
  }
  const parsed = Number(options[name]);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function booleanOption(options, name) {
  if (options[name] === undefined) return undefined;
  if (options[name] === "true") return true;
  if (options[name] === "false") return false;
  throw new Error(`--${name} must be true or false`);
}

function assessmentConfigOptions(options) {
  return Object.fromEntries(Object.entries({
    targetRuntime: options["target-runtime"],
    targetComputeServices: splitOption(options["target-compute-services"]),
    enableContainerization: booleanOption(options, "enable-containerization"),
    targetOS: splitOption(options["target-os"]),
    minimumCveSeverity: options["minimum-cve-severity"],
    cveScanScope: options["cve-scan-scope"],
  }).filter(([, value]) => value !== undefined));
}

function coverageSourceOption(options) {
  if (options["coverage-source"] !== undefined) {
    return options["coverage-source"];
  }
  if (options["attempt-scratch-root"] !== undefined) {
    return "approved-batch";
  }
  return "default";
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  const normalize = (values) => [...new Set(values.map(String))].sort();
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

function requireArtifact(workspaceRoot, artifactPath, label) {
  if (!artifactPath) throw new Error(`${label} artifact path is required`);
  const resolvedArtifactPath = path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(workspaceRoot, artifactPath);
  const stat = fs.statSync(resolvedArtifactPath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    throw new Error(`${label} artifact does not exist: ${resolvedArtifactPath}`);
  }
  const canonicalWorkspace = fs.realpathSync.native(workspaceRoot);
  const canonicalArtifact = fs.realpathSync.native(resolvedArtifactPath);
  const relativePath = path.relative(canonicalWorkspace, canonicalArtifact);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`${label} artifact escapes the workspace: ${resolvedArtifactPath}`);
  }
  return canonicalArtifact;
}

function readJsonArtifact(artifactPath, label) {
  try {
    return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  } catch (error) {
    throw new Error(`${label} artifact is not valid JSON: ${error.message}`);
  }
}

function verifiedCoverageSource(workspaceRoot, runId, analysisCoverage) {
  const intentPath = requireArtifact(
    workspaceRoot,
    path.join(".github", "modernize", ".memory", "runs", runId, "intent.yaml"),
    "assessment intent",
  );
  const intent = parseYaml(fs.readFileSync(intentPath, "utf8"));
  if (intent?.analysis_coverage !== analysisCoverage) {
    throw new Error("assessment intent coverage does not match the completed run");
  }
  const coverageSource = intent?.coverage_source;
  if (!COVERAGE_SOURCES.has(coverageSource)) {
    throw new Error(`unsupported assessment coverage source: ${coverageSource ?? "missing"}`);
  }
  if (analysisCoverage === "full" && coverageSource === "default") {
    throw new Error("full assessment coverage cannot have a default source");
  }
  return coverageSource;
}

function parseJsonArtifact(content, label) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${label} artifact is not valid JSON: ${error.message}`);
  }
}

function findingCounts(findings, tracked) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  const byState = {};
  for (const finding of findings) {
    const severity = String(finding?.severity ?? "info").toLowerCase();
    bySeverity[SEVERITIES.includes(severity) ? severity : "info"] += 1;
    const state = String(finding?.state ?? "new").toLowerCase();
    byState[state] = (byState[state] ?? 0) + 1;
  }
  return { total: findings.length, tracked, bySeverity, byState };
}

function validateSecurityResult(document, skillId) {
  let values;
  let partial = false;
  if (skillId === "cve-known-vulnerabilities" && Array.isArray(document)) {
    values = document;
  } else {
    const status = String(document?.status ?? "").toLowerCase();
    if (status === "not_applicable") return false;
    partial = status === "partial";
    if (partial) {
      if (!Array.isArray(document?.result?.evidence) || document.result.evidence.length === 0) {
        throw new Error(`partial security artifact ${skillId} has no failure evidence`);
      }
      if (!Array.isArray(document?.result?.values)) {
        throw new Error(`partial security artifact ${skillId} has no values array`);
      }
    } else if (!["success", "succeeded", "completed", "ok"].includes(status)) {
      throw new Error(`security artifact ${skillId} has no terminal status`);
    } else if (!Array.isArray(document?.result?.values) || document.result.values.length === 0) {
      throw new Error(`security artifact ${skillId} has no terminal rule evidence`);
    }
    values = document.result.values;
  }
  for (const [index, value] of values.entries()) {
    if (!["FOUND", "NOT_FOUND"].includes(String(value?.status ?? "").toUpperCase())) {
      throw new Error(`security artifact ${skillId} entry ${index} is not FOUND or NOT_FOUND`);
    }
  }
  return partial;
}

export async function verifyAssessmentArtifacts({
  workspacePath,
  runId,
  language,
  domains = [],
  analysisCoverage = "issue-only",
  reportPath,
  normalizedAssessmentPath,
  htmlPath,
  appcatReportPath,
  securityRoot,
} = {}) {
  const workspaceRoot = path.resolve(workspacePath ?? "");
  if (!fs.statSync(workspaceRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`workspace does not exist: ${workspaceRoot}`);
  }
  if (!runId) throw new Error("runId is required");
  const normalizedLanguage = String(language ?? "").toLowerCase();
  if (!["java", "dotnet", "javascript", "typescript"].includes(normalizedLanguage)) {
    throw new Error(`unsupported assessment language: ${language}`);
  }
  if (!["issue-only", "full"].includes(analysisCoverage)) {
    throw new Error(`unsupported assessment coverage: ${analysisCoverage}`);
  }

  const artifacts = {
    report: requireArtifact(workspaceRoot, reportPath, "report"),
    normalizedAssessment: requireArtifact(
      workspaceRoot,
      normalizedAssessmentPath,
      "normalized assessment",
    ),
    html: requireArtifact(workspaceRoot, htmlPath, "HTML report"),
  };
  const coverageSource = verifiedCoverageSource(workspaceRoot, runId, analysisCoverage);
  const normalizedAssessment = readJsonArtifact(
    artifacts.normalizedAssessment,
    "normalized assessment",
  );
  if (normalizedAssessment?.schemaVersion !== 1
      || normalizedAssessment.kind !== "github-copilot-modernization/normalized-assessment"
      || !normalizedAssessment.metadata
      || !Array.isArray(normalizedAssessment.categories)
      || !Array.isArray(normalizedAssessment.findings)
      || !Array.isArray(normalizedAssessment.security)) {
    throw new Error("normalized assessment artifact does not match its v1 contract");
  }
  if (normalizedAssessment.metadata.runId !== runId
      || normalizedAssessment.metadata.status !== "completed") {
    throw new Error("normalized assessment artifact does not match the completed run");
  }
  if (String(normalizedAssessment.metadata.language ?? "").toLowerCase() !== normalizedLanguage) {
    throw new Error("normalized assessment language does not match the completed run");
  }
  if (!sameStringSet(normalizedAssessment.metadata.domains, domains)) {
    throw new Error("normalized assessment domains do not match the completed run");
  }
  if (normalizedAssessment.metadata.totalFindings !== normalizedAssessment.findings.length
      || !Number.isInteger(normalizedAssessment.metadata.totalTrackedFindings)
      || normalizedAssessment.metadata.totalTrackedFindings < normalizedAssessment.findings.length) {
    throw new Error("normalized assessment finding counts are inconsistent");
  }
  const canonicalReport = readJsonArtifact(artifacts.report, "canonical report");
  if (canonicalReport?.version !== "1.0.0"
      || typeof canonicalReport.producer !== "string"
      || !canonicalReport.producer
      || !canonicalReport.metadata
      || !canonicalReport.summary
      || !Array.isArray(canonicalReport.projects)
      || !canonicalReport.rules
      || typeof canonicalReport.rules !== "object"
      || Array.isArray(canonicalReport.rules)
      || !Array.isArray(canonicalReport.security)) {
    throw new Error("canonical report artifact does not match the public report v1.0.0 contract");
  }
  if (String(canonicalReport.metadata.status ?? "").toLowerCase() !== "completed"
      || !sameStringSet(canonicalReport.metadata.domains, domains)
      || canonicalReport.metadata.mode !== analysisCoverage) {
    throw new Error("canonical report artifact does not match the completed run");
  }
  for (const field of ["id", "name", "minimumCveSeverity", "cveScanScope"]) {
    if (!canonicalReport.metadata[field]) {
      throw new Error(`canonical report metadata is missing ${field}`);
    }
  }
  if (normalizedLanguage === "java"
      && (!Array.isArray(canonicalReport.metadata.capabilities)
        || canonicalReport.metadata.capabilities.length === 0
        || !Array.isArray(canonicalReport.metadata.os)
        || canonicalReport.metadata.os.length === 0)) {
    throw new Error("canonical report target metadata is incomplete");
  }

  const html = fs.readFileSync(artifacts.html, "utf8");
  if (Buffer.byteLength(html) <= MINIMUM_HTML_BYTES || /\{\{[A-Z0-9_]+\}\}/.test(html)) {
    throw new Error("HTML report artifact is incomplete");
  }
  const payloadMatch = html.match(/<script type=["']application\/json["'] id=["']report-data["']>([\s\S]*?)<\/script>/i);
  if (!payloadMatch) throw new Error("HTML report artifact has no report-data payload");
  const htmlPayload = parseJsonArtifact(payloadMatch[1], "HTML report-data");
  if (htmlPayload?.meta?.run_id !== runId
      || !sameStringSet(htmlPayload.selected_groups, domains)
      || htmlPayload?.counts?.total !== normalizedAssessment.metadata.totalTrackedFindings) {
    throw new Error("HTML report artifact does not match the completed run");
  }

  if (["java", "dotnet"].includes(normalizedLanguage) && domains.some((domain) => domain !== "security")) {
    artifacts.appcat = requireArtifact(workspaceRoot, appcatReportPath, "AppCAT report");
    const appcat = readJsonArtifact(artifacts.appcat, "AppCAT report");
    if (!appcat || typeof appcat !== "object" || Array.isArray(appcat)) {
      throw new Error("AppCAT report artifact must contain an object");
    }
  }

  const { FACT_SKILL_IDS, SECURITY_SKILL_IDS } = await import("./assessment-catalog.mjs");
  if (analysisCoverage === "full") {
    artifacts.facts = {};
    for (const skillId of FACT_SKILL_IDS) {
      const factPath = requireArtifact(
        workspaceRoot,
        path.join(path.dirname(artifacts.report), "facts", `${skillId}.md`),
        `fact ${skillId}`,
      );
      if (fs.statSync(factPath).size === 0) throw new Error(`fact artifact is empty: ${skillId}`);
      artifacts.facts[skillId] = factPath;
    }
  }

  const partialTasks = [];
  if (domains.includes("security")) {
    const resolvedSecurityRoot = securityRoot
      ? path.resolve(securityRoot)
      : path.join(workspaceRoot, ".github", "modernize", "assessment", "engines", "security", "incoming");
    artifacts.security = {};
    for (const skillId of SECURITY_SKILL_IDS) {
      const securityPath = requireArtifact(
        workspaceRoot,
        path.join(resolvedSecurityRoot, `${skillId}.json`),
        `security ${skillId}`,
      );
      if (validateSecurityResult(readJsonArtifact(securityPath, `security ${skillId}`), skillId)) {
        partialTasks.push(skillId);
      }
      artifacts.security[skillId] = securityPath;
    }
  }

  const completionEvidence = {
    artifactValidation: "passed",
    runId,
    workspacePath: fs.realpathSync.native(workspaceRoot),
    artifacts,
    findingCounts: findingCounts(
      normalizedAssessment.findings,
      normalizedAssessment.metadata.totalTrackedFindings,
    ),
    topRecommendation: htmlPayload.top_recommendation ?? null,
    partialTasks,
    coverageSource,
  };
  return {
    status: partialTasks.length > 0 ? "partial" : "success",
    artifactValidation: "passed",
    completionEvidence,
    language: normalizedLanguage,
    domains: [...domains],
    analysisCoverage,
    coverageSource,
    findingCounts: completionEvidence.findingCounts,
    topRecommendation: completionEvidence.topRecommendation,
    artifacts,
    failedTasks: [...partialTasks],
    planningSupported: ["java", "dotnet"].includes(normalizedLanguage),
  };
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

function writeVerificationReceipt(receipt) {
  const verificationPath = path.join(path.dirname(receipt.artifacts.report), "verification.json");
  receipt.artifacts.verification = verificationPath;
  const temporaryPath = `${verificationPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, verificationPath);
  return verificationPath;
}

function relativeArtifactPath(workspacePath, artifactPath) {
  const relative = path.relative(workspacePath, artifactPath);
  return relative || path.basename(artifactPath);
}

export function formatVerifiedAssessmentSummary(receipt) {
  const report = readJsonArtifact(receipt.artifacts.report, "canonical report");
  const projects = Array.isArray(report.projects) ? report.projects : [];
  const properties = projects[0]?.properties ?? {};
  const application = properties.appName ? ` \`${properties.appName}\`` : "";
  const runtime = properties.jdkVersion ? ` using Java ${properties.jdkVersion}` : "";
  const frameworks = Array.isArray(properties.frameworks) && properties.frameworks.length > 0
    ? `, ${properties.frameworks.join(", ")}`
    : "";
  const tools = Array.isArray(properties.tools) && properties.tools.length > 0
    ? `, and ${properties.tools.join(", ")}`
    : "";
  const totalIssues = Number(report.summary?.totalIssues ?? receipt.findingCounts.total);
  const totalIncidents = Number(report.summary?.totalIncidents ?? totalIssues);
  const totalEffort = Number(report.summary?.totalEffort ?? 0);
  const issueLabel = totalIssues === 1 ? "issue type" : "issue types";
  const incidentLabel = totalIncidents === 1 ? "incident" : "incidents";
  const lines = [
    `**Assessment complete.**${application}${runtime}${frameworks}${tools}.`,
    "",
    `- **Findings:** ${totalIssues} ${issueLabel} across ${totalIncidents} ${incidentLabel}${totalEffort > 0 ? ` (${totalEffort} estimated effort points)` : ""}`,
  ];
  if (receipt.topRecommendation?.summary) {
    lines.push(`- **Top recommendation:** ${receipt.topRecommendation.summary}`);
  }
  lines.push(
    `- **Report:** \`${relativeArtifactPath(receipt.completionEvidence.workspacePath, receipt.artifacts.report)}\``,
    `- **Interactive HTML:** \`${relativeArtifactPath(receipt.completionEvidence.workspacePath, receipt.artifacts.html)}\``,
  );
  lines.push(
    `- **Verification:** passed (\`${relativeArtifactPath(receipt.completionEvidence.workspacePath, receipt.artifacts.verification)}\`)`,
  );
  return `${lines.join("\n")}\n`;
}

function writeVerifiedOutcome(outcomePath, receipt) {
  const absolutePath = path.resolve(outcomePath);
  const outcome = {
    status: receipt.status === "success" ? "completed" : "completed_with_issues",
    artifacts: receipt.artifacts,
    evidence: {
      artifactValidation: receipt.artifactValidation,
      planningSupported: receipt.planningSupported,
      language: receipt.language,
      domains: receipt.domains,
      analysisCoverage: receipt.analysisCoverage,
      coverageSource: receipt.coverageSource,
      findingCounts: receipt.findingCounts,
      topRecommendation: receipt.topRecommendation,
      partialTasks: receipt.failedTasks,
    },
    needsInput: null,
    error: null,
  };
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(outcome, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, absolutePath);
  return absolutePath;
}

function bootstrapRuntime(workspacePath) {
  const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
  const destination = path.resolve(workspacePath, ".github", "modernize", ".runtime", "assessment");
  fs.mkdirSync(path.join(destination, "templates"), { recursive: true });
  for (const name of ["assess-cli.mjs", "assess-state.mjs", "assess-report.mjs", "assess-runtime.mjs", "assessment-catalog.mjs"]) {
    fs.copyFileSync(path.join(sourceDirectory, name), path.join(destination, name));
  }
  fs.copyFileSync(
    path.join(sourceDirectory, "templates", "report.html"),
    path.join(destination, "templates", "report.html"),
  );
  const mappingSource = [
    path.resolve(sourceDirectory, "..", "resources", "solution-mapping.json"),
    path.join(sourceDirectory, "solution-mapping.json"),
  ].find((candidate) => fs.existsSync(candidate));
  if (!mappingSource) throw new Error("Assessment solution mapping is unavailable");
  fs.copyFileSync(mappingSource, path.join(destination, "solution-mapping.json"));
  const atomicSource = path.join(sourceDirectory, "atomic");
  if (fs.existsSync(atomicSource)) {
    fs.cpSync(atomicSource, path.join(destination, "atomic"), { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(destination, ".gitignore"), "*\n!.gitignore\n", "utf8");
  return { destination, cliPath: path.join(destination, "assess-cli.mjs") };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { command, options } = parseCommandLine(argv);
    if (command === "bootstrap") {
      printResult(bootstrapRuntime(requireOption(options, "workspace-path")));
      return 0;
    }
    if (command === "load-memory") {
      const maxPatches = options["max-patches"]
        ? Number.parseInt(options["max-patches"], 10)
        : undefined;
      if (maxPatches !== undefined && (!Number.isInteger(maxPatches) || maxPatches < 1)) {
        throw new Error("--max-patches must be a positive integer");
      }
      const result = loadMemory({
        memoryDir: requireOption(options, "memory-dir"),
        intent: options.intent ?? "unknown",
        maxPatches,
      });
      for (const warning of result.warnings) console.error(warning);
      console.log(result.output);
      return result.warnings.length ? 1 : 0;
    }

    if (command === "plan") {
      const { buildAssessmentPlan } = await import("./assessment-catalog.mjs");
      printResult(buildAssessmentPlan({
        domains: splitOption(options.domains) ?? [],
        analysisCoverage: options.coverage ?? "issue-only",
        assessmentRoot: options["assessment-root"],
        attemptScratchRoot: options["attempt-scratch-root"],
        maxConcurrency: positiveIntegerOption(options, "max-concurrency"),
      }));
      return 0;
    }

    if (command === "prepare-run") {
      const { prepareAssessmentRun } = await import("./assessment-catalog.mjs");
      printResult(prepareAssessmentRun({
        workspacePath: requireOption(options, "workspace-path"),
        runId: requireOption(options, "run-id"),
        language: requireOption(options, "language"),
        domains: splitOption(options.domains) ?? [],
        analysisCoverage: options.coverage ?? "issue-only",
        attemptScratchRoot: options["attempt-scratch-root"],
        maxConcurrency: positiveIntegerOption(options, "max-concurrency"),
        assessmentConfig: assessmentConfigOptions(options),
        coverageSource: coverageSourceOption(options),
      }));
      return 0;
    }

    if (command === "archive-facts") {
      const { archiveFactFiles } = await import("./assessment-catalog.mjs");
      const result = archiveFactFiles({
        workspacePath: requireOption(options, "workspace-path"),
        reportPath: requireOption(options, "report"),
        analysisCoverage: options.coverage ?? "issue-only",
        factsRoot: options["facts-root"],
      });
      printResult(result);
      return result.missing.length === 0 ? 0 : 1;
    }

    if (command === "verify-artifacts") {
      const receipt = await verifyAssessmentArtifacts({
        workspacePath: requireOption(options, "workspace-path"),
        runId: requireOption(options, "run-id"),
        language: requireOption(options, "language"),
        domains: splitOption(options.domains) ?? [],
        analysisCoverage: options.coverage ?? "issue-only",
        reportPath: requireOption(options, "report"),
        normalizedAssessmentPath: requireOption(options, "normalized-assessment"),
        htmlPath: requireOption(options, "html"),
        appcatReportPath: options["appcat-report"],
        securityRoot: options["security-root"],
      });
      if (options.outcome) writeVerifiedOutcome(options.outcome, receipt);
      if (options.presentation === "user") {
        writeVerificationReceipt(receipt);
        process.stdout.write(formatVerifiedAssessmentSummary(receipt));
      } else {
        printResult(receipt);
      }
      return 0;
    }

    if (command === "ensure-appcat") {
      const { ensureAppcat } = await import("./assess-runtime.mjs");
      printResult(await ensureAppcat({
        language: requireOption(options, "language"),
        force: options.force === "true",
        homeDir: options["home-dir"],
      }));
      return 0;
    }

    if (command === "run-appcat") {
      const { runAppcat } = await import("./assess-runtime.mjs");
      printResult(runAppcat({
        language: requireOption(options, "language"),
        workspacePath: requireOption(options, "workspace-path"),
        runDir: requireOption(options, "run-dir"),
        targets: splitOption(options.targets),
        capabilities: splitOption(options.capabilities),
        targetOs: splitOption(options["target-os"]),
        mode: options.mode,
      }));
      return 0;
    }

    if (command === "run-ncu") {
      const { runNcu } = await import("./assess-runtime.mjs");
      printResult(runNcu({
        packageJsonPath: requireOption(options, "package-json"),
        outputDir: requireOption(options, "output-dir"),
        runId: options["run-id"],
        findingsPath: options.findings,
      }));
      return 0;
    }

    if (command === "record-result") {
      const { recordAssessmentResult } = await import("./assess-state.mjs");
      const result = recordAssessmentResult({
        skill: requireOption(options, "skill"),
        inputPath: requireOption(options, "input"),
        findingsPath: requireOption(options, "findings"),
        runId: requireOption(options, "run-id"),
        runDir: requireOption(options, "run-dir"),
      });
      printResult({ inputPath: result.inputPath, added: result.added, total: result.findings.length });
      return 0;
    }

    if (command === "update-state") {
      const { updateFindingStates } = await import("./assess-state.mjs");
      const result = updateFindingStates({
        findingsPath: requireOption(options, "findings"),
        ids: splitOption(options.ids) ?? [],
        state: options.state,
        reason: options.reason ?? "",
        applyRules: options["apply-rules"] !== "false",
      });
      printResult({ changed: result.changed, total: result.findings.length });
      return 0;
    }

    if (command === "integrate-appcat") {
      const { integrateAppcatReport } = await import("./assess-state.mjs");
      const result = integrateAppcatReport({
        reportPath: requireOption(options, "report"),
        findingsPath: requireOption(options, "findings"),
        runId: requireOption(options, "run-id"),
        target: options.target,
      });
      printResult({ incidents: result.incidents, converted: result.converted, total: result.findings.length });
      return 0;
    }

    if (command === "validate-enrichment") {
      const { validateEnrichment } = await import("./assess-report.mjs");
      const result = validateEnrichment({
        memoryDir: requireOption(options, "memory-dir"),
        runId: requireOption(options, "run-id"),
        enrichmentPath: options.enrichment,
        allowRaw: options["allow-raw"] === "true",
      });
      printResult(result);
      return result.ok ? 0 : 1;
    }

    if (command === "generate-report") {
      const { generateHtmlReport } = await import("./assess-report.mjs");
      const result = generateHtmlReport({
        memoryDir: requireOption(options, "memory-dir"),
        runId: requireOption(options, "run-id"),
        outputDir: requireOption(options, "output-dir"),
        projectRoot: options["project-root"],
        enrichmentPath: options.enrichment,
      });
      printResult({
        ok: result.ok,
        mode: result.mode,
        warnings: result.warnings,
        versionedPath: result.versionedPath,
        latestPath: result.latestPath,
        total: result.payload.counts.total,
      });
      return 0;
    }

    if (command === "publish-appcat-report") {
      const { publishCanonicalAppcatReport } = await import("./assess-state.mjs");
      const result = publishCanonicalAppcatReport({
        sourcePath: requireOption(options, "source"),
        memoryDir: options["memory-dir"],
        outputDir: requireOption(options, "output-dir"),
        runId: requireOption(options, "run-id"),
        language: requireOption(options, "language"),
        domains: splitOption(options.domains) ?? [],
        analysisCoverage: options.coverage ?? "issue-only",
        capabilities: splitOption(options.capabilities),
        targetOs: splitOption(options["target-os"]),
        minimumCveSeverity: options["minimum-cve-severity"] ?? "high",
        cveScanScope: options["cve-scan-scope"] ?? "direct",
      });
      printResult({ reportPath: result.reportPath });
      return 0;
    }

    if (command === "generate-canonical-report") {
      const { generateCanonicalAssessmentReport } = await import("./assess-state.mjs");
      const result = generateCanonicalAssessmentReport({
        memoryDir: requireOption(options, "memory-dir"),
        outputDir: requireOption(options, "output-dir"),
        workspacePath: requireOption(options, "workspace-path"),
        runId: requireOption(options, "run-id"),
        language: requireOption(options, "language"),
        domains: splitOption(options.domains) ?? [],
        analysisCoverage: options.coverage ?? "issue-only",
        capabilities: splitOption(options.capabilities),
        targetOs: splitOption(options["target-os"]),
        minimumCveSeverity: options["minimum-cve-severity"] ?? "high",
        cveScanScope: options["cve-scan-scope"] ?? "direct",
      });
      printResult({ reportPath: result.reportPath });
      return 0;
    }

    if (command === "generate-normalized-assessment") {
      const { generateNormalizedAssessment } = await import("./assess-state.mjs");
      const result = generateNormalizedAssessment({
        memoryDir: requireOption(options, "memory-dir"),
        runId: requireOption(options, "run-id"),
        language: options.language,
        solutionMappingPath: requireOption(options, "solution-mapping"),
      });
      printResult({
        normalizedAssessmentPath: result.reportPath,
        total: result.report.findings.length,
        categories: result.report.categories.length,
      });
      return 0;
    }

    throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
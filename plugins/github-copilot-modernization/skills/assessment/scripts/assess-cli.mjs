#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_MAX_PATCHES = 20;
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

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
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

    if (command === "generate-compat-report") {
      const { generateCompatibilityReport } = await import("./assess-state.mjs");
      const result = generateCompatibilityReport({
        memoryDir: requireOption(options, "memory-dir"),
        runId: requireOption(options, "run-id"),
        outputDir: requireOption(options, "output-dir"),
        language: options.language,
        solutionMappingPath: requireOption(options, "solution-mapping"),
      });
      printResult({
        reportPath: result.reportPath,
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
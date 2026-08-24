import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseYaml } from "./assess-cli.mjs";

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SEVERITY_MAP = {
  critical: "critical",
  mandatory: "high",
  high: "high",
  optional: "medium",
  medium: "medium",
  potential: "low",
  low: "low",
  information: "info",
  info: "info",
};

function scalarYaml(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function yamlLines(value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}[]`];
    const lines = [];
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item).filter(([, child]) => child !== undefined);
        if (entries.length === 0) {
          lines.push(`${prefix}- {}`);
          continue;
        }
        const [[firstKey, firstValue], ...rest] = entries;
        if (firstValue && typeof firstValue === "object") {
          lines.push(`${prefix}- ${firstKey}:`);
          lines.push(...yamlLines(firstValue, indent + 4));
        } else {
          lines.push(`${prefix}- ${firstKey}: ${scalarYaml(firstValue)}`);
        }
        for (const [key, child] of rest) {
          if (child && typeof child === "object") {
            lines.push(`${prefix}  ${key}:`);
            lines.push(...yamlLines(child, indent + 4));
          } else {
            lines.push(`${prefix}  ${key}: ${scalarYaml(child)}`);
          }
        }
      } else if (item && typeof item === "object") {
        lines.push(`${prefix}-`);
        lines.push(...yamlLines(item, indent + 2));
      } else {
        lines.push(`${prefix}- ${scalarYaml(item)}`);
      }
    }
    return lines;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined);
    if (entries.length === 0) return [`${prefix}{}`];
    const lines = [];
    for (const [key, child] of entries) {
      if (child && typeof child === "object") {
        lines.push(`${prefix}${key}:`);
        lines.push(...yamlLines(child, indent + 2));
      } else {
        lines.push(`${prefix}${key}: ${scalarYaml(child)}`);
      }
    }
    return lines;
  }
  return [`${prefix}${scalarYaml(value)}`];
}

export function stringifyYaml(value) {
  return `${yamlLines(value).join("\n")}\n`;
}

export function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return parseYaml(fs.readFileSync(filePath, "utf8"));
}

export function writeYamlAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, stringifyYaml(value), "utf8");
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withFileLock(filePath, operation) {
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const descriptor = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(descriptor, `${process.pid}\n`, "utf8");
        return operation();
      } finally {
        fs.closeSync(descriptor);
        fs.rmSync(lockPath, { force: true });
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 60_000) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for assessment state lock: ${lockPath}`);
      }
      sleep(25);
    }
  }
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(value ?? Date.now()).toISOString();
}

function mapSeverity(value) {
  return SEVERITY_MAP[String(value ?? "info").trim().toLowerCase()] ?? "info";
}

function worstSeverity(values) {
  return values.reduce((worst, value) => {
    const severity = mapSeverity(value);
    return SEVERITY_RANK[severity] < SEVERITY_RANK[worst] ? severity : worst;
  }, "info");
}

function stableId(skill, key) {
  const digest = crypto.createHash("sha256").update(`${skill}|${key}`).digest("hex").slice(0, 12);
  return `${skill}::${digest}`;
}

function canonicalPath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function parseLocation(value) {
  if (!value) return null;
  if (typeof value === "object") {
    const file = canonicalPath(value.file ?? value.filePath ?? value.path ?? value.location);
    const parsedLine = Number.parseInt(value.line ?? value.lineNumber, 10);
    return file ? { file, line: Number.isFinite(parsedLine) ? parsedLine : null } : null;
  }
  const text = canonicalPath(value);
  const match = /^(.*):(\d+)$/.exec(text);
  return match
    ? { file: match[1], line: Number.parseInt(match[2], 10) }
    : { file: text, line: null };
}

function collectLocations(entry) {
  const candidates = [];
  for (const value of [entry.locations, entry.files, entry.evidence?.files, entry.evidence?.locations]) {
    if (Array.isArray(value)) candidates.push(...value);
  }
  candidates.push(entry.location, entry.file, entry.filePath, entry.path);
  const seen = new Set();
  const locations = [];
  for (const candidate of candidates) {
    const location = parseLocation(candidate);
    if (!location) continue;
    const key = `${location.file}:${location.line ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      locations.push(location);
    }
  }
  return locations.sort((left, right) =>
    left.file.localeCompare(right.file) || (left.line ?? 0) - (right.line ?? 0));
}

function firstDefined(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object[key] !== null && object[key] !== "") return object[key];
  }
  return null;
}

function securityKey(entry, title, locations) {
  const identifier = firstDefined(entry, [
    "id", "cveId", "cve", "cweId", "cwe", "vulnerabilityId", "advisoryId", "ruleId",
  ]);
  const component = firstDefined(entry, ["package", "packageName", "dependency", "artifact", "component"]);
  return [identifier, component, locations[0]?.file, title]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .join("|");
}

function entryTitle(entry) {
  const identifier = firstDefined(entry, ["cveId", "cve", "cweId", "cwe", "vulnerabilityId", "id"]);
  const component = firstDefined(entry, ["package", "packageName", "dependency", "artifact", "component"]);
  return String(firstDefined(entry, ["title", "name", "message", "summary", "description"])
    ?? [identifier, component && `in ${component}`].filter(Boolean).join(" ")
    ?? "Security finding");
}

function evidenceText(entry) {
  if (typeof entry.evidence === "string") return entry.evidence;
  return String(entry.evidence?.explanation
    ?? firstDefined(entry, ["details", "description", "rationale", "recommendation", "message"])
    ?? "");
}

function linksFrom(entry) {
  const links = Array.isArray(entry.links) ? entry.links : [];
  const url = firstDefined(entry, ["url", "reference", "advisoryUrl"]);
  if (url) links.push({ url: String(url), title: String(entry.cveId ?? entry.cve ?? url) });
  return links.map((link) => typeof link === "string"
    ? { url: link, title: link }
    : { url: String(link.url), title: String(link.title ?? link.url) }).filter((link) => link.url !== "undefined");
}

function makeFinding({ skill, key, severity, title, locations, rationale, evidence, links, source, runId, timestamp }) {
  const primary = locations[0] ?? { file: "(unknown)", line: null };
  return {
    id: stableId(skill, key),
    skill,
    source,
    severity,
    title,
    location: primary.file,
    line: primary.line,
    ...(locations.length > 1 ? { occurrences: locations.length, locations } : {}),
    first_seen: timestamp,
    last_seen: timestamp,
    state: "new",
    state_changed_at: timestamp,
    state_reason: "",
    ...(rationale ? { rationale } : {}),
    ...(evidence ? { evidence } : {}),
    ...(links?.length ? { links } : {}),
    runs: [runId],
  };
}

function mergeFindings(existing, incoming, runId) {
  const byId = new Map((existing ?? []).filter((finding) => finding?.id)
    .map((finding) => [finding.id, { ...finding }]));
  for (const finding of incoming) {
    const current = byId.get(finding.id);
    if (!current) {
      byId.set(finding.id, finding);
      continue;
    }
    const runs = [...(current.runs ?? [])];
    if (runId && !runs.includes(runId)) runs.push(runId);
    const reappeared = current.state === "resolved";
    byId.set(finding.id, {
      ...current,
      ...finding,
      first_seen: current.first_seen ?? finding.first_seen,
      state: reappeared ? "new" : current.state ?? "new",
      state_changed_at: reappeared ? finding.last_seen : current.state_changed_at ?? finding.state_changed_at,
      state_reason: reappeared ? "regression: finding reappeared after resolution" : current.state_reason ?? "",
      runs,
    });
  }
  return [...byId.values()];
}

function globPattern(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped
    .replaceAll("**/", "::OPTIONAL_DIRECTORIES::")
    .replaceAll("**", "::DOUBLE_STAR::")
    .replaceAll("*", "[^/]*")
    .replaceAll("::OPTIONAL_DIRECTORIES::", "(?:.*/)?")
    .replaceAll("::DOUBLE_STAR::", ".*");
  return new RegExp(`^${expression}$`, "i");
}

function matchesSuppression(finding, match) {
  if (match.id && finding.id !== match.id) return false;
  if (match.skill && finding.skill !== match.skill) return false;
  if (match.location_glob && !globPattern(match.location_glob).test(String(finding.location ?? "").replaceAll("\\", "/"))) return false;
  if (match.title_regex) {
    try {
      if (!new RegExp(match.title_regex, "i").test(String(finding.title ?? ""))) return false;
    } catch {
      return false;
    }
  }
  if (match.severity_min) {
    const findingRank = SEVERITY_RANK[mapSeverity(finding.severity)] ?? SEVERITY_RANK.info;
    const minimumRank = SEVERITY_RANK[mapSeverity(match.severity_min)] ?? SEVERITY_RANK.info;
    if (findingRank > minimumRank) return false;
  }
  return true;
}

function applySuppressions(findings, findingsPath, timestamp) {
  const suppressionsPath = path.join(path.dirname(findingsPath), "suppressions.yaml");
  const rules = readYaml(suppressionsPath)?.rules;
  const activeRules = Array.isArray(rules) ? rules : [];
  return findings.map((finding) => {
    const updated = { ...finding };
    if (updated.state === "suppressed" && String(updated.state_reason ?? "").startsWith("suppression:")) {
      updated.state = "new";
      updated.state_reason = "";
      updated.state_changed_at = timestamp;
    }
    for (const rule of activeRules) {
      if (!rule?.match || !matchesSuppression(updated, rule.match)) continue;
      const reason = `suppression:${rule.id ?? "unnamed"} ${rule.description ?? ""}`.trim();
      if (rule.action === "suppress") updated.state = "suppressed";
      else if (rule.action === "acknowledge" && updated.state === "new") updated.state = "acknowledged";
      else if (rule.action === "escalate") updated.state = "escalated";
      else continue;
      updated.state_reason = reason;
      updated.state_changed_at = timestamp;
    }
    return updated;
  });
}

export function updateFindingStates(options) {
  const {
    findingsPath,
    ids = [],
    state,
    reason = "",
    now,
    applyRules = true,
  } = options;
  const allowedStates = new Set(["new", "acknowledged", "suppressed", "escalated", "resolved"]);
  if (state && !allowedStates.has(state)) {
    throw new Error(`Unsupported finding state: ${state}`);
  }
  const idSet = new Set(ids);
  const timestamp = nowIso(now);
  return withFileLock(findingsPath, () => {
    const document = readYaml(findingsPath) ?? { version: 1, findings: [] };
    let changed = 0;
    let findings = (Array.isArray(document.findings) ? document.findings : []).map((finding) => {
      if (!state || !idSet.has(finding.id)) return finding;
      changed += 1;
      return {
        ...finding,
        state,
        state_changed_at: timestamp,
        state_reason: reason,
      };
    });
    if (applyRules) findings = applySuppressions(findings, findingsPath, timestamp);
    writeYamlAtomic(findingsPath, { version: 1, findings });
    return { changed, findings };
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function recordAssessmentResult(options) {
  const { skill, inputPath, findingsPath, runId, runDir, now } = options;
  const input = readJson(inputPath);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, `${skill}.json`), `${JSON.stringify(input, null, 2)}\n`, "utf8");

  const timestamp = nowIso(now);
  const wrapperValues = input?.result?.values;
  const wrapperIsSecurity = Array.isArray(wrapperValues) && wrapperValues.some((entry) =>
    entry && typeof entry === "object" && ["FOUND", "NOT_FOUND"].includes(String(entry.status ?? "").toUpperCase()));
  const entries = Array.isArray(input) ? input : wrapperIsSecurity ? wrapperValues : null;
  const incoming = [];

  if (entries) {
    for (const entry of entries) {
      const status = String(entry?.status ?? entry?.result?.status ?? "").toUpperCase();
      if (status !== "FOUND") continue;
      const locations = collectLocations(entry);
      const title = entryTitle(entry);
      incoming.push(makeFinding({
        skill,
        key: securityKey(entry, title, locations),
        severity: mapSeverity(firstDefined(entry, ["severity", "category", "level"])),
        title,
        locations,
        rationale: evidenceText(entry),
        evidence: typeof entry.evidence === "string" ? entry.evidence : "",
        links: linksFrom(entry),
        source: skill,
        runId,
        timestamp,
      }));
    }
  } else {
    const status = String(input?.status ?? input?.result?.status ?? "success").toLowerCase();
    const resultObject = input?.result && !Array.isArray(input.result) ? input.result : input;
    const summary = firstDefined(resultObject,
      ["finding", "summary", "message", "description", "value"]);
    if (["success", "succeeded", "completed", "ok"].includes(status) && summary !== null) {
      const summaryText = typeof summary === "string" ? summary : JSON.stringify(summary);
      const locations = collectLocations(input);
      incoming.push(makeFinding({
        skill,
        key: String(firstDefined(input, ["id", "key", "name"]) ?? summaryText),
        severity: "info",
        title: String(firstDefined(input, ["title", "name", "input_name"]) ?? summaryText),
        locations,
        rationale: String(firstDefined(resultObject, ["description", "details"])
          ?? (Array.isArray(resultObject?.evidence) ? resultObject.evidence.join("\n") : "")),
        source: skill,
        runId,
        timestamp,
      }));
    }
  }

  const findings = withFileLock(findingsPath, () => {
    const document = readYaml(findingsPath) ?? { version: 1, findings: [] };
    const merged = mergeFindings(Array.isArray(document.findings) ? document.findings : [], incoming, runId);
    const suppressed = applySuppressions(merged, findingsPath, timestamp);
    writeYamlAtomic(findingsPath, { version: 1, findings: suppressed });
    return suppressed;
  });
  return { inputPath: path.join(runDir, `${skill}.json`), findings, added: incoming.length };
}

function stripRuleSuffix(ruleId) {
  return String(ruleId ?? "").replace(/-\d{3,}$/, "");
}

function appcatRuleMetadata(report) {
  const index = new Map();
  for (const [ruleId, metadata] of Object.entries(report.rules ?? {})) {
    if (!metadata || typeof metadata !== "object") continue;
    const labels = Array.isArray(metadata.labels) ? metadata.labels : [];
    const domainLabel = labels.find((label) => /^category=/.test(label))
      ?? labels.find((label) => /^domain=/.test(label));
    index.set(ruleId, {
      ...metadata,
      domain: domainLabel ? domainLabel.split("=", 2)[1] : "general",
      links: (Array.isArray(metadata.links) ? metadata.links : []).filter((link) => link?.url),
    });
  }
  return index;
}

function incidentSeverity(incident, target) {
  const targets = incident.targets ?? {};
  if (target && targets[target]) return mapSeverity(targets[target].severity);
  return worstSeverity(Object.values(targets).map((value) => value?.severity)
    .concat(incident.severity ?? incident.category));
}

export function integrateAppcatReport(options) {
  const { reportPath, findingsPath, runId, target, now } = options;
  const report = readJson(reportPath);
  const timestamp = nowIso(now);
  const metadata = appcatRuleMetadata(report);
  const buckets = new Map();
  const incidents = (report.projects ?? []).flatMap((project) =>
    Array.isArray(project?.incidents) ? project.incidents : []);

  for (const incident of incidents) {
    const ruleId = String(incident.ruleId ?? "");
    const key = stripRuleSuffix(ruleId) || "unknown";
    if (key.startsWith("discover-")) continue;
    const rule = metadata.get(ruleId) ?? {};
    const classified = Boolean(rule.title || rule.description);
    const location = parseLocation({
      file: incident.location ?? incident.file ?? incident.filePath,
      line: incident.line ?? incident.lineNumber,
    }) ?? { file: "(unknown)", line: null };
    const existing = buckets.get(key) ?? {
      key,
      skill: `appcat::${rule.domain ?? "general"}`,
      title: rule.title || (rule.description ? String(rule.description).split(/[.\n]/, 1)[0] : `Unclassified: ${key.replaceAll("-", " ")}`),
      severity: classified ? incidentSeverity(incident, target) : "info",
      classified,
      locations: [],
      ruleIds: [],
      rationale: rule.description || "",
      links: rule.links ?? [],
      effort: Number.isFinite(Number(rule.effort)) ? Number(rule.effort) : null,
    };
    if (existing.classified) {
      existing.severity = worstSeverity([existing.severity, incidentSeverity(incident, target)]);
    }
    existing.locations.push(location);
    if (ruleId && !existing.ruleIds.includes(ruleId)) existing.ruleIds.push(ruleId);
    buckets.set(key, existing);
  }

  const incoming = [...buckets.values()].map((bucket) => {
    const seen = new Set();
    let locations = bucket.locations
      .filter((location) => location.file !== "(unknown)" || !bucket.locations.some((item) => item.file !== "(unknown)"))
      .filter((location) => {
        const key = `${location.file}:${location.line ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => left.file.localeCompare(right.file) || (left.line ?? 0) - (right.line ?? 0));
    if (locations.length === 0) locations = [{ file: "(unknown)", line: null }];
    return {
      ...makeFinding({
        skill: bucket.skill,
        key: bucket.key,
        severity: bucket.severity,
        title: bucket.title,
        locations,
        rationale: bucket.rationale,
        evidence: `AppCAT rules: ${bucket.ruleIds.join(", ")}`,
        links: bucket.links,
        source: "appcat",
        runId,
        timestamp,
      }),
      ...(bucket.effort !== null ? { effort: bucket.effort } : {}),
    };
  });

  const findings = withFileLock(findingsPath, () => {
    const document = readYaml(findingsPath) ?? { version: 1, findings: [] };
    const merged = mergeFindings(Array.isArray(document.findings) ? document.findings : [], incoming, runId);
    const suppressed = applySuppressions(merged, findingsPath, timestamp);
    writeYamlAtomic(findingsPath, { version: 1, findings: suppressed });
    return suppressed;
  });
  return { incidents: incidents.length, converted: incoming.length, findings };
}

function ruleIdsFromFinding(finding) {
  if (finding.source !== "appcat") return [];
  const match = /^AppCAT rules:\s*(.*)$/.exec(finding.evidence ?? "");
  return match ? match[1].split(",").map((value) => value.trim()).filter(Boolean) : [];
}

function reportDirectoryName(runId) {
  const raw = String(runId);
  const timestampParts = raw.match(/\d+/g) ?? [];
  const timestamp = timestampParts.join("").slice(0, 14);
  const safe = /^\d{14}$/.test(timestamp)
    ? timestamp
    : /^\d+$/.test(raw)
      ? raw
      : raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `report-${safe || "run"}`;
}

export function generateCompatibilityReport(options) {
  const { memoryDir, runId, outputDir, language, solutionMappingPath, now } = options;
  const findingsDocument = readYaml(path.join(memoryDir, "findings.yaml")) ?? {};
  const trackedFindings = Array.isArray(findingsDocument.findings) ? findingsDocument.findings : [];
  const findings = trackedFindings.filter((finding) => ["new", "escalated"].includes(finding.state ?? "new"));
  const intent = readYaml(path.join(memoryDir, "runs", runId, "intent.yaml"))
    ?? readYaml(path.join(memoryDir, "last-intent.yaml"))
    ?? {};
  const mapping = readJson(solutionMappingPath);
  const solutionsById = new Map((mapping.solutions ?? []).map((solution) => [solution.solutionId, solution]));
  const solutionByRule = new Map((mapping.rules ?? []).map((rule) => [rule.ruleId, rule.solution]));
  const categories = new Map();

  for (const finding of findings) {
    let solutionIds = [];
    if (/^cve(?:-|$)/i.test(finding.skill ?? "") || /CVE-\d/i.test(`${finding.title} ${finding.evidence}`)) {
      solutionIds = ["scan-and-resolve-cve-vulnerabilities"];
    } else if (/^cwe(?:-|$)/i.test(finding.skill ?? "") || /CWE-\d/i.test(`${finding.title} ${finding.evidence}`)) {
      solutionIds = ["scan-and-resolve-cwe-vulnerabilities"];
    } else {
      solutionIds = [...new Set(ruleIdsFromFinding(finding).map((ruleId) => solutionByRule.get(ruleId)).filter(Boolean))];
    }
    const categoryName = String(finding.title ?? finding.skill ?? "general");
    const categoryKey = String(finding.id ?? categoryName);
    const category = categories.get(categoryKey) ?? {
      category: categoryName,
      categoryId: categoryKey,
      sourceSkill: String(finding.skill ?? "general"),
      issues: [],
      solutions: [],
    };
    category.issues.push(finding);
    for (const solutionId of solutionIds) {
      if (category.solutions.some((solution) => solution.solutionId === solutionId)) continue;
      const solution = solutionsById.get(solutionId) ?? {};
      category.solutions.push({
        solutionId,
        name: solution.name ?? solutionId,
        description: solution.description ?? solution.tooltip ?? solution.prompt ?? "",
        kbId: solutionId.startsWith("bare/") ? null : solutionId,
      });
    }
    categories.set(categoryKey, category);
  }

  const actionableCategories = [...categories.values()].filter((category) => category.solutions.length > 0);
  const planningFindingIds = new Set(actionableCategories.flatMap((category) => category.issues.map((issue) => issue.id)));
  const planningFindings = findings.filter((finding) => planningFindingIds.has(finding.id));

  const security = planningFindings.filter((finding) =>
    /^(?:cve|cwe)(?:-|$)/i.test(finding.skill ?? "") || ["critical", "high"].includes(finding.severity));
  const report = {
    version: "1.1.0",
    metadata: {
      id: reportDirectoryName(runId).replace(/^report-/, ""),
      runId,
      generatedAt: nowIso(now),
      analysisStartTime: intent.captured_at ?? nowIso(now),
      analysisEndTime: nowIso(now),
      status: "completed",
      domains: intent.selected_groups ?? [],
      language: language ?? intent.language ?? null,
      intent,
      totalFindings: planningFindings.length,
      totalActionableFindings: findings.length,
      totalTrackedFindings: trackedFindings.length,
    },
    categories: actionableCategories,
    findings: planningFindings,
    security,
  };
  const reportDir = path.join(outputDir, reportDirectoryName(runId));
  const reportPath = path.join(reportDir, "report.json");
  fs.mkdirSync(reportDir, { recursive: true });
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, reportPath);
  const runDirectory = path.join(memoryDir, "runs", runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  writeYamlAtomic(path.join(runDirectory, "findings.yaml"), { version: 1, findings: trackedFindings });
  return { reportPath, report };
}
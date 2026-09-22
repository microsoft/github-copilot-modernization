import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseYaml } from "./assess-cli.mjs";

const ALL_GROUPS = [
  "security-cve",
  "security-cwe",
  "architecture",
  "infrastructure",
  "configuration",
  "application-facts",
];
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const KNOWN_ENRICHMENT_KEYS = new Set([
  "version",
  "intent_slug",
  "generated_at",
  "generated_by",
  "model_hint",
  "briefing",
  "headlines",
  "change_narrative",
  "themes",
  "findings",
  "risks",
  "cost_estimate",
  "next_steps",
]);
const RISK_SEVERITIES = new Set(SEVERITIES);
const RAW_ENRICHMENT_SENTINELS = new Set(["", "-", "none", "null", "nul", "/dev/null"]);
const OTHER_THEME_ID = "other";
const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates", "report.html");

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return parseYaml(fs.readFileSync(filePath, "utf8"));
}

function resolveEnrichmentPath(memoryDir, runId, enrichmentPath) {
  if (enrichmentPath !== undefined && enrichmentPath !== null) {
    if (RAW_ENRICHMENT_SENTINELS.has(String(enrichmentPath).trim().toLowerCase())) {
      return null;
    }
    return path.resolve(enrichmentPath);
  }
  const defaultPath = path.resolve(memoryDir, "runs", runId, "enrichment.yaml");
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

function cleanReferenceList(value, findingIds, context, warnings, ownId = null) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((findingId) => {
    if (findingIds.has(findingId) && findingId !== ownId) {
      return true;
    }
    warnings.push(`${context}: ${JSON.stringify(findingId)} not in findings.yaml; dropped`);
    return false;
  });
}

function sanitizeEnrichment(data, findingIds, warnings) {
  for (const key of Object.keys(data)) {
    if (!KNOWN_ENRICHMENT_KEYS.has(key)) {
      warnings.push(`unknown top-level enrichment key ${JSON.stringify(key)}; dropped`);
      delete data[key];
    }
  }

  if (Array.isArray(data.headlines)) {
    data.headlines = data.headlines.filter((headline) => headline && typeof headline === "object");
    for (const headline of data.headlines) {
      const jump = headline.jump_to;
      if (jump && typeof jump === "object" && String(jump.kind || "").toLowerCase() === "finding" && !findingIds.has(jump.id)) {
        warnings.push(`headlines: jump_to.finding id ${JSON.stringify(jump.id)} not in findings.yaml; clearing`);
        headline.jump_to = null;
      }
    }
  }

  const validThemeIds = new Set();
  if (Array.isArray(data.themes)) {
    const assigned = new Map();
    const themes = [];
    for (const theme of data.themes) {
      if (!theme || typeof theme !== "object" || typeof theme.id !== "string" || !theme.id) {
        warnings.push("themes: entry without a string id; dropped");
        continue;
      }
      const kept = [];
      for (const findingId of Array.isArray(theme.finding_ids) ? theme.finding_ids : []) {
        if (!findingIds.has(findingId)) {
          warnings.push(`themes[${theme.id}]: finding id ${JSON.stringify(findingId)} not in findings.yaml; dropped`);
        } else if (assigned.has(findingId) && assigned.get(findingId) !== theme.id) {
          warnings.push(`themes[${theme.id}]: finding id ${JSON.stringify(findingId)} already in theme ${JSON.stringify(assigned.get(findingId))}; dropped`);
        } else {
          assigned.set(findingId, theme.id);
          kept.push(findingId);
        }
      }
      theme.finding_ids = kept;
      themes.push(theme);
      validThemeIds.add(theme.id);
    }
    const unassigned = [...findingIds].filter((findingId) => !assigned.has(findingId));
    if (unassigned.length) {
      themes.push({
        id: OTHER_THEME_ID,
        label: "Other findings",
        summary: "Findings the AI narrative did not assign to a theme.",
        finding_ids: unassigned,
        auto_bucketed: true,
      });
      validThemeIds.add(OTHER_THEME_ID);
    }
    data.themes = themes;
  }

  for (const headline of Array.isArray(data.headlines) ? data.headlines : []) {
    const jump = headline.jump_to;
    if (jump && typeof jump === "object" && String(jump.kind || "").toLowerCase() === "theme" && !validThemeIds.has(jump.id)) {
      warnings.push(`headlines: jump_to.theme id ${JSON.stringify(jump.id)} is not a theme in this enrichment; clearing`);
      headline.jump_to = null;
    }
  }

  if (Array.isArray(data.findings)) {
    const seen = new Set();
    data.findings = data.findings.filter((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      if (!findingIds.has(entry.id)) {
        warnings.push(`findings[]: enrichment for ${JSON.stringify(entry.id)} has no matching finding; dropped`);
        return false;
      }
      if (seen.has(entry.id)) {
        warnings.push(`findings[]: duplicate enrichment for ${JSON.stringify(entry.id)}; keeping first`);
        return false;
      }
      seen.add(entry.id);
      if (Array.isArray(entry.related_findings)) {
        entry.related_findings = entry.related_findings
          .filter((relation) => relation && typeof relation === "object")
          .map((relation) => ({
            ...relation,
            finding_ids: cleanReferenceList(
              relation.finding_ids,
              findingIds,
              `findings[${entry.id}].related_findings`,
              warnings,
              entry.id,
            ),
          }))
          .filter((relation) => relation.finding_ids.length);
      }
      return true;
    });
  }

  const highlights = data.change_narrative?.highlights;
  if (Array.isArray(highlights)) {
    data.change_narrative.highlights = highlights
      .filter((highlight) => highlight && typeof highlight === "object")
      .map((highlight) => ({
        ...highlight,
        finding_ids: cleanReferenceList(highlight.finding_ids, findingIds, "change_narrative.highlights", warnings),
      }))
      .filter((highlight) => highlight.finding_ids.length);
  }

  if (Array.isArray(data.risks)) {
    const seen = new Set();
    data.risks = data.risks.filter((risk) => {
      if (!risk || typeof risk !== "object" || typeof risk.id !== "string" || !risk.id) {
        warnings.push("risks: entry without a string id; dropped");
        return false;
      }
      if (seen.has(risk.id)) {
        warnings.push(`risks: duplicate id ${JSON.stringify(risk.id)}; keeping first`);
        return false;
      }
      seen.add(risk.id);
      const severity = String(risk.severity || "").toLowerCase();
      if (!RISK_SEVERITIES.has(severity)) {
        warnings.push(`risks[${risk.id}]: invalid severity; defaulting to 'medium'`);
        risk.severity = "medium";
      } else {
        risk.severity = severity;
      }
      if (typeof risk.title !== "string" || !risk.title || typeof risk.body !== "string" || !risk.body) {
        warnings.push(`risks[${risk.id}]: missing title or body; dropped`);
        return false;
      }
      risk.finding_ids = cleanReferenceList(risk.finding_ids, findingIds, `risks[${risk.id}].finding_ids`, warnings);
      return true;
    });
  } else if (data.risks !== undefined) {
    warnings.push("risks: not a list; dropped");
    delete data.risks;
  }

  if (data.cost_estimate !== undefined && (!data.cost_estimate || typeof data.cost_estimate !== "object" || Array.isArray(data.cost_estimate))) {
    warnings.push("cost_estimate: not a mapping; dropped");
    delete data.cost_estimate;
  }

  if (Array.isArray(data.next_steps)) {
    data.next_steps = data.next_steps.filter((step, index) => {
      const valid = step && typeof step === "object" && typeof step.title === "string" && step.title;
      if (!valid) {
        warnings.push(`next_steps[${index}]: missing mapping or title; dropped`);
      }
      return valid;
    });
  } else if (data.next_steps !== undefined) {
    warnings.push("next_steps: not a list; dropped");
    delete data.next_steps;
  }

  return [...validThemeIds];
}

function deriveReportMode(enrichment) {
  if (!enrichment || typeof enrichment !== "object") {
    return "raw";
  }
  const hasBriefing = enrichment.briefing && typeof enrichment.briefing === "object";
  const hasThemes = Array.isArray(enrichment.themes) && enrichment.themes.some((theme) => Array.isArray(theme?.finding_ids) && theme.finding_ids.length);
  const hasFindings = Array.isArray(enrichment.findings) && enrichment.findings.length > 0;
  if (hasBriefing && hasThemes && hasFindings) {
    return "ai-narrated";
  }
  return hasBriefing || hasThemes || hasFindings ? "partial" : "raw";
}

export function loadEnrichment({ memoryDir, runId, enrichmentPath } = {}) {
  const warnings = [];
  const findingsData = readYaml(path.resolve(memoryDir, "findings.yaml")) || {};
  const findings = Array.isArray(findingsData.findings) ? findingsData.findings : [];
  const findingIds = new Set(findings.filter((finding) => finding && typeof finding === "object" && finding.id).map((finding) => finding.id));
  const resolvedPath = resolveEnrichmentPath(memoryDir, runId, enrichmentPath);
  if (!resolvedPath) {
    return { enrichment: null, warnings, mode: "raw", path: null, findingIds, themeIds: [] };
  }
  if (!fs.existsSync(resolvedPath)) {
    warnings.push(`enrichment file not found at ${resolvedPath}`);
    return { enrichment: null, warnings, mode: "raw", path: resolvedPath, findingIds, themeIds: [] };
  }
  let enrichment;
  try {
    enrichment = readYaml(resolvedPath);
  } catch (error) {
    warnings.push(`failed to parse enrichment file at ${resolvedPath}: ${error.message}`);
    return { enrichment: null, warnings, mode: "raw", path: resolvedPath, findingIds, themeIds: [] };
  }
  if (!enrichment || typeof enrichment !== "object" || Array.isArray(enrichment)) {
    warnings.push(`enrichment file at ${resolvedPath} did not parse to a mapping`);
    return { enrichment: null, warnings, mode: "raw", path: resolvedPath, findingIds, themeIds: [] };
  }
  if (enrichment.version !== 1) {
    warnings.push(`enrichment version ${JSON.stringify(enrichment.version)} is not supported by this generator; ignoring`);
    return { enrichment: null, warnings, mode: "raw", path: resolvedPath, findingIds, themeIds: [] };
  }
  const themeIds = sanitizeEnrichment(enrichment, findingIds, warnings);
  return {
    enrichment,
    warnings,
    mode: deriveReportMode(enrichment),
    path: resolvedPath,
    findingIds,
    themeIds,
  };
}

export function validateEnrichment({ memoryDir, runId, enrichmentPath, allowRaw = false } = {}) {
  const failures = [];
  const findingsData = readYaml(path.resolve(memoryDir, "findings.yaml")) || {};
  const findings = Array.isArray(findingsData.findings) ? findingsData.findings : [];
  const loaded = loadEnrichment({ memoryDir, runId, enrichmentPath });
  const { enrichment, mode, warnings } = loaded;

  if (!findings.length && allowRaw && mode === "raw") {
    return { ok: true, mode, failures, warnings };
  }
  if (!findings.length) {
    failures.push("findings.yaml has no findings; nothing to enrich.");
  }
  if (!enrichment) {
    failures.push("loader returned no enrichment (unsupported version, unreadable file, or empty content).");
  } else {
    const paragraph = enrichment.briefing?.paragraph;
    if (typeof paragraph !== "string" || !paragraph.trim()) {
      failures.push("briefing.paragraph is missing or empty.");
    } else if (paragraph.trim().length < 200) {
      failures.push(`briefing.paragraph is too short (${paragraph.trim().length} chars, minimum 200).`);
    }

    if (!Array.isArray(enrichment.headlines)) {
      failures.push("headlines block is missing.");
    } else {
      if (enrichment.headlines.length < 3 || enrichment.headlines.length > 5) {
        failures.push(`${enrichment.headlines.length} headlines; expected 3-5.`);
      }
      enrichment.headlines.forEach((headline, index) => {
        if (!headline?.kind) failures.push(`headlines[${index}]: missing kind.`);
        if (!headline?.title) failures.push(`headlines[${index}]: missing title.`);
      });
    }

    if (!Array.isArray(enrichment.themes) || !enrichment.themes.length) {
      failures.push("themes block is missing or empty.");
    } else {
      const namedThemes = enrichment.themes.filter((theme) => theme?.id !== OTHER_THEME_ID && typeof theme?.label === "string" && theme.label.trim());
      if (!namedThemes.length) {
        failures.push("themes must include at least one named theme with a label.");
      }
      const otherCount = enrichment.themes.find((theme) => theme?.id === OTHER_THEME_ID)?.finding_ids?.length || 0;
      const totalAssigned = enrichment.themes.reduce((total, theme) => total + (Array.isArray(theme?.finding_ids) ? theme.finding_ids.length : 0), 0);
      if (totalAssigned && otherCount / totalAssigned > 0.5) {
        failures.push(`${otherCount}/${totalAssigned} findings landed in the auto-bucketed 'other' theme; maximum is 50%.`);
      }
    }

    const highFindings = findings.filter((finding) => ["critical", "high"].includes(String(finding?.severity || "").toLowerCase()));
    const coveredIds = new Set((Array.isArray(enrichment.findings) ? enrichment.findings : [])
      .filter((entry) => typeof entry?.why_it_matters === "string" && entry.why_it_matters.trim())
      .map((entry) => entry.id));
    if (highFindings.length) {
      const covered = highFindings.filter((finding) => coveredIds.has(finding.id)).length;
      if (covered / highFindings.length < 0.6) {
        failures.push(`only ${covered}/${highFindings.length} high+critical findings have why_it_matters; minimum is 60%.`);
      }
    }

    if (!Array.isArray(enrichment.next_steps) || !enrichment.next_steps.length) {
      failures.push("next_steps block is missing or empty.");
    } else {
      if (enrichment.next_steps.length < 1 || enrichment.next_steps.length > 3) {
        failures.push(`${enrichment.next_steps.length} next_steps entries; expected 1-3.`);
      }
      enrichment.next_steps.forEach((step, index) => {
        if (!step?.kind) failures.push(`next_steps[${index}]: missing kind.`);
        if (!step?.title) failures.push(`next_steps[${index}]: missing title.`);
      });
    }
  }
  if (mode !== "ai-narrated" && !(allowRaw && mode === "raw" && !findings.length)) {
    failures.unshift(`predicted report mode is '${mode}'; expected 'ai-narrated'.`);
  }
  return { ok: failures.length === 0, mode, failures, warnings };
}

function intentSlug(intent) {
  const concern = intent?.user_concern;
  if (typeof concern !== "string" || !concern) {
    return "assess";
  }
  return concern.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "assess";
}

function bucketSeverity(findings) {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of findings) {
    const severity = String(finding?.severity || "info").toLowerCase();
    counts[SEVERITIES.includes(severity) ? severity : "info"] += 1;
  }
  return counts;
}

function bucketState(findings) {
  const counts = {};
  for (const finding of findings) {
    const state = String(finding?.state || "new").toLowerCase();
    counts[state] = (counts[state] || 0) + 1;
  }
  return counts;
}

function deriveTopRecommendation(findings, intent) {
  const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const newFindings = findings.filter((finding) => String(finding?.state || "new").toLowerCase() === "new");
  const candidates = [...(newFindings.length ? newFindings : findings)].sort((left, right) =>
    (rank[String(left?.severity || "info").toLowerCase()] ?? 5) - (rank[String(right?.severity || "info").toLowerCase()] ?? 5));
  if (!candidates.length) {
    return { kind: "no-findings", summary: `No outstanding findings for focus '${intent?.user_concern || "overview"}'.`, next_action: null, prefilled_prompt: null };
  }
  const top = candidates[0];
  const skill = String(top.skill || "").toLowerCase();
  const title = top.title || "(untitled)";
  if (skill.startsWith("cve-") || title.toLowerCase().includes("cve")) {
    return { kind: "security", summary: `Address top vulnerability: ${title}`, next_action: "create-modernization-plan", prefilled_prompt: `Fix ${title} and any related CVEs in dependencies` };
  }
  if (skill.startsWith("cwe-")) {
    return { kind: "code-quality", summary: `Remediate top code-weakness: ${title}`, next_action: "create-modernization-plan", prefilled_prompt: `Refactor to eliminate ${title}` };
  }
  if (skill.startsWith("fact-")) {
    return { kind: "readiness", summary: `Investigate: ${title}`, next_action: "create-modernization-plan", prefilled_prompt: "Create a modernization plan addressing the top readiness gaps" };
  }
  return { kind: "generic", summary: title, next_action: "create-modernization-plan", prefilled_prompt: "Create a modernization plan from the assessment's high-priority findings" };
}

function buildPayload({ memoryDir, runId, projectRoot, enrichmentPath }) {
  const runDir = path.resolve(memoryDir, "runs", runId);
  const findingsData = readYaml(path.resolve(memoryDir, "findings.yaml")) || {};
  const suppressionsData = readYaml(path.resolve(memoryDir, "suppressions.yaml")) || {};
  const preferences = readYaml(path.resolve(memoryDir, "preferences.yaml")) || {};
  const intent = readYaml(path.resolve(runDir, "intent.yaml")) || readYaml(path.resolve(memoryDir, "last-intent.yaml")) || {};
  const selectedSkills = readYaml(path.resolve(runDir, "selected-skills.yaml")) || {};
  const findings = Array.isArray(findingsData.findings) ? findingsData.findings : [];
  const suppressions = Array.isArray(suppressionsData.rules) ? suppressionsData.rules : [];
  const selectedGroups = Array.isArray(intent.selected_groups) ? intent.selected_groups : [];
  const loaded = loadEnrichment({ memoryDir, runId, enrichmentPath });
  const runDate = String(runId || "").slice(0, 10);
  return {
    payload: {
      meta: {
        run_id: runId,
        generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        project_root: projectRoot ? path.resolve(projectRoot) : null,
        intent_slug: intentSlug(intent),
        report_mode: loaded.mode,
        enrichment_path: loaded.path,
        enrichment_warnings: loaded.warnings,
      },
      intent,
      selected_groups: selectedGroups,
      skipped_groups: ALL_GROUPS.filter((group) => !selectedGroups.includes(group)),
      selected_skills: selectedSkills,
      counts: {
        total: findings.length,
        new_this_run: findings.filter((finding) => String(finding?.first_seen || "").startsWith(runDate)).length,
        by_severity: bucketSeverity(findings),
        by_state: bucketState(findings),
        suppression_rules: suppressions.length,
      },
      findings,
      suppressions,
      preferences,
      enrichment: loaded.enrichment,
      top_recommendation: deriveTopRecommendation(findings, intent),
    },
    loaded,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHtml(payload) {
  const counts = payload.counts;
  let projectLabel = payload.meta.project_root || "(unknown project)";
  if (projectLabel.length > 80) {
    projectLabel = `…${projectLabel.slice(-79)}`;
  }
  const json = JSON.stringify(payload).replace(/<\/script/gi, "<\\/script");
  const replacements = {
    RUN_ID: escapeHtml(payload.meta.run_id),
    GENERATED_AT: escapeHtml(payload.meta.generated_at),
    PROJECT_LABEL: escapeHtml(projectLabel),
    INTENT_SLUG: escapeHtml(payload.meta.intent_slug),
    REPORT_MODE: escapeHtml(payload.meta.report_mode),
    TOTAL_FINDINGS: String(counts.total),
    NEW_FINDINGS: String(counts.new_this_run),
    CRITICAL_COUNT: String(counts.by_severity.critical),
    HIGH_COUNT: String(counts.by_severity.high),
    MEDIUM_COUNT: String(counts.by_severity.medium),
    LOW_COUNT: String(counts.by_severity.low),
    TOP_RECOMMENDATION: escapeHtml(payload.top_recommendation?.summary || "—"),
    REPORT_DATA_JSON: json,
  };
  let html = fs.readFileSync(TEMPLATE_PATH, "utf8");
  for (const [name, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${name}}}`, value);
  }
  return html;
}

function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, content, "utf8");
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (process.platform === "win32" && fs.existsSync(filePath)) {
      fs.rmSync(filePath);
      fs.renameSync(temporaryPath, filePath);
    } else {
      throw error;
    }
  }
}

export function generateHtmlReport({ memoryDir, runId, outputDir, projectRoot, enrichmentPath } = {}) {
  const { payload, loaded } = buildPayload({ memoryDir, runId, projectRoot, enrichmentPath });
  const html = renderHtml(payload);
  const resolvedOutputDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });
  const versionedPath = path.join(resolvedOutputDir, `${runId}-${payload.meta.intent_slug}.html`);
  const latestPath = path.join(resolvedOutputDir, "latest.html");
  atomicWrite(versionedPath, html);
  atomicWrite(latestPath, html);
  return {
    ok: true,
    mode: loaded.mode,
    failures: [],
    warnings: loaded.warnings,
    versionedPath,
    latestPath,
    reportPath: versionedPath,
    payload,
  };
}
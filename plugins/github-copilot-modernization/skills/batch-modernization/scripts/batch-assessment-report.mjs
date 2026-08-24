import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BatchStateError, fileDigest } from "./batch-state.mjs";
import { validateSchema } from "./schema-validator.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const aggregateSchemaPath = path.resolve(scriptRoot, "..", "schemas", "aggregate-report.v1.json");
const aggregateSchema = JSON.parse(fs.readFileSync(aggregateSchemaPath, "utf8"));
const USABLE_STATUSES = new Set(["completed", "completed_with_issues"]);
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const ASSESSMENT_CONFIG_FIELDS = [
  "targetRuntime",
  "targetComputeServices",
  "enableContainerization",
  "targetOS",
  "minimumCveSeverity",
  "cveScanScope",
];

function assessmentConfig(value = {}) {
  return Object.fromEntries(ASSESSMENT_CONFIG_FIELDS
    .filter((name) => value[name] !== undefined)
    .map((name) => [name, value[name]]));
}

function asDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BatchStateError(`${label} is not a valid timestamp`, "invalid_report_timestamp");
  }
  return date;
}

function timestamp(value) {
  const date = asDate(value, "Batch completion time");
  const part = (number) => String(number).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    part(date.getUTCMonth() + 1),
    part(date.getUTCDate()),
    part(date.getUTCHours()),
    part(date.getUTCMinutes()),
    part(date.getUTCSeconds()),
  ].join("");
}

export function assessmentReportPaths({ batchRoot, completedAt } = {}) {
  const root = path.resolve(batchRoot ?? "");
  const batchesDirectory = path.dirname(root);
  const modernizeDirectory = path.dirname(batchesDirectory);
  const githubDirectory = path.dirname(modernizeDirectory);
  if (path.basename(batchesDirectory).toLowerCase() !== "batches"
      || path.basename(modernizeDirectory).toLowerCase() !== "modernize"
      || path.basename(githubDirectory).toLowerCase() !== ".github") {
    throw new BatchStateError(
      "Batch root must be a direct child of <launch-root>/.github/modernize/batches",
      "invalid_batch_root",
    );
  }
  const reportDirectory = path.join(
    modernizeDirectory,
    "assessment",
    `reports-${timestamp(completedAt)}`,
  );
  return {
    reportDirectory,
    reportIndex: path.join(reportDirectory, "index.html"),
    aggregateReport: path.join(reportDirectory, "aggregate-report.json"),
  };
}

function reportIdentity(value) {
  let sanitized = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/]+/g, ".")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  if (!sanitized) sanitized = `repo-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 8)}`;
  if (WINDOWS_RESERVED_NAME.test(sanitized)) sanitized = `repo-${sanitized}`;
  return sanitized;
}

function reportIdentities(results) {
  const used = new Set();
  return new Map(results.map((result) => {
    const base = reportIdentity(result.executionUnitId);
    let candidate = base;
    if (used.has(candidate.toLowerCase())) {
      const suffix = crypto.createHash("sha256").update(result.executionUnitId).digest("hex").slice(0, 8);
      candidate = `${base.slice(0, 111)}-${suffix}`;
    }
    if (used.has(candidate.toLowerCase())) {
      throw new BatchStateError(
        `Report directory identity collision: ${result.executionUnitId}`,
        "report_identity_collision",
      );
    }
    used.add(candidate.toLowerCase());
    return [result.executionUnitId, candidate];
  }));
}

function posixRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function copyValidatedArtifact(sourcePath, destinationPath, expectedDigest) {
  if (!expectedDigest || fileDigest(sourcePath) !== expectedDigest) {
    throw new BatchStateError(
      `Validated artifact digest changed before report publication: ${sourcePath}`,
      "validated_artifact_changed",
    );
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  if (fileDigest(destinationPath) !== expectedDigest) {
    throw new BatchStateError(
      `Published report copy does not match its validated source: ${destinationPath}`,
      "report_copy_mismatch",
    );
  }
}

function integer(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function reportMetrics(report) {
  return {
    total: integer(report?.metadata?.totalFindings),
    actionable: integer(report?.metadata?.totalActionableFindings),
    tracked: integer(report?.metadata?.totalTrackedFindings),
    categories: Array.isArray(report?.categories) ? report.categories.length : 0,
    security: Array.isArray(report?.security) ? report.security.length : 0,
  };
}

function singleReportSummary(htmlPath, language) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/<script type=["']application\/json["'] id=["']report-data["']>([\s\S]*?)<\/script>/i);
  if (!match) {
    throw new BatchStateError(`Validated HTML has no report-data payload: ${htmlPath}`, "report_payload_missing");
  }
  let payload;
  try {
    payload = JSON.parse(match[1]);
  } catch (error) {
    throw new BatchStateError(`Validated HTML report-data is invalid: ${error.message}`, "report_payload_invalid");
  }
  const recommendation = payload.top_recommendation;
  return {
    bySeverity: Object.fromEntries(SEVERITIES.map((severity) => [
      severity,
      payload.counts.by_severity[severity],
    ])),
    byState: Object.fromEntries(Object.entries(payload.counts.by_state)
      .sort(([left], [right]) => left.localeCompare(right))),
    topRecommendation: {
      kind: recommendation.kind,
      summary: recommendation.summary,
      nextAction: recommendation.next_action,
      prefilledPrompt: recommendation.prefilled_prompt,
    },
    planningSupported: language === "java" || language === "dotnet",
  };
}

function sumBuckets(repositories, field, initialKeys = []) {
  const totals = Object.fromEntries(initialKeys.map((key) => [key, 0]));
  for (const repository of repositories) {
    for (const [key, value] of Object.entries(repository.findings[field])) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return Object.fromEntries(Object.entries(totals).sort(([left], [right]) => {
    const leftIndex = initialKeys.indexOf(left);
    const rightIndex = initialKeys.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) return leftIndex - rightIndex;
    return left.localeCompare(right);
  }));
}

function manifestDetails(manifest, result) {
  const repositories = (manifest.resolvedConfig?.repositories ?? []).filter(
    (repository) => repository.repoId === result.repoId,
  );
  const units = repositories.flatMap((repository) => repository.executionUnits ?? []).filter(
    (unit) => unit.executionUnitId === result.executionUnitId,
  );
  if (repositories.length !== 1 || units.length !== 1) {
    throw new BatchStateError(
      `Report input is not uniquely represented in the manifest: ${result.executionUnitId}`,
      "report_manifest_mismatch",
    );
  }
  const repository = repositories[0];
  const unit = units[0];
  const appIdentifiers = (manifest.resolvedConfig?.apps ?? [])
    .filter((app) => app.repoIds.includes(result.repoId))
    .map((app) => app.identifier);
  return { repository, unit, appIdentifiers };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderIndex(aggregate) {
  const plugin = aggregate.extensions["github-copilot-modernization"];
  const rows = plugin.repositories.map((repository) => {
    const reportLink = repository.reports
      ? `<a href="${escapeHtml(repository.reports.html)}">Open report</a>`
      : "Unavailable";
    const error = repository.errors.length > 0
      ? `<div class="error">${escapeHtml(repository.errors.join("; "))}</div>`
      : "";
    const elevated = repository.findings.bySeverity.critical + repository.findings.bySeverity.high;
    const recommendation = repository.topRecommendation?.summary ?? "Unavailable";
    const planning = repository.planningSupported === null
      ? "Unavailable"
      : (repository.planningSupported ? "Supported" : "Not supported");
    return `<tr>
      <td><strong>${escapeHtml(repository.identity)}</strong>${error}</td>
      <td><span class="status ${escapeHtml(repository.status)}">${escapeHtml(repository.status)}</span></td>
      <td>${escapeHtml(repository.language)}</td>
      <td>${repository.findings.tracked}${elevated > 0 ? ` (${elevated} critical/high)` : ""}</td>
      <td>${escapeHtml(recommendation)}</td>
      <td>${planning}</td>
      <td>${reportLink}</td>
    </tr>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Batch Assessment ${escapeHtml(plugin.batchId)}</title>
  <style>
    :root { color-scheme: light; --ink: #17202a; --muted: #59636e; --line: #d8dee4; --paper: #ffffff; --canvas: #f4f6f8; --accent: #0969da; --ok: #1a7f37; --warn: #9a6700; --bad: #cf222e; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--canvas); color: var(--ink); font-family: "Segoe UI", sans-serif; }
    header { background: #24292f; color: white; padding: 28px max(24px, calc((100vw - 1120px) / 2)); }
    header h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: 0; }
    header p { margin: 0; color: #d0d7de; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 24px 48px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .metric { background: var(--paper); border: 1px solid var(--line); border-radius: 6px; padding: 16px; }
    .metric strong { display: block; font-size: 26px; }
    .metric span { color: var(--muted); font-size: 13px; }
    .table-wrap { overflow-x: auto; background: var(--paper); border: 1px solid var(--line); border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 13px 15px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: #f6f8fa; font-size: 13px; }
    tr:last-child td { border-bottom: 0; }
    a { color: var(--accent); }
    .status { font-size: 12px; font-weight: 600; }
    .status.completed { color: var(--ok); }
    .status.completed_with_issues { color: var(--warn); }
    .status.failed, .status.protocol_error, .status.interrupted { color: var(--bad); }
    .error { margin-top: 5px; color: var(--bad); font-size: 12px; max-width: 520px; }
    footer { margin-top: 18px; color: var(--muted); font-size: 12px; }
    @media (max-width: 700px) { .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } th, td { padding: 10px; } }
  </style>
</head>
<body>
  <header><h1>Batch Assessment</h1><p>${escapeHtml(plugin.batchId)} · ${escapeHtml(plugin.status)}</p></header>
  <main>
    <section class="summary" aria-label="Assessment summary">
      <div class="metric"><strong>${plugin.counts.total}</strong><span>Repositories</span></div>
      <div class="metric"><strong>${plugin.counts.completed}</strong><span>Completed</span></div>
      <div class="metric"><strong>${plugin.counts.trackedFindings}</strong><span>Tracked findings</span></div>
      <div class="metric"><strong>${plugin.counts.bySeverity.critical + plugin.counts.bySeverity.high}</strong><span>Critical / high</span></div>
      <div class="metric"><strong>${plugin.counts.byState.new ?? 0}</strong><span>New</span></div>
      <div class="metric"><strong>${plugin.planningSupported.supported}/${plugin.counts.total}</strong><span>Planning supported</span></div>
    </section>
    <div class="table-wrap"><table>
      <thead><tr><th>Repository</th><th>Status</th><th>Language</th><th>Findings</th><th>Top recommendation</th><th>Planning</th><th>Report</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <footer><a href="aggregate-report.json">View aggregate data</a> · Generated by GitHub Copilot Modernization Plugin</footer>
  </main>
</body>
</html>
`;
}

function buildReportTree({ treeRoot, manifest, state, results, identities }) {
  const repositories = [];
  const analysisStarts = [];
  const analysisEnds = [];
  const effectiveDomains = new Set();
  for (const result of results) {
    const { repository, unit, appIdentifiers } = manifestDetails(manifest, result);
    const identity = result.executionUnitId;
    const directoryName = identities.get(identity);
    let reports = null;
    let metrics = {
      total: 0,
      actionable: 0,
      tracked: 0,
      categories: 0,
      security: 0,
      bySeverity: Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])),
      byState: {},
    };
    let topRecommendation = null;
    let planningSupported = null;
    let repositoryAssessmentConfig = null;
    if (USABLE_STATUSES.has(result.status)) {
      if (!result.artifacts.report || !result.artifacts.html) {
        throw new BatchStateError(
          `Usable assessment result has no report pair: ${identity}`,
          "report_artifact_missing",
        );
      }
      const repoDirectory = path.join(treeRoot, "repos", directoryName);
      const jsonPath = path.join(repoDirectory, "report.json");
      const htmlPath = path.join(repoDirectory, "report.html");
      copyValidatedArtifact(result.artifacts.report, jsonPath, result.artifactDigests.report);
      copyValidatedArtifact(result.artifacts.html, htmlPath, result.artifactDigests.html);
      const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      repositoryAssessmentConfig = assessmentConfig(report.metadata.intent?.assessment_config);
      const singleSummary = singleReportSummary(htmlPath, result.language);
      metrics = { ...reportMetrics(report), ...singleSummary };
      topRecommendation = singleSummary.topRecommendation;
      planningSupported = singleSummary.planningSupported;
      delete metrics.topRecommendation;
      delete metrics.planningSupported;
      for (const domain of report.metadata.domains) effectiveDomains.add(domain);
      if (report.metadata?.analysisStartTime) analysisStarts.push(asDate(report.metadata.analysisStartTime, "Report analysisStartTime"));
      if (report.metadata?.analysisEndTime) analysisEnds.push(asDate(report.metadata.analysisEndTime, "Report analysisEndTime"));
      const facts = [];
      const digests = {
        json: result.artifactDigests.report,
        html: result.artifactDigests.html,
      };
      for (const [artifactName, sourcePath] of Object.entries(result.artifacts)
        .filter(([name]) => name.startsWith("fact:"))
        .sort(([left], [right]) => left.localeCompare(right))) {
        const fileName = path.basename(sourcePath);
        const destination = path.join(repoDirectory, "facts", fileName);
        copyValidatedArtifact(sourcePath, destination, result.artifactDigests[artifactName]);
        const relative = posixRelative(treeRoot, destination);
        facts.push(relative);
        digests[relative] = result.artifactDigests[artifactName];
      }
      reports = {
        json: posixRelative(treeRoot, jsonPath),
        html: posixRelative(treeRoot, htmlPath),
        facts,
        digests,
      };
    }
    repositories.push({
      identity,
      repoId: result.repoId,
      executionUnitId: result.executionUnitId,
      status: result.status,
      language: result.language,
      workspacePath: result.workspacePath,
      reports,
      findings: metrics,
      assessmentConfig: repositoryAssessmentConfig,
      topRecommendation,
      planningSupported,
      errors: result.errors,
      manifest: { repository, unit, appIdentifiers },
    });
  }
  const publicRepositories = repositories.map(({ manifest: ignored, ...repository }) => repository);
  const bySeverity = sumBuckets(publicRepositories, "bySeverity", SEVERITIES);
  const byState = sumBuckets(publicRepositories, "byState");
  const topRecommendations = publicRepositories
    .filter((repository) => repository.topRecommendation !== null)
    .map((repository) => ({ identity: repository.identity, ...repository.topRecommendation }));
  const planningSupported = {
    supported: publicRepositories.filter((repository) => repository.planningSupported === true).length,
    unsupported: publicRepositories.filter((repository) => repository.planningSupported === false).length,
    unavailable: publicRepositories.filter((repository) => repository.planningSupported === null).length,
  };
  const counts = {
    total: publicRepositories.length,
    completed: publicRepositories.filter((repository) => repository.status === "completed").length,
    completedWithIssues: publicRepositories.filter((repository) => repository.status === "completed_with_issues").length,
    failed: publicRepositories.filter((repository) => ["protocol_error", "failed", "interrupted"].includes(repository.status)).length,
    findings: publicRepositories.reduce((total, repository) => total + repository.findings.total, 0),
    actionableFindings: publicRepositories.reduce((total, repository) => total + repository.findings.actionable, 0),
    trackedFindings: publicRepositories.reduce((total, repository) => total + repository.findings.tracked, 0),
    bySeverity,
    byState,
  };
  const summary = {
    totalProjects: publicRepositories.filter((repository) => repository.reports !== null).length,
    totalIssues: counts.findings,
    totalIncidents: 0,
    totalEffort: 0,
  };
  const aggregate = {
    schemaVersion: 1,
    version: "1.0.0",
    producer: "GitHub Copilot Modernization Plugin",
    platform: "copilot-cli-plugin",
    metadata: {
      schema: "github-copilot-modernization/batch-assessment/v1",
      batchId: state.batchId,
      generatedAt: state.updatedAt,
      analysisStartTime: (analysisStarts.length > 0
        ? new Date(Math.min(...analysisStarts.map((date) => date.getTime())))
        : asDate(state.createdAt, "Batch creation time")).toISOString(),
      analysisEndTime: (analysisEnds.length > 0
        ? new Date(Math.max(...analysisEnds.map((date) => date.getTime())))
        : asDate(state.updatedAt, "Batch completion time")).toISOString(),
      status: state.status,
      domains: effectiveDomains.size > 0
        ? [...effectiveDomains]
        : (manifest.assessment.decisions.domains ?? []),
      mode: manifest.assessment.decisions.analysisCoverage,
      repos: repositories.map((repository) => ({
        identity: repository.identity,
        name: repository.manifest.unit.displayName ?? repository.identity,
        path: repository.workspacePath,
        sourceRepo: repository.manifest.repository.name ?? repository.repoId,
        appIdentifiers: repository.manifest.appIdentifiers,
        status: repository.status,
        language: repository.language,
        reportPath: repository.reports?.html ?? null,
      })),
    },
    summary,
    projects: repositories
      .filter((repository) => repository.reports !== null)
      .map((repository) => ({
        properties: {
          repo: repository.identity,
          appName: repository.manifest.repository.name ?? repository.repoId,
          languages: [repository.language],
          status: repository.status,
          reportPath: repository.reports.html,
        },
        incidents: [],
      })),
    rules: {},
    extensions: {
      "github-copilot-modernization": {
        schema: "github-copilot-modernization/batch-assessment/v1",
        batchId: state.batchId,
        status: state.status,
        counts,
        assessmentConfig: assessmentConfig(manifest.assessment.decisions),
        topRecommendations,
        planningSupported,
        repositories: publicRepositories,
      },
    },
    apps: (manifest.resolvedConfig.apps ?? []).map((app) => ({
      identifier: app.identifier,
      repos: app.repoIds,
    })),
  };
  const schemaErrors = validateSchema(aggregate, aggregateSchema, aggregateSchemaPath);
  if (schemaErrors.length > 0) {
    throw new BatchStateError(
      `Aggregate report violates its v1 schema: ${schemaErrors.join("; ")}`,
      "schema_validation_failed",
    );
  }
  fs.writeFileSync(path.join(treeRoot, "aggregate-report.json"), `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(treeRoot, "index.html"), renderIndex(aggregate), "utf8");
  return aggregate;
}

export function directoryDigest(directoryPath) {
  const root = path.resolve(directoryPath);
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new BatchStateError(`Published report directory is unavailable: ${root}`, "report_directory_missing");
  }
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new BatchStateError(`Published report contains a symbolic link: ${entryPath}`, "report_tree_invalid");
      }
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
      else throw new BatchStateError(`Published report contains an unsupported entry: ${entryPath}`, "report_tree_invalid");
    }
  };
  visit(root);
  const hash = crypto.createHash("sha256");
  for (const filePath of files.sort((left, right) => posixRelative(root, left).localeCompare(posixRelative(root, right)))) {
    hash.update(posixRelative(root, filePath));
    hash.update("\0");
    hash.update(fileDigest(filePath));
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

function renameReportDirectory(source, destination) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (process.platform !== "win32" || !["EACCES", "EBUSY", "EPERM"].includes(error.code)) throw error;
    }
  }
  throw lastError;
}

export function publishBatchAssessmentReport({ batchRoot, manifest, state, results } = {}) {
  const paths = assessmentReportPaths({ batchRoot, completedAt: state.updatedAt });
  const parent = path.dirname(paths.reportDirectory);
  fs.mkdirSync(parent, { recursive: true });
  const temporaryRoot = path.join(
    parent,
    `.${path.basename(paths.reportDirectory)}.${process.pid}.${crypto.randomUUID()}.publish`,
  );
  fs.mkdirSync(temporaryRoot);
  try {
    const aggregate = buildReportTree({
      treeRoot: temporaryRoot,
      manifest,
      state,
      results,
      identities: reportIdentities(results),
    });
    const candidateDigest = directoryDigest(temporaryRoot);
    if (fs.existsSync(paths.reportDirectory)) {
      if (directoryDigest(paths.reportDirectory) !== candidateDigest) {
        throw new BatchStateError(
          `Assessment report destination already contains different data: ${paths.reportDirectory}`,
          "report_publication_conflict",
        );
      }
    } else {
      try {
        renameReportDirectory(temporaryRoot, paths.reportDirectory);
      } catch (error) {
        if (!fs.existsSync(paths.reportDirectory) || directoryDigest(paths.reportDirectory) !== candidateDigest) {
          throw error;
        }
      }
    }
    return {
      aggregate,
      paths,
      reportDirectoryDigest: directoryDigest(paths.reportDirectory),
      reportIndexDigest: fileDigest(paths.reportIndex),
      aggregateReportDigest: fileDigest(paths.aggregateReport),
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
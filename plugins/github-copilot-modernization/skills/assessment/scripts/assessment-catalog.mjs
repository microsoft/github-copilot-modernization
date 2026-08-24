import fs from "node:fs";
import path from "node:path";

export const FACT_SKILL_IDS = Object.freeze([
  "architecture-diagram",
  "dependency-map",
  "api-service-contracts",
  "data-architecture",
  "configuration-inventory",
  "business-workflows",
]);

export const SECURITY_CWE_SKILL_IDS = Object.freeze([
  "cwe-code-quality",
  "cwe-concurrency-synchronization",
  "cwe-credentials-secrets",
  "cwe-file-path-security",
  "cwe-injection-attacks",
  "cwe-memory-safety",
]);

export const SECURITY_SKILL_IDS = Object.freeze([
  "cve-known-vulnerabilities",
  ...SECURITY_CWE_SKILL_IDS,
]);

const SUPPORTED_DOMAINS = new Set(["security", "cloud-readiness", "java-upgrade"]);
const SUPPORTED_COVERAGE = new Set(["issue-only", "full"]);

export function defaultAssessmentDomains(language) {
  switch (language) {
    case "java":
      return ["java-upgrade", "cloud-readiness"];
    case "dotnet":
      return ["cloud-readiness"];
    case "javascript":
    case "typescript":
      return [];
    default:
      throw new Error(`Unsupported assessment language: ${language}`);
  }
}

function normalizeDomains(domains) {
  return [...new Set((domains ?? []).filter((domain) => SUPPORTED_DOMAINS.has(domain)))];
}

function task(skillId, outputPath) {
  return { skillId, outputPath };
}

function resolveConcurrency(taskCount, maxConcurrency) {
  if (maxConcurrency === undefined || maxConcurrency === null) {
    return taskCount;
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error("maxConcurrency must be a positive integer");
  }
  return Math.min(taskCount, maxConcurrency);
}

export function buildAssessmentPlan({
  domains = [],
  analysisCoverage = "issue-only",
  assessmentRoot = path.join(".github", "modernize", "assessment"),
  attemptScratchRoot,
  maxConcurrency,
} = {}) {
  if (!SUPPORTED_COVERAGE.has(analysisCoverage)) {
    throw new Error(`Unsupported analysis coverage: ${analysisCoverage}`);
  }

  const selectedDomains = normalizeDomains(domains);
  const taskOutputRoot = attemptScratchRoot ?? assessmentRoot;
  const batches = [];

  if (selectedDomains.includes("security")) {
    const securityRoot = path.join(taskOutputRoot, "engines", "security", "incoming");
    batches.push({
      id: "security",
      execution: "parallel",
      maxConcurrency: resolveConcurrency(SECURITY_SKILL_IDS.length, maxConcurrency),
      tasks: SECURITY_SKILL_IDS.map((skillId) =>
        task(skillId, path.join(securityRoot, `${skillId}.json`))),
    });
  }

  if (analysisCoverage === "full") {
    const factsRoot = path.join(taskOutputRoot, "engines", "facts");
    batches.push({
      id: "facts",
      execution: "parallel",
      maxConcurrency: resolveConcurrency(FACT_SKILL_IDS.length, maxConcurrency),
      tasks: FACT_SKILL_IDS.map((skillId) =>
        task(skillId, path.join(factsRoot, `${skillId}.md`))),
    });
  }

  return {
    version: 1,
    domains: selectedDomains,
    analysisCoverage,
    appcat: selectedDomains.filter((domain) => domain !== "security"),
    batches,
    maxConcurrentSubagents: batches.reduce(
      (maximum, batch) => Math.max(maximum, batch.maxConcurrency),
      0,
    ),
  };
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function assessmentConfigLines(config = {}) {
  const entries = Object.entries(config).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return [];
  const lines = ["assessment_config:"];
  for (const [name, value] of entries) {
    if (Array.isArray(value)) {
      lines.push(`  ${name}:`, ...value.map((entry) => `    - ${yamlScalar(entry)}`));
    } else if (typeof value === "boolean") {
      lines.push(`  ${name}: ${value}`);
    } else {
      lines.push(`  ${name}: ${yamlScalar(value)}`);
    }
  }
  return lines;
}

function writeRunMetadata({ runDir, runId, language, plan }) {
  fs.mkdirSync(runDir, { recursive: true });
  const selectedSkills = plan.batches.flatMap((batch) => batch.tasks.map((entry) => entry.skillId));
  const intent = [
    "version: 1",
    `captured_at: ${yamlScalar(new Date().toISOString())}`,
    `language: ${yamlScalar(language)}`,
    "selected_groups:",
    ...plan.domains.map((domain) => `  - ${yamlScalar(domain)}`),
    `analysis_coverage: ${yamlScalar(plan.analysisCoverage)}`,
    ...assessmentConfigLines(plan.assessmentConfig),
    "",
  ].join("\n");
  const selected = [
    "version: 1",
    "skills:",
    ...selectedSkills.map((skillId) => `  - ${yamlScalar(skillId)}`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(runDir, "intent.yaml"), intent, "utf8");
  fs.writeFileSync(path.join(runDir, "selected-skills.yaml"), selected, "utf8");
}

function createFindingsFile(findingsPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(findingsPath, "wx", 0o600);
    fs.writeFileSync(descriptor, "version: 1\nfindings: []\n", "utf8");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function prepareAssessmentRun({
  workspacePath,
  runId,
  language,
  domains = [],
  analysisCoverage = "issue-only",
  attemptScratchRoot,
  maxConcurrency,
  assessmentConfig = {},
} = {}) {
  if (!workspacePath || !runId || !language) {
    throw new Error("workspacePath, runId, and language are required");
  }

  const workspaceRoot = path.resolve(workspacePath);
  const assessmentRoot = path.join(workspaceRoot, ".github", "modernize", "assessment");
  const memoryDir = path.join(workspaceRoot, ".github", "modernize", ".memory");
  const runDir = path.join(memoryDir, "runs", runId);
  const findingsPath = path.join(memoryDir, "findings.yaml");
  const resolvedScratchRoot = attemptScratchRoot
    ? path.resolve(attemptScratchRoot)
    : null;
  const plan = buildAssessmentPlan({
    domains,
    analysisCoverage,
    assessmentRoot,
    attemptScratchRoot: resolvedScratchRoot,
    maxConcurrency,
  });
  plan.assessmentConfig = { ...assessmentConfig };

  fs.mkdirSync(memoryDir, { recursive: true });
  if (resolvedScratchRoot) fs.mkdirSync(resolvedScratchRoot, { recursive: true });
  createFindingsFile(findingsPath);
  writeRunMetadata({ runDir, runId, language, plan });

  for (const batch of plan.batches) {
    for (const entry of batch.tasks) {
      fs.mkdirSync(path.dirname(entry.outputPath), { recursive: true });
      fs.rmSync(entry.outputPath, { force: true });
    }
  }

  return {
    ...plan,
    workspacePath: workspaceRoot,
    assessmentRoot,
    attemptScratchRoot: resolvedScratchRoot,
    memoryDir,
    runDir,
    findingsPath,
    appcatDir: path.join(runDir, "appcat"),
    reportsDir: path.join(assessmentRoot, "reports"),
    htmlReportsDir: path.join(workspaceRoot, ".github", "modernize", "reports"),
  };
}

export function archiveFactFiles({ workspacePath, reportPath, analysisCoverage, factsRoot } = {}) {
  if (analysisCoverage !== "full") {
    return { archived: [], missing: [] };
  }
  if (!workspacePath || !reportPath) {
    throw new Error("workspacePath and reportPath are required");
  }

  const sourceDir = factsRoot
    ? path.resolve(factsRoot)
    : path.join(
      path.resolve(workspacePath),
      ".github",
      "modernize",
      "assessment",
      "engines",
      "facts",
    );
  const destinationDir = path.join(path.dirname(path.resolve(reportPath)), "facts");
  const missing = FACT_SKILL_IDS.filter(
    (skillId) => !fs.existsSync(path.join(sourceDir, `${skillId}.md`)),
  );
  if (missing.length > 0) {
    return { archived: [], missing };
  }

  fs.mkdirSync(destinationDir, { recursive: true });
  const archived = [];
  for (const skillId of FACT_SKILL_IDS) {
    const fileName = `${skillId}.md`;
    const destination = path.join(destinationDir, fileName);
    fs.copyFileSync(path.join(sourceDir, fileName), destination);
    archived.push(destination);
  }
  return { archived, missing: [] };
}

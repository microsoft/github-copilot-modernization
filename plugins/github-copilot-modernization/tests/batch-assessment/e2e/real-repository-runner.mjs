#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  discoverNewBatchRoot,
  listBatchRoots,
  validateCompletedProductRun,
} from "./product-evidence.mjs";
import {
  acceptFormElicitation,
  invokeProductAgentAcp,
  validateProductPackage,
} from "./product-probe.mjs";
import { classifyProductHostBlocker } from "./product-scenario-runner.mjs";

function requireEvidence(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
}

function fileEvidence(filePath) {
  const content = fs.readFileSync(filePath);
  return {
    path: path.resolve(filePath),
    bytes: content.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function runGit(repositoryPath, args) {
  const result = spawnSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${repositoryPath}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function repositoryConfig(configPath) {
  const config = readJson(configPath, "repos.json");
  const entries = Array.isArray(config) ? config : config.repos;
  requireEvidence(Array.isArray(entries) && entries.length === 2, "Real E2E requires exactly two repositories");
  return entries.map((entry) => {
    requireEvidence(typeof entry.name === "string" && entry.name, "Repository name is missing");
    requireEvidence(typeof entry.path === "string" && path.isAbsolute(entry.path), `${entry.name} needs an absolute path`);
    const repositoryPath = path.resolve(entry.path);
    requireEvidence(fs.statSync(repositoryPath, { throwIfNoEntry: false })?.isDirectory(), `${repositoryPath} does not exist`);
    requireEvidence(fs.statSync(path.join(repositoryPath, "pom.xml"), { throwIfNoEntry: false })?.isFile(), `${entry.name} is not a root Maven project`);
    return { name: entry.name, path: repositoryPath };
  });
}

function sourceCanaries(repositories) {
  const canaries = {};
  for (const repository of repositories) {
    const javaFiles = runGit(repository.path, ["ls-files", "--", "*.java"])
      .split(/\r?\n/)
      .filter(Boolean);
    requireEvidence(javaFiles.length > 0, `${repository.name} has no tracked Java source`);
    for (const relativePath of ["pom.xml", javaFiles[0]]) {
      const normalizedPath = relativePath.replaceAll("\\", "/");
      const content = fs.readFileSync(path.join(repository.path, ...normalizedPath.split("/")));
      canaries[`${repository.name}/${normalizedPath}`] = crypto.createHash("sha256").update(content).digest("hex");
    }
  }
  return canaries;
}

function trackedChanges(repositories) {
  return repositories.flatMap((repository) => {
    const status = runGit(repository.path, ["status", "--porcelain", "--untracked-files=no"]);
    return status ? [{ repository: repository.name, status }] : [];
  });
}

function compactHost(run = {}) {
  return {
    sessionId: run.session?.sessionId ?? null,
    durationMs: run.durationMs ?? null,
    stopReason: run.promptResult?.stopReason ?? null,
    userPrompts: run.userPrompts ?? [],
    promptStopReasons: (run.promptResults ?? []).map((result) => result?.stopReason ?? null),
    hostErrors: run.hostErrors ?? [],
    permissionRequestCount: run.permissionRequests?.length ?? 0,
    permissionResponseCount: run.permissionResponses?.length ?? 0,
    elicitationRequestCount: run.elicitationRequests?.length ?? 0,
    elicitationResponses: run.elicitationResponses ?? [],
    toolCalls: (run.toolCalls ?? []).map((toolCall) => ({
      toolCallId: toolCall.toolCallId ?? null,
      title: toolCall.title ?? null,
      kind: toolCall.kind ?? null,
      status: toolCall.status ?? null,
      agentType: toolCall.rawInput?.agent_type ?? null,
      promptIndex: toolCall.promptIndex ?? null,
      sequence: toolCall.sequence ?? null,
    })),
    agentTextTail: String(run.agentText ?? "").slice(-4_000),
    stderrTail: String(run.stderr ?? "").slice(-2_000),
  };
}

function appcatReportPath(workspacePath, runId) {
  return path.join(
    workspacePath,
    ".github",
    "modernize",
    ".memory",
    "runs",
    runId,
    "appcat",
    "report.json",
  );
}

export function validateAssessmentReportSet({
  workspacePath,
  resultPath,
  expectedDomains = ["cloud-readiness"],
} = {}) {
  const result = readJson(resultPath, "attempt result");
  requireEvidence(
    ["completed", "completed_with_issues"].includes(result.status),
    `Assessment result is not usable: ${result.status}`,
  );
  requireEvidence(result.evidence?.artifactValidation === "passed", "Assessment artifact validation did not pass");

  const compatibilityPath = path.resolve(result.artifacts?.report ?? "");
  const htmlPath = path.resolve(result.artifacts?.html ?? "");
  requireEvidence(fs.statSync(compatibilityPath, { throwIfNoEntry: false })?.isFile(), "Compatibility report is missing");
  requireEvidence(fs.statSync(htmlPath, { throwIfNoEntry: false })?.isFile(), "HTML report is missing");

  const report = readJson(compatibilityPath, "compatibility report");
  requireEvidence(report.version === "1.1.0", `Unexpected compatibility report version: ${report.version}`);
  requireEvidence(report.metadata?.status === "completed", "Compatibility report metadata is not completed");
  requireEvidence(typeof report.metadata?.runId === "string" && report.metadata.runId, "Compatibility report runId is missing");
  requireEvidence(report.metadata.language === "java", `Unexpected report language: ${report.metadata.language}`);
  for (const domain of expectedDomains) {
    requireEvidence(report.metadata.domains?.includes(domain), `Compatibility report omits domain ${domain}`);
  }
  for (const field of ["categories", "findings", "security"]) {
    requireEvidence(Array.isArray(report[field]), `Compatibility report ${field} is not an array`);
  }
  for (const field of ["totalFindings", "totalActionableFindings", "totalTrackedFindings"]) {
    requireEvidence(Number.isInteger(report.metadata[field]) && report.metadata[field] >= 0, `Compatibility report ${field} is invalid`);
  }
  requireEvidence(report.metadata.totalFindings === report.findings.length, "Compatibility finding count does not match findings[]");

  const html = fs.readFileSync(htmlPath, "utf8");
  requireEvidence(Buffer.byteLength(html) > 10_000, "HTML report is too small to contain the complete payload");
  requireEvidence(/<script type="application\/json" id="report-data">\{/.test(html), "HTML report has no embedded report payload");
  requireEvidence(!/\{\{[A-Z0-9_]+\}\}/.test(html), "HTML report contains unresolved template placeholders");

  const appcatPath = result.artifacts?.appcat
    ? path.resolve(result.artifacts.appcat)
    : appcatReportPath(path.resolve(workspacePath), report.metadata.runId);
  requireEvidence(fs.statSync(appcatPath, { throwIfNoEntry: false })?.isFile(), "Selected AppCAT domain has no AppCAT report");
  const appcatReport = readJson(appcatPath, "AppCAT report");
  requireEvidence(appcatReport && typeof appcatReport === "object", "AppCAT report is not structured JSON");

  return {
    status: "complete",
    assessmentStatus: result.status,
    runId: report.metadata.runId,
    totals: {
      findings: report.metadata.totalFindings,
      actionable: report.metadata.totalActionableFindings,
      tracked: report.metadata.totalTrackedFindings,
      categories: report.categories.length,
      security: report.security.length,
    },
    compatibility: fileEvidence(compatibilityPath),
    html: fileEvidence(htmlPath),
    appcat: fileEvidence(appcatPath),
  };
}

function productPrompt(configPath) {
  return `Run an explicit Batch Assessment using repos.json at ${configPath} for both repositories. `
    + "Select cloud-readiness, issue-only coverage, and maxConcurrency 1. Show the Review and ask for "
    + "Start batch or Cancel. This prompt supplies decisions but is not approval; only a later structured "
    + "choice or a fresh user turn whose entire content is exactly Start batch is authoritative.";
}

function errorText(error) {
  return String(error?.stack ?? error?.message ?? error).slice(-8_000);
}

export async function runRealRepositoryE2E({
  launchRoot,
  configPath,
  outputPath = path.join(launchRoot, "real-repository-e2e.json"),
  model = "auto",
  copilotPath,
  timeoutMs = 90 * 60 * 1000,
} = {}) {
  const resolvedLaunchRoot = path.resolve(launchRoot);
  const resolvedConfigPath = path.resolve(configPath);
  const repositories = repositoryConfig(resolvedConfigPath);
  const initialTrackedChanges = trackedChanges(repositories);
  requireEvidence(initialTrackedChanges.length === 0, `Repositories have tracked changes: ${JSON.stringify(initialTrackedChanges)}`);
  const fixture = {
    launchRoot: resolvedLaunchRoot,
    configPath: resolvedConfigPath,
    repositories,
    canaries: sourceCanaries(repositories),
  };
  const previousBatchRoots = listBatchRoots(resolvedLaunchRoot);
  const evidence = {
    schemaVersion: 1,
    status: "running",
    scenario: "batch-assessment-real-repository-product-host-e2e",
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    nodeVersion: process.version,
    model,
    productPackage: validateProductPackage(),
    launchRoot: resolvedLaunchRoot,
    configPath: resolvedConfigPath,
    repositories: repositories.map((repository) => repository.name),
  };
  atomicWriteJson(outputPath, evidence);

  try {
    const run = await invokeProductAgentAcp({
      workspacePath: resolvedLaunchRoot,
      prompt: productPrompt(resolvedConfigPath),
      followUpPrompts: ["Start batch"],
      model,
      copilotPath,
      timeoutMs,
      elicitationHandler: (params) => acceptFormElicitation(params, "Start batch"),
      allowAllTools: true,
    });
    evidence.host = compactHost(run);
    const blockerCode = classifyProductHostBlocker(run.hostErrors);
    if (blockerCode) {
      evidence.status = "blocked";
      evidence.blocker = { code: blockerCode, hostErrors: run.hostErrors };
    } else {
      const batchRoot = discoverNewBatchRoot(resolvedLaunchRoot, previousBatchRoots);
      const approvalMode = run.elicitationResponses.length > 0 ? "structured" : "explicit-follow-up";
      const validation = validateCompletedProductRun({ fixture, batchRoot, acpRun: run, approvalMode });
      const reportCompleteness = validation.attempts.map((attempt) => {
        const request = readJson(attempt.request.path, `${attempt.executionUnitId} request`);
        requireEvidence(attempt.result?.path, `${attempt.executionUnitId} has no result artifact`);
        return {
          repository: attempt.repoId,
          executionUnitId: attempt.executionUnitId,
          ...validateAssessmentReportSet({
            workspacePath: request.workspacePath,
            resultPath: attempt.result.path,
            expectedDomains: request.decisions.domains,
          }),
        };
      });
      const finalTrackedChanges = trackedChanges(repositories);
      requireEvidence(finalTrackedChanges.length === 0, `Assessment changed tracked files: ${JSON.stringify(finalTrackedChanges)}`);
      evidence.status = "passed";
      evidence.batchRoot = batchRoot;
      evidence.validation = validation;
      evidence.reportCompleteness = reportCompleteness;
      evidence.trackedFilesUnchanged = true;
    }
  } catch (error) {
    const host = error.acpEvidence;
    const blockerCode = classifyProductHostBlocker(host?.hostErrors ?? []);
    evidence.host = host ? compactHost(host) : evidence.host;
    if (blockerCode) {
      evidence.status = "blocked";
      evidence.blocker = { code: blockerCode, hostErrors: host.hostErrors };
    } else {
      evidence.status = "failed";
      evidence.error = errorText(error);
    }
  }
  evidence.completedAt = new Date().toISOString();
  atomicWriteJson(outputPath, evidence);
  return evidence;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const launchRoot = optionValue("--launch-root");
  const configPath = optionValue("--config");
  if (!launchRoot || !configPath) {
    console.error("Usage: real-repository-runner.mjs --launch-root <path> --config <repos.json> [--output <path>] [--model auto]");
    process.exitCode = 1;
  } else {
    const outputPath = path.resolve(optionValue("--output") ?? path.join(launchRoot, "real-repository-e2e.json"));
    const evidence = await runRealRepositoryE2E({
      launchRoot,
      configPath,
      outputPath,
      model: optionValue("--model") ?? "auto",
      copilotPath: optionValue("--copilot"),
    });
    console.log(JSON.stringify({ status: evidence.status, outputPath }));
    if (evidence.status === "failed") process.exitCode = 1;
    if (evidence.status === "blocked") process.exitCode = 2;
  }
}
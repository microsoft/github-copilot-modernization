import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ALLOWED_ROUTER_TOOLS = new Set(["agent", "ask_user", "askuser", "sql", "task", "todo"]);
const ALLOWED_ROUTER_AGENTS = new Set([
  "assessment-coordinator",
  "planning-coordinator",
  "execution-coordinator",
]);
// BEGIN PLATFORM GUARD EXTENSION CONSTANTS (plugin)
const BATCH_AGENT_SUFFIXES = ["batch-mode-probe", "batch-review", "batch-coordinator"];
for (const agentName of BATCH_AGENT_SUFFIXES) {
  ALLOWED_ROUTER_AGENTS.add(agentName);
}
const STRUCTURED_APPROVAL = '{"mode":"structured","value":"Start batch","accepted":true}';
const FOLLOW_UP_APPROVAL = '{"mode":"explicit-follow-up","value":"Start batch","entireUserTurn":"Start batch","immediatelyAfterReview":true}';
const WORKSPACE_MODE_CHOICES = new Set([
  "Process repositories from repos.json",
  "Only process the current repository",
]);
// END PLATFORM GUARD EXTENSION CONSTANTS
const ASSESSMENT_COVERAGE = new Set(["issue-only", "full"]);
const ASSESSMENT_COVERAGE_SOURCES = new Set(["default", "explicit-user"]);
const TOOL_NAME_ALIASES = new Map([
  ["runsubagent", "agent"],
  ["manage_todo_list", "todo"],
  ["managetodolist", "todo"],
  ["vscode_askquestions", "ask_user"],
]);

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function decision(permissionDecision, permissionDecisionReason = undefined, updatedInput = undefined) {
  const hookSpecificOutput = {
    hookEventName: "PreToolUse",
    permissionDecision,
  };
  if (permissionDecisionReason) {
    hookSpecificOutput.permissionDecisionReason = permissionDecisionReason;
  }
  if (updatedInput) {
    hookSpecificOutput.updatedInput = updatedInput;
  }
  return { hookSpecificOutput };
}

function nativePreToolUseResult(result) {
  const output = result?.hookSpecificOutput;
  if (!output) return {};
  if (output.permissionDecision === "deny") {
    return {
      permissionDecision: "deny",
      permissionDecisionReason: output.permissionDecisionReason,
    };
  }
  if (output.updatedInput) {
    return {
      permissionDecision: output.permissionDecision,
      modifiedArgs: output.updatedInput,
    };
  }
  return {};
}

function nativePostToolUseResult(result) {
  const additionalContext = result?.hookSpecificOutput?.additionalContext;
  return typeof additionalContext === "string" && additionalContext
    ? { additionalContext }
    : {};
}

// BEGIN PLATFORM GUARD EXTENSION OUTPUT (plugin)
function postToolResult(additionalContext, block = false) {
  const result = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext,
    },
  };
  if (block) {
    result.decision = "block";
    result.reason = additionalContext;
  }
  return result;
}
// END PLATFORM GUARD EXTENSION OUTPUT

function normalizedAgentName(toolInput) {
  return String(
    toolInput.agent_type
      ?? toolInput.agentType
      ?? toolInput.subagent_type
      ?? toolInput.subagentType
      ?? toolInput.agent_name
      ?? toolInput.agentName
      ?? toolInput.agent
      ?? "",
  ).toLowerCase();
}

function normalizedToolName(value) {
  const name = String(value ?? "").toLowerCase();
  return TOOL_NAME_ALIASES.get(name) ?? name;
}

// BEGIN PLATFORM GUARD EXTENSION PROBE (plugin)
function defaultConfigProbe(input) {
  const launchRoot = input.cwd ?? input.working_directory ?? input.workingDirectory;
  if (typeof launchRoot !== "string" || !path.isAbsolute(launchRoot)) {
    throw new Error("the hook received no absolute launch root");
  }
  const resolvedLaunchRoot = path.resolve(launchRoot);
  const launchStat = fs.statSync(resolvedLaunchRoot, { throwIfNoEntry: false });
  if (!launchStat?.isDirectory()) {
    throw new Error("the launch root is not an existing directory");
  }
  const configPath = path.join(resolvedLaunchRoot, ".github", "modernize", "repos.json");
  const configStat = fs.statSync(configPath, { throwIfNoEntry: false });
  return {
    schemaVersion: 1,
    launchRoot: resolvedLaunchRoot,
    configPath,
    status: configStat?.isFile() ? "found" : configStat ? "invalid" : "absent",
  };
}

function findProbeResult(value) {
  const queue = [value];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current && typeof current === "object") {
      if (visited.has(current)) continue;
      visited.add(current);
      if (Object.hasOwn(current, "schemaVersion")
        && Object.hasOwn(current, "launchRoot")
        && Object.hasOwn(current, "configPath")
        && Object.hasOwn(current, "status")) {
        return current;
      }
      queue.push(...Object.values(current));
      continue;
    }
    if (typeof current !== "string") continue;
    try {
      const parsed = JSON.parse(current);
      if (parsed !== current) queue.push(parsed);
    } catch {}
    for (const candidate of current.match(/\{[^{}\r\n]*\}/g) ?? []) {
      try {
        queue.push(JSON.parse(candidate));
      } catch {}
    }
  }
  return null;
}

function comparablePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) return null;
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameProbeResult(actual, expected) {
  return actual?.schemaVersion === expected.schemaVersion
    && comparablePath(actual.launchRoot) === comparablePath(expected.launchRoot)
    && comparablePath(actual.configPath) === comparablePath(expected.configPath)
    && actual.status === expected.status;
}

function isWorkspaceModeQuestion(toolInput) {
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
  const labels = questions.flatMap((question) =>
    (Array.isArray(question?.options) ? question.options : [])
      .map((option) => String(option?.label ?? option?.value ?? option)));
  return labels.length === WORKSPACE_MODE_CHOICES.size
    && labels.every((label) => WORKSPACE_MODE_CHOICES.has(label));
}

function evaluateWorkspaceModeQuestion(input, toolInput) {
  if (!isWorkspaceModeQuestion(toolInput)) return null;
  let probe;
  try {
    probe = defaultConfigProbe(input);
  } catch (error) {
    return decision(
      "deny",
      `Workspace Mode cannot be verified because ${error.message}. Do not ask this question; stop with a compact probe error.`,
    );
  }
  if (probe.status === "absent") {
    return decision(
      "deny",
      `Workspace Mode is not applicable because the default config is absent at ${probe.configPath}. Treat the probe as status absent and resume the original request through the absent-config routing rules without asking this question.`,
    );
  }
  if (probe.status === "invalid") {
    return decision(
      "deny",
      `The default Batch config path is invalid because it is not a file: ${probe.configPath}. Stop with a compact configuration error.`,
    );
  }
  return null;
}
// END PLATFORM GUARD EXTENSION PROBE

function targets(agentName, suffix) {
  return agentName === suffix || agentName.endsWith(`:${suffix}`);
}

function targetsProductAgent(agentName, suffix) {
  return agentName === `github-copilot-modernization:${suffix}`;
}

// BEGIN PLATFORM GUARD EXTENSION APPROVAL (plugin)
function hasHandoffField(prompt, field) {
  const name = field.slice(0, -1);
  return prompt.includes(field) || new RegExp(`"${name}"\\s*:`).test(prompt);
}

function hasApprovedReviewHandoff(prompt) {
  const requiredFields = [
    "BATCH_REVIEW_READY",
    "batchRoot:",
    "reviewPath:",
    "reviewMarkdownPath:",
    "reviewSha256:",
    "reviewMarkdownSha256:",
    "inspectedReposPath:",
    "inspectedReposSha256:",
    "batchAttemptScriptPath:",
    "configSha256:",
    "selectedExecutionUnitIds:",
    "approvedNeedsAttention:",
    "effectiveAssessments:",
    "blockedExecutionUnits:",
    "analysisCoverage:",
    "maxConcurrency:",
  ];
  const hasApproval = prompt.includes(STRUCTURED_APPROVAL) || prompt.includes(FOLLOW_UP_APPROVAL);
  return hasApproval
    && prompt.includes("BATCH_REVIEW_READY")
    && requiredFields.slice(1).every((field) => hasHandoffField(prompt, field));
}

function topLevel(event) {
  return event?.agentId === undefined || event.agentId === null;
}
// END PLATFORM GUARD EXTENSION APPROVAL

function transcriptEvents(input) {
  const suppliedPath = input.transcript_path ?? input.transcriptPath;
  const sessionId = String(input.session_id ?? input.sessionId ?? "");
  const transcriptPath = suppliedPath || (/^[a-zA-Z0-9-]+$/.test(sessionId)
    ? path.join(os.homedir(), ".copilot", "session-state", sessionId, "events.jsonl")
    : "");
  if (!transcriptPath) {
    return [];
  }
  try {
    return fs.readFileSync(transcriptPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function assessmentPrompt(input) {
  const directPrompt = input.agent_prompt ?? input.agentPrompt ?? input.prompt;
  if (typeof directPrompt === "string" && directPrompt.trim()) {
    return directPrompt;
  }
  return String(
    transcriptEvents(input)
      .find((event) => event?.type === "user.message" && typeof event?.data?.content === "string")
      ?.data?.content ?? "",
  );
}

function assessmentConfig(prompt) {
  const text = String(prompt);
  const declarations = [...text.matchAll(/^(?:assessment-config|config):[^\r\n]*$/gmi)];
  if (declarations.length === 0) return { present: false, valid: true, value: {} };
  if (declarations.length !== 1) return { present: true, valid: false, value: {} };
  const match = declarations[0][0].match(/^(?:assessment-config|config):\s*(\{.*\})\s*$/i);
  if (!match) return { present: true, valid: false, value: {} };
  let value;
  try {
    value = JSON.parse(match[1]);
  } catch {
    return { present: true, valid: false, value: {} };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { present: true, valid: false, value: {} };
  }
  const coverage = value.analysisCoverage;
  return {
    present: true,
    valid: coverage === undefined || ASSESSMENT_COVERAGE.has(coverage),
    value,
  };
}

function commandText(toolInput) {
  for (const field of ["command", "script", "code"]) {
    if (typeof toolInput[field] === "string") {
      return toolInput[field];
    }
  }
  return "";
}

function assessmentCoverageArgument(command) {
  const containsCoverage = /(?:^|\s)--coverage(?:=|\s)/i.test(command);
  if (!containsCoverage) {
    return { valid: true, value: "issue-only" };
  }
  const matches = [...command.matchAll(
    /(?:^|\s)--coverage(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/gi,
  )];
  if (matches.length !== 1) {
    return { valid: false, value: null };
  }
  const value = String(matches[0][1] ?? matches[0][2] ?? matches[0][3]).toLowerCase();
  return { valid: ASSESSMENT_COVERAGE.has(value), value };
}

function assessmentCoverageSourceArgument(command) {
  const matches = [...command.matchAll(
    /(?:^|\s)--coverage-source(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/gi,
  )];
  if (matches.length !== 1) {
    return { valid: false, value: null };
  }
  const value = String(matches[0][1] ?? matches[0][2] ?? matches[0][3]).toLowerCase();
  return { valid: ASSESSMENT_COVERAGE_SOURCES.has(value), value };
}

// BEGIN PLATFORM GUARD EXTENSION FALLBACK (plugin)
function normalizeFallbackCoordinatorInput(input, toolInput) {
  const events = transcriptEvents(input);
  let approvalIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "user.message" && topLevel(event)) {
      const content = String(event?.data?.content ?? "").trim();
      if (content === "Start batch") {
        approvalIndex = index;
      }
      break;
    }
  }
  if (approvalIndex < 0) {
    return null;
  }

  let reviewIndex = -1;
  let reviewResult = "";
  for (let index = approvalIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    const content = String(event?.data?.result?.content ?? "");
    if (event?.type === "tool.execution_complete" && topLevel(event) && content.includes("BATCH_REVIEW_READY")) {
      reviewIndex = index;
      reviewResult = content;
      break;
    }
  }
  if (reviewIndex < 0) {
    return null;
  }

  let selectionIndex = -1;
  for (let index = reviewIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "user.message"
      && topLevel(event)
      && String(event?.data?.content ?? "").trim() === "Process repositories from repos.json") {
      selectionIndex = index;
      break;
    }
  }
  if (selectionIndex < 0) {
    return null;
  }

  const originalRequest = events
    .slice(0, selectionIndex)
    .findLast((event) => event?.type === "user.message" && topLevel(event) && typeof event?.data?.content === "string")
    ?.data?.content;
  const launchRoot = input.cwd ?? input.working_directory ?? input.workingDirectory;
  if (typeof originalRequest !== "string" || typeof launchRoot !== "string" || !path.isAbsolute(launchRoot)) {
    return null;
  }

  const scopeEvidence = JSON.stringify({
    mode: "explicit-follow-up",
    value: "Process repositories from repos.json",
    configPath: path.join(launchRoot, ".github", "modernize", "repos.json"),
  });
  const prompt = [
    `launch-root: ${launchRoot}`,
    `user-request: ${JSON.stringify(originalRequest)}`,
    `scope-evidence: ${scopeEvidence}`,
    "batch-review-handoff:",
    reviewResult,
    `approval-evidence: ${FOLLOW_UP_APPROVAL}`,
  ].join("\n");
  return { ...toolInput, prompt };
}
// END PLATFORM GUARD EXTENSION FALLBACK

function serializedToolInput(toolInput) {
  try {
    return JSON.stringify(toolInput)
      .replaceAll("\\\\", "\\")
      .replaceAll("/", "\\")
      .toLowerCase();
  } catch {
    return "";
  }
}

function evaluateProductBoundary(toolName, toolInput) {
  if (toolName.includes("appmod-run-assessment-action")
    || toolName.includes("appmod-run-assessment-report")) {
    return decision(
      "deny",
      "Assessment MCP tools are forbidden. Use the native Assessment workflow through the required coordinator.",
    );
  }

  // BEGIN PLATFORM GUARD EXTENSION PRODUCT BOUNDARY (plugin)
const serialized = serializedToolInput(toolInput);
  const readsConfiguration = /(?:^|\\)\.github\\modernize\\repos\.json/.test(serialized);
  if (readsConfiguration && ["view", "read", "grep", "search"].includes(toolName)) {
    return decision(
      "deny",
      "Do not read repos.json directly. Delegate the pending Batch selection to github-copilot-modernization:batch-review.",
    );
  }

  const readsReview = serialized.includes("\\.github\\modernize\\batches\\")
    && (serialized.includes("\\review.json") || serialized.includes("\\review.md"));
  if (readsReview && ["view", "read", "grep", "search"].includes(toolName)) {
    return decision(
      "deny",
      "Do not re-read or rewrite a completed Batch Review. Present the batch-review response unchanged and use only Start batch or Cancel.",
    );
  }

  const writesFiles = ["create", "edit", "apply_patch", "write"].includes(toolName);
  const writesWorkaround = serialized.includes("\\.copilot\\batch-review")
    || serialized.includes("\\.github\\modernize\\batch-report.json");
  if (writesFiles && writesWorkaround) {
    return decision(
      "deny",
      "Manual Batch Review and aggregate artifacts are forbidden. Use batch-review and the deterministic Batch control plane.",
    );
  }

  const terminalTool = ["powershell", "bash", "execute", "runinterminal"].includes(toolName);
  if (terminalTool && serialized.includes("\\.copilot\\batch-review")) {
    return decision(
      "deny",
      "The .copilot/batch-review workaround is forbidden. Invoke github-copilot-modernization:batch-review.",
    );
  }
// END PLATFORM GUARD EXTENSION PRODUCT BOUNDARY
  return null;
}

// BEGIN PLATFORM GUARD EXTENSION SCOPED GUARDS (plugin)
function evaluateReviewTool(toolName, toolInput) {
  if (toolName === "skill") {
    return decision("allow");
  }
  const terminalTool = ["powershell", "bash", "execute", "runinterminal"].includes(toolName);
  const serialized = serializedToolInput(toolInput);
  if (terminalTool && serialized.includes("\\skills\\batch-modernization\\scripts\\prepare-review.mjs")) {
    return decision("allow");
  }
  return decision(
    "deny",
    "batch-review may only load its skill and run that skill's deterministic prepare-review.mjs.",
  );
}

function evaluateCoordinatorTool(toolName, toolInput) {
  if (toolName === "skill" || toolName === "todo") {
    return decision("allow");
  }
  if (toolName === "agent" || toolName === "task") {
    return targets(normalizedAgentName(toolInput), "batch-assessment")
      ? decision("allow")
      : decision("deny", "batch-coordinator may delegate only to github-copilot-modernization:batch-assessment.");
  }
  const terminalTool = ["powershell", "bash", "execute", "runinterminal"].includes(toolName);
  if (terminalTool) {
    const serialized = serializedToolInput(toolInput);
    const simulatesPhaseResult = serialized.includes("outcome.json")
      || serialized.includes("artifactsdir")
      || serialized.includes("assessment completed (simulated)")
      || /batch-attempt\.mjs["']?\s+publish\b/.test(serialized);
    return simulatesPhaseResult
      ? decision("deny", "batch-coordinator must never create or publish a phase outcome. Commit the single batch-assessment result as-is; missing output is ProtocolError.")
      : decision("allow");
  }
  return decision("deny", "batch-coordinator is limited to its skill, exact phase-agent dispatch, and deterministic control-plane commands.");
}
// END PLATFORM GUARD EXTENSION SCOPED GUARDS

function evaluateAssessmentTool(input, toolName, toolInput) {
  if (toolName !== "agent" && toolName !== "task") {
    const terminalTool = ["powershell", "bash", "execute", "runinterminal"].includes(toolName);
    const command = commandText(toolInput);
    const prompt = assessmentPrompt(input);
    let skipCoverageValidation = false;
    // BEGIN PLATFORM GUARD EXTENSION ASSESSMENT (plugin)
skipCoverageValidation = /(?:^|\s)--attempt-scratch-root(?:=|\s)/i.test(command)
      && /\bbatch-headless\b|\brequest\.json\b/i.test(prompt);
// END PLATFORM GUARD EXTENSION ASSESSMENT
    if (terminalTool
      && /(?:^|\s)prepare-run(?:\s|$)/i.test(command)
      && !skipCoverageValidation) {
      const config = assessmentConfig(prompt);
      const requested = assessmentCoverageArgument(command);
      const requestedSource = assessmentCoverageSourceArgument(command);
      if (!config.valid) {
        return decision(
          "deny",
          "Assessment config must be one single-line JSON object with analysisCoverage set only to issue-only or full.",
        );
      }
      if (!requested.valid) {
        return decision(
          "deny",
          "prepare-run must use one literal --coverage value: issue-only or full.",
        );
      }
      if (!requestedSource.valid) {
        return decision(
          "deny",
          "Single prepare-run must use one literal --coverage-source value: default or explicit-user.",
        );
      }
      const expected = config.value.analysisCoverage ?? "issue-only";
      const expectedSource = Object.hasOwn(config.value, "analysisCoverage")
        ? "explicit-user"
        : "default";
      if (requested.value !== expected) {
        return decision(
          "deny",
          `Assessment coverage must match the explicit assessment-config handoff; expected ${expected}.`,
        );
      }
      if (requestedSource.value !== expectedSource) {
        return decision(
          "deny",
          `Assessment coverage source must match the explicit assessment-config handoff; expected ${expectedSource}.`,
        );
      }
    }
    return decision("allow");
  }
  return decision(
    "deny",
    "the Assessment phase agent has no subagent capability and must execute catalog skills itself.",
  );
}

export function evaluateModernizeTool(payload, { scope = "inline" } = {}) {
  const input = parseObject(payload);
  const nativeToolCall = Array.isArray(input.toolCalls) && input.toolCalls.length === 1
    ? parseObject(input.toolCalls[0])
    : {};
  const toolName = normalizedToolName(
    input.tool_name ?? input.toolName ?? input.name ?? nativeToolCall.name ?? "",
  );
  if (!toolName) {
    return decision("allow");
  }

  const toolInput = parseObject(
    input.tool_input
      ?? input.toolInput
      ?? input.toolArgs
      ?? input.input
      ?? input.arguments
      ?? input.args
      ?? nativeToolCall.args,
  );
  const productBoundary = evaluateProductBoundary(toolName, toolInput);
  if (productBoundary) {
    return productBoundary;
  }

  // BEGIN PLATFORM GUARD EXTENSION SCOPES (plugin)
if (scope === "review") {
    return evaluateReviewTool(toolName, toolInput);
  }
  if (scope === "coordinator") {
    return evaluateCoordinatorTool(toolName, toolInput);
  }
// END PLATFORM GUARD EXTENSION SCOPES
  if (scope === "assessment") {
    return evaluateAssessmentTool(input, toolName, toolInput);
  }

  if (scope === "inline" && !ALLOWED_ROUTER_TOOLS.has(toolName)) {
    return decision(
      "deny",
      "modernize is a router and cannot read, write, search, browse, or execute commands directly; delegate to the required coordinator.",
    );
  }

  // BEGIN PLATFORM GUARD EXTENSION QUESTION (plugin)
if (scope === "inline" && (toolName === "ask_user" || toolName === "askuser")) {
    const workspaceModeDecision = evaluateWorkspaceModeQuestion(input, toolInput);
    if (workspaceModeDecision) return workspaceModeDecision;
  }
// END PLATFORM GUARD EXTENSION QUESTION

  if (toolName !== "agent" && toolName !== "task") {
    return decision("allow");
  }

  const agentName = normalizedAgentName(toolInput);
  let prompt = String(toolInput.prompt ?? toolInput.task ?? toolInput.description ?? "");
  let updatedInput;

  if (scope === "inline"
    && ![...ALLOWED_ROUTER_AGENTS].some((allowedAgent) => targets(agentName, allowedAgent))) {
    return decision(
      "deny",
      "modernize can delegate only to phase coordinators; execution workers must be invoked by execution-coordinator.",
    );
  }

  if (scope === "inline" && targets(agentName, "assessment-coordinator")) {
    const config = assessmentConfig(prompt);
    if (!config.valid) {
      return decision(
        "deny",
        "assessment-coordinator requires exactly one single-line JSON config object; analysisCoverage may be only issue-only or full.",
      );
    }
    if (!config.present) {
      prompt = `${prompt.trimEnd()}\nconfig: {}`;
      updatedInput = { ...toolInput, prompt };
    }
  }

  // BEGIN PLATFORM GUARD EXTENSION DELEGATION (plugin)
if (targets(agentName, "batch-coordinator")) {
    const normalizedInput = normalizeFallbackCoordinatorInput(input, toolInput);
    if (normalizedInput && hasApprovedReviewHandoff(normalizedInput.prompt)) {
      return decision("allow", undefined, normalizedInput);
    }
    if (!hasApprovedReviewHandoff(prompt)) {
      return decision(
        "deny",
        "batch-coordinator requires the complete BATCH_REVIEW_READY handoff and one exact approval-evidence JSON object. Preserve every handoff field in its line format or as a lossless JSON object. Do not rerun or repair the Review; use the Review already returned in the immediately preceding turn or stop.",
      );
    }
  }

  const batchIntent = /\bbatch\b|repos\.json|multiple repositories|process repositories/i.test(prompt);
  const targetsBatchAgent = BATCH_AGENT_SUFFIXES.some((suffix) => targets(agentName, suffix));
  if (scope === "inline" && batchIntent && !targetsBatchAgent) {
    return decision(
      "deny",
      "Batch scope can be delegated only to batch-mode-probe, batch-review, or an approved batch-coordinator invocation.",
    );
  }
// END PLATFORM GUARD EXTENSION DELEGATION

  return decision("allow", undefined, updatedInput);
}

export function evaluateCliGlobalTool(payload) {
  const input = parseObject(payload);
  const toolName = normalizedToolName(input.toolName ?? input.tool_name ?? input.name ?? "");
  const toolInput = parseObject(
    input.toolArgs
      ?? input.tool_input
      ?? input.toolInput
      ?? input.input
      ?? input.arguments
      ?? input.args,
  );
  if (toolName !== "agent" && toolName !== "task") {
    return {};
  }

  const agentName = normalizedAgentName(toolInput);
  const prompt = String(toolInput.prompt ?? toolInput.task ?? toolInput.description ?? "");

  // BEGIN PLATFORM GUARD EXTENSION CLI GLOBAL (plugin)
if (targetsProductAgent(agentName, "batch-coordinator")) {
    if (!hasApprovedReviewHandoff(prompt)) {
      return nativePreToolUseResult(decision(
        "deny",
        "batch-coordinator requires the complete BATCH_REVIEW_READY handoff and one exact approval-evidence JSON object. Preserve every handoff field and do not rerun or repair the Review.",
      ));
    }
    return {};
  }

  const batchIntent = /\bbatch\b|repos\.json|multiple repositories|process repositories/i.test(prompt);
  if (targetsProductAgent(agentName, "assessment-coordinator") && batchIntent) {
    return nativePreToolUseResult(decision(
      "deny",
      "Batch scope cannot be delegated to assessment-coordinator; use the Batch Review and approved batch-coordinator flow.",
    ));
  }
// END PLATFORM GUARD EXTENSION CLI GLOBAL

  if (!targetsProductAgent(agentName, "assessment-coordinator")) {
    return {};
  }

  const config = assessmentConfig(prompt);
  if (!config.valid) {
    return nativePreToolUseResult(decision(
      "deny",
      "assessment-coordinator requires exactly one single-line JSON config object; analysisCoverage may be only issue-only or full.",
    ));
  }
  if (!config.present) {
    return nativePreToolUseResult(decision(
      "allow",
      undefined,
      { ...toolInput, prompt: `${prompt.trimEnd()}\nconfig: {}` },
    ));
  }
  return {};
}

export function evaluateModernizePostTool(payload) {
  // BEGIN PLATFORM GUARD EXTENSION POST TOOL (plugin)
const input = parseObject(payload);
  const toolName = normalizedToolName(input.tool_name ?? input.toolName ?? input.name ?? "");
  const toolInput = parseObject(
    input.tool_input ?? input.toolInput ?? input.toolArgs ?? input.input ?? input.arguments,
  );
  if ((toolName !== "agent" && toolName !== "task")
    || !targetsProductAgent(normalizedAgentName(toolInput), "batch-mode-probe")) {
    return {};
  }

  let expected;
  try {
    expected = defaultConfigProbe(input);
  } catch (error) {
    return postToolResult(
      `BATCH_MODE_PROBE_FAILED: ${error.message}. Stop with a compact probe error.`,
      true,
    );
  }

  const authoritativeContext = `Authoritative batch-mode probe result: ${JSON.stringify(expected)}. Use this object unchanged for workspace-mode routing.`;
  const actual = findProbeResult(
    input.tool_response ?? input.toolResponse ?? input.toolResult ?? input.output,
  );
  if (!sameProbeResult(actual, expected)) {
    return postToolResult(
      `The raw batch-mode-probe response was superseded by the filesystem check. ${authoritativeContext} Treat the authoritative object as the successful probe result and continue without rerunning the probe.`,
    );
  }
  return postToolResult(authoritativeContext);
// END PLATFORM GUARD EXTENSION POST TOOL
  return {};
}

export function evaluateCliGlobalPostTool(payload) {
  return nativePostToolUseResult(evaluateModernizePostTool(payload));
}

function run() {
  let payload = {};
  try {
    payload = parseObject(fs.readFileSync(0, "utf8"));
  } catch {
    payload = {};
  }
  const cliGlobal = process.argv.includes("--cli-global");
  if (process.argv.includes("--post")) {
    const result = cliGlobal
      ? evaluateCliGlobalPostTool(payload)
      : evaluateModernizePostTool(payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (cliGlobal) {
    process.stdout.write(`${JSON.stringify(evaluateCliGlobalTool(payload))}\n`);
    return;
  }
  let scope = process.argv.includes("--assessment") ? "assessment" : "inline";
  // BEGIN PLATFORM GUARD EXTENSION RUN SCOPE (plugin)
if (process.argv.includes("--review")) {
    scope = "review";
  } else if (process.argv.includes("--coordinator")) {
    scope = "coordinator";
  }
// END PLATFORM GUARD EXTENSION RUN SCOPE
  process.stdout.write(`${JSON.stringify(evaluateModernizeTool(payload, { scope }))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}

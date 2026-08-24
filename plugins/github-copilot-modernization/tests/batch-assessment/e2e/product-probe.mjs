import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const stageRoot = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(stageRoot, "..", "..", "..");
export const productAgentName = "github-copilot-modernization:modernize";
const defaultEvidencePath = path.join(
  stageRoot,
  "evidence",
  `product-probe.${process.platform}-${process.arch}.json`,
);

const allAgentFiles = fs.readdirSync(path.join(pluginRoot, "agents"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))
  .map((entry) => `agents/${entry.name}`);
const allSkillFiles = fs.readdirSync(path.join(pluginRoot, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `skills/${entry.name}/SKILL.md`)
  .filter((relativePath) => fs.existsSync(path.join(pluginRoot, ...relativePath.split("/"))));

export const REQUIRED_PRODUCT_FILES = Object.freeze([...new Set([
  ".mcp.json",
  "plugin.json",
  "agents/modernize.agent.md",
  "agents/batch-mode-probe.agent.md",
  "agents/batch-review.agent.md",
  "agents/batch-coordinator.agent.md",
  "agents/batch-assessment.agent.md",
  "agents/hook/scripts/sendTelemetry.ps1",
  "agents/hook/scripts/sendTelemetry.sh",
  "hooks/hooks.json",
  "hooks/bootstrap-assessment.mjs",
  "skills/assessment/SKILL.md",
  "skills/assessment/scripts/assess-cli.mjs",
  "skills/assessment/scripts/assess-report.mjs",
  "skills/assessment/scripts/assess-runtime.mjs",
  "skills/assessment/scripts/assess-state.mjs",
  "skills/assessment/scripts/assessment-catalog.mjs",
  "skills/assessment/resources/solution-mapping.json",
  "skills/batch-modernization/SKILL.md",
  "skills/batch-modernization/references/phase-contract.md",
  "skills/batch-modernization/references/repos-json-compatibility.md",
  "skills/batch-modernization/schemas/aggregate-report.v1.json",
  "skills/batch-modernization/schemas/assessment-finalization.v1.json",
  "skills/batch-modernization/schemas/attempt-validation.v1.json",
  "skills/batch-modernization/schemas/compatibility-report.v1.json",
  "skills/batch-modernization/schemas/attempt-request.schema.json",
  "skills/batch-modernization/schemas/attempt-result.schema.json",
  "skills/batch-modernization/schemas/batch-state.schema.json",
  "skills/batch-modernization/schemas/event.schema.json",
  "skills/batch-modernization/schemas/execution-unit.schema.json",
  "skills/batch-modernization/schemas/needs-input.schema.json",
  "skills/batch-modernization/schemas/resolved-repos.schema.json",
  "skills/batch-modernization/scripts/batch-attempt.mjs",
  "skills/batch-modernization/scripts/batch-assessment-report.mjs",
  "skills/batch-modernization/scripts/batch-state.mjs",
  "skills/batch-modernization/scripts/inspect-workspaces.mjs",
  "skills/batch-modernization/scripts/probe-default-config.mjs",
  "skills/batch-modernization/scripts/prepare-review.mjs",
  "skills/batch-modernization/scripts/resolve-repos.mjs",
  "skills/batch-modernization/scripts/schema-validator.mjs",
  "skills/batch-modernization/scripts/validate-result.mjs",
  ...allAgentFiles,
  ...allSkillFiles,
])].sort());

function frontmatterValue(content, name) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  return frontmatter.match(new RegExp(`^${name}:\\s*['\"]?([^'\"\\r\\n]+)['\"]?$`, "m"))?.[1];
}

function packageDigest(root, files) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update("\0");
    const content = fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf8");
    hash.update(content.replace(/\r\n/g, "\n"), "utf8");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr ?? "").trim()}`);
  }
}

function initializeFixtureRepository(repositoryPath, name, { blockAssessmentBootstrap = false } = {}) {
  fs.mkdirSync(path.join(repositoryPath, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(repositoryPath, "package.json"),
    `${JSON.stringify({ name, version: "1.0.0", private: true }, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(repositoryPath, "src", "index.js"),
    `export const repositoryName = ${JSON.stringify(name)};\n`,
    "utf8",
  );
  if (blockAssessmentBootstrap) {
    const modernizePath = path.join(repositoryPath, ".github", "modernize");
    fs.mkdirSync(modernizePath, { recursive: true });
    fs.writeFileSync(path.join(modernizePath, ".runtime"), "blocks only the Assessment runtime directory\n", "utf8");
  }
  runGit(["init"], repositoryPath);
  runGit(["config", "user.name", "Batch Product Probe"], repositoryPath);
  runGit(["config", "user.email", "batch-probe@example.invalid"], repositoryPath);
  runGit([
    "add",
    "package.json",
    "src/index.js",
    ...(blockAssessmentBootstrap ? [".github/modernize/.runtime"] : []),
  ], repositoryPath);
  runGit(["commit", "-m", "Initialize product probe fixture"], repositoryPath);
}

export function createProductFixture(rootPath, { bootstrapFailureRepository } = {}) {
  const launchRoot = rootPath
    ? path.resolve(rootPath)
    : fs.mkdtempSync(path.join(os.tmpdir(), "batch-assessment-product-"));
  if (fs.existsSync(launchRoot) && fs.readdirSync(launchRoot).length > 0) {
    throw new Error(`Product probe workspace must be empty: ${launchRoot}`);
  }
  fs.mkdirSync(launchRoot, { recursive: true });
  const repositories = ["alpha-service", "beta-service"].map((name) => {
    const repositoryPath = path.join(launchRoot, "repos", name);
    initializeFixtureRepository(repositoryPath, name, {
      blockAssessmentBootstrap: name === bootstrapFailureRepository,
    });
    return { name, path: repositoryPath };
  });
  const configPath = path.join(launchRoot, ".github", "modernize", "repos.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({ repos: repositories }, null, 2)}\n`, "utf8");

  const canaries = Object.fromEntries(repositories.flatMap((repository) => {
    const relativePaths = ["package.json", "src/index.js"];
    if (repository.name === bootstrapFailureRepository) relativePaths.push(".github/modernize/.runtime");
    return relativePaths.map((relativePath) => [
      `${repository.name}/${relativePath}`,
      fileSha256(path.join(repository.path, ...relativePath.split("/"))),
    ]);
  }));
  const fixture = {
    launchRoot,
    configPath,
    variant: bootstrapFailureRepository ? "bootstrap-failure" : "success",
    bootstrapFailureRepository: bootstrapFailureRepository ?? null,
    repositories,
    canaries,
  };
  fs.writeFileSync(
    path.join(launchRoot, "product-probe-fixture.json"),
    `${JSON.stringify(fixture, null, 2)}\n`,
    "utf8",
  );
  return fixture;
}

export function verifySourceCanaries(fixture) {
  const actual = Object.fromEntries(Object.keys(fixture.canaries).map((canaryName) => {
    const [repositoryName, ...segments] = canaryName.split("/");
    const repository = fixture.repositories.find((candidate) => candidate.name === repositoryName);
    return [canaryName, repository && segments.length > 0
      ? fileSha256(path.join(repository.path, ...segments))
      : null];
  }));
  const changed = Object.keys(fixture.canaries).filter(
    (relativePath) => actual[relativePath] !== fixture.canaries[relativePath],
  );
  return { valid: changed.length === 0, changed, actual };
}

export function validateProductPackage(root = pluginRoot) {
  const missing = REQUIRED_PRODUCT_FILES.filter(
    (relativePath) => !fs.statSync(path.join(root, ...relativePath.split("/")), { throwIfNoEntry: false })?.isFile(),
  );
  if (missing.length > 0) {
    throw new Error(`Product package is missing required files: ${missing.join(", ")}`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
  if (manifest.name !== "github-copilot-modernization"
      || manifest.agents !== "agents/"
      || !manifest.skills?.includes("skills/")
      || manifest.hooks !== "hooks/hooks.json"
      || manifest.mcpServers !== ".mcp.json") {
    throw new Error("plugin.json does not expose the expected product surfaces");
  }

  for (const agentName of ["modernize", "batch-mode-probe", "batch-review", "batch-coordinator", "batch-assessment"]) {
    const agentPath = path.join(root, "agents", `${agentName}.agent.md`);
    const content = fs.readFileSync(agentPath, "utf8");
    if (frontmatterValue(content, "name") !== agentName) {
      throw new Error(`${agentName}.agent.md has an invalid frontmatter name`);
    }
  }

  const files = [...REQUIRED_PRODUCT_FILES];
  return {
    name: manifest.name,
    version: manifest.version,
    requiredFiles: files,
    sha256: packageDigest(root, files),
  };
}

export function parseJsonLines(output) {
  const events = [];
  for (const line of String(output ?? "").split(/\r?\n/).filter(Boolean)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // CLI warnings can precede JSONL events on stdout.
    }
  }
  return events;
}

function responseText(events) {
  return events
    .filter((event) => event.type === "assistant.message")
    .map((event) => event.data?.content ?? "")
    .join("\n")
    .trim();
}

function selectedModels(events) {
  return [...new Set(events
    .filter((event) => event.type === "model.call_start")
    .map((event) => event.data?.model)
    .filter(Boolean))];
}

function resolveCopilotBinary(explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  const names = process.platform === "win32"
    ? ["copilot.exe", "copilot.bat", "copilot.cmd", "copilot"]
    : ["copilot"];
  const entries = String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const entry of entries) {
      const candidate = path.join(entry, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Copilot CLI executable was not found on PATH; set COPILOT_CLI_PATH");
}

export function productInvocationArgs({
  workspacePath,
  prompt,
  model = "auto",
  resumeSessionId,
}) {
  const sessionArgs = resumeSessionId
    ? [`--resume=${resumeSessionId}`]
    : ["--agent=github-copilot-modernization:modernize"];
  return [
    "-C",
    workspacePath,
    "--plugin-dir",
    pluginRoot,
    ...sessionArgs,
    "--model",
    model,
    "--prompt",
    prompt,
    "--allow-all-tools",
    "--disable-builtin-mcps",
    "--no-custom-instructions",
    "--no-remote",
    "--no-remote-export",
    "--no-auto-update",
    "--no-color",
    "--output-format",
    "json",
  ];
}

export function productAcpInvocationArgs({
  workspacePath,
  model = "auto",
  agentName = productAgentName,
  allowAllTools = true,
} = {}) {
  return [
    "--acp",
    "-C",
    path.resolve(workspacePath),
    "--plugin-dir",
    pluginRoot,
    `--agent=${agentName}`,
    "--model",
    model,
    ...(allowAllTools ? ["--allow-all-tools"] : []),
    "--disable-builtin-mcps",
    "--no-custom-instructions",
    "--no-remote",
    "--no-remote-export",
    "--no-auto-update",
    "--no-color",
  ];
}

export function productAcpEnvironment(environment = process.env) {
  return { ...environment, NO_COLOR: "1", PLUGIN_ROOT: pluginRoot };
}

export async function submitAcpPrompts(connection, sessionId, userPrompts, { continueAfterPrompt } = {}) {
  if (!Array.isArray(userPrompts) || userPrompts.length === 0
      || userPrompts.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error("ACP prompt sequence requires one or more non-empty prompts");
  }
  const submittedPrompts = [];
  const promptResults = [];
  for (const [index, userPrompt] of userPrompts.entries()) {
    submittedPrompts.push(userPrompt);
    promptResults.push(await connection.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: userPrompt }],
    }));
    if (index < userPrompts.length - 1
        && continueAfterPrompt
        && !await continueAfterPrompt({ index, userPrompt, promptResult: promptResults.at(-1) })) {
      break;
    }
  }
  return {
    userPrompts: submittedPrompts,
    promptResults,
    promptResult: promptResults.at(-1),
  };
}

export async function ensureProductAgentSelected(connection, session, agentName = productAgentName) {
  const initialAgent = session.configOptions?.find((option) => option.id === "agent");
  const agentConfig = initialAgent?.currentValue === agentName
    ? { configOptions: session.configOptions }
    : await connection.request("session/set_config_option", {
      sessionId: session.sessionId,
      configId: "agent",
      value: agentName,
    });
  const selectedAgent = agentConfig.configOptions?.find((option) => option.id === "agent");
  if (selectedAgent?.currentValue !== agentName) {
    throw new Error(`Copilot ACP did not select the product agent: ${selectedAgent?.currentValue ?? "missing"}`);
  }
  return agentConfig;
}

export function summarizeAcpTranscript(transcript, additionalText = "") {
  const text = [];
  const toolCalls = new Map();
  let promptIndex = -1;
  let toolSequence = 0;
  for (const entry of transcript ?? []) {
    if (entry.direction === "client" && entry.message?.method === "session/prompt") {
      promptIndex += 1;
      continue;
    }
    const message = entry.direction === "agent" ? entry.message : null;
    if (message?.method !== "session/update") continue;
    const update = message.params?.update;
    if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
      text.push(update.content.text ?? "");
    }
    if (update?.sessionUpdate === "tool_call") {
      toolCalls.set(update.toolCallId, {
        toolCallId: update.toolCallId,
        title: update.title,
        kind: update.kind,
        status: update.status,
        rawInput: update.rawInput,
        rawOutput: update.rawOutput,
        promptIndex: promptIndex >= 0 ? promptIndex : null,
        sequence: toolSequence++,
      });
    }
    if (update?.sessionUpdate === "tool_call_update" && toolCalls.has(update.toolCallId)) {
      Object.assign(toolCalls.get(update.toolCallId), Object.fromEntries(
        Object.entries(update).filter(([, value]) => value !== null && value !== undefined),
      ));
    }
  }
  const agentText = text.join("").trim();
  const hostText = `${agentText}\n${additionalText}`;
  const hostErrors = [
    /exceeded your (?:monthly )?quota/i,
    /payment required/i,
    /http (?:status )?402/i,
    /rate limit/i,
    /authentication (?:required|failed)/i,
    /model .{0,80}(?:not available|unavailable)/i,
  ].filter((pattern) => pattern.test(hostText)).map((pattern) => pattern.source);
  return { agentText, toolCalls: [...toolCalls.values()], hostErrors };
}

function matchingEnumValue(values, choice) {
  const normalizedChoice = choice.toLowerCase();
  return values.find((value) => {
    const normalizedValue = String(value).toLowerCase();
    return normalizedValue.includes(normalizedChoice) || normalizedChoice.includes(normalizedValue);
  }) ?? values[0];
}

export function acceptFormElicitation(params, choice = "Start batch") {
  if (params?.mode !== "form") {
    throw new Error(`Unsupported ACP elicitation mode: ${params?.mode ?? "missing"}`);
  }
  const schema = params.requestedSchema;
  if (schema?.type !== "object" || !schema.properties || typeof schema.properties !== "object") {
    throw new Error("ACP form elicitation did not provide an object schema");
  }

  const propertyNames = schema.required?.length > 0
    ? schema.required
    : Object.keys(schema.properties);
  const content = Object.fromEntries(propertyNames.map((propertyName) => {
    const property = schema.properties[propertyName] ?? {};
    if (Array.isArray(property.enum) && property.enum.length > 0) {
      return [propertyName, matchingEnumValue(property.enum, choice)];
    }
    if (property.type === "boolean") return [propertyName, /start|yes|approve/i.test(choice)];
    if (property.type === "number" || property.type === "integer") {
      return [propertyName, property.default ?? property.minimum ?? 0];
    }
    return [propertyName, property.default ?? choice];
  }));
  return { action: "accept", content };
}

export function acceptToolPermission(params, { persist = true } = {}) {
  const preferredKind = persist ? "allow_always" : "allow_once";
  const option = params?.options?.find((candidate) => candidate.kind === preferredKind)
    ?? (persist ? params?.options?.find((candidate) => candidate.kind === "allow_once") : null);
  if (!option) {
    throw new Error(`ACP permission request has no ${preferredKind} option`);
  }
  return { outcome: { outcome: "selected", optionId: option.optionId } };
}

function createAcpConnection(child, requestHandler) {
  let nextRequestId = 0;
  let stdoutBuffer = "";
  let stderr = "";
  let exited = false;
  let closed = false;
  let resolveClosed;
  const closedPromise = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const pending = new Map();
  const transcript = [];
  const warnings = [];

  function send(message) {
    transcript.push({ direction: "client", message });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function failPending(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  }

  async function handleServerRequest(message) {
    try {
      const result = await requestHandler(message);
      send({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: error.message },
      });
    }
  }

  function handleMessage(message) {
    transcript.push({ direction: "agent", message });
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`ACP ${waiter.method} failed: ${message.error.message}`));
      else waiter.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) void handleServerRequest(message);
  }

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        try {
          handleMessage(JSON.parse(line));
        } catch {
          warnings.push(line);
        }
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-10_000);
  });
  child.on("error", failPending);
  child.on("exit", (code, signal) => {
    exited = true;
    if (pending.size > 0) {
      failPending(new Error(`Copilot ACP exited before completing requests: code=${code}, signal=${signal}`));
    }
  });
  child.on("close", () => {
    closed = true;
    resolveClosed();
  });

  return {
    request(method, params) {
      if (exited) return Promise.reject(new Error(`Cannot call ${method}; Copilot ACP has exited`));
      const id = nextRequestId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject });
        send({ jsonrpc: "2.0", id, method, params });
      });
    },
    async stop() {
      if (!exited) child.kill();
      if (!closed) await closedPromise;
    },
    getEvidence() {
      return { transcript, warnings, stderr: stderr.trim() };
    },
  };
}

export async function invokeProductAgentAcp({
  workspacePath,
  prompt,
  followUpPrompts = [],
  model = "auto",
  elicitationHandler = (params) => acceptFormElicitation(params),
  permissionHandler = (params) => acceptToolPermission(params),
  allowAllTools = true,
  agentName = productAgentName,
  copilotPath,
  timeoutMs = 15 * 60 * 1000,
  spawnImpl = spawn,
} = {}) {
  const executable = resolveCopilotBinary(copilotPath ?? process.env.COPILOT_CLI_PATH);
  const child = spawnImpl(executable, productAcpInvocationArgs({
    workspacePath,
    model,
    agentName,
    allowAllTools,
  }), {
    encoding: "utf8",
    env: productAcpEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const permissionRequests = [];
  const permissionResponses = [];
  const elicitationRequests = [];
  const elicitationResponses = [];
  const connection = createAcpConnection(child, async (message) => {
    if (message.method === "session/request_permission") {
      permissionRequests.push(message.params);
      const response = await permissionHandler(message.params);
      permissionResponses.push({ request: message.params, response });
      return response;
    }
    if (message.method === "elicitation/create") {
      elicitationRequests.push(message.params);
      const response = await elicitationHandler(message.params);
      elicitationResponses.push({ request: message.params, response });
      return response;
    }
    throw new Error(`Unsupported ACP client request: ${message.method}`);
  });
  const startedAt = Date.now();
  let timeout;
  try {
    const workflow = async () => {
      const initializeResult = await connection.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { elicitation: { form: {} } },
        clientInfo: { name: "batch-assessment-product-e2e", version: "1.0.0" },
      });
      const session = await connection.request("session/new", {
        cwd: path.resolve(workspacePath),
        mcpServers: [],
      });
      const agentConfig = await ensureProductAgentSelected(connection, session, agentName);
      const desiredPermissionValue = allowAllTools ? "on" : "off";
      const currentPermission = agentConfig.configOptions?.find((option) => option.id === "allow_all");
      const permissionConfig = currentPermission?.currentValue === desiredPermissionValue
        ? { configOptions: agentConfig.configOptions }
        : await connection.request("session/set_config_option", {
          sessionId: session.sessionId,
          configId: "allow_all",
          value: desiredPermissionValue,
        });
      const allowAll = permissionConfig.configOptions?.find((option) => option.id === "allow_all");
      if (allowAll?.currentValue !== desiredPermissionValue) {
        throw new Error(
          `Copilot ACP did not set allow_all=${desiredPermissionValue}: ${allowAll?.currentValue ?? "missing"}`,
        );
      }
      const promptSequence = await submitAcpPrompts(
        connection,
        session.sessionId,
        [prompt, ...followUpPrompts],
        { continueAfterPrompt: () => elicitationRequests.length === 0 },
      );
      if (initializeResult.agentCapabilities?.sessionCapabilities?.close) {
        await connection.request("session/close", { sessionId: session.sessionId });
      }
      return {
        initializeResult,
        session,
        agentConfig,
        permissionConfig,
        ...promptSequence,
      };
    };
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Copilot ACP timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const result = await Promise.race([workflow(), timeoutPromise]);
    const connectionEvidence = connection.getEvidence();
    return {
      ...result,
      durationMs: Date.now() - startedAt,
      permissionRequests,
      permissionResponses,
      elicitationRequests,
      elicitationResponses,
      ...connectionEvidence,
      ...summarizeAcpTranscript(connectionEvidence.transcript, connectionEvidence.stderr),
    };
  } catch (error) {
    const connectionEvidence = connection.getEvidence();
    error.acpEvidence = {
      durationMs: Date.now() - startedAt,
      permissionRequests,
      permissionResponses,
      elicitationRequests,
      elicitationResponses,
      ...connectionEvidence,
      ...summarizeAcpTranscript(connectionEvidence.transcript, connectionEvidence.stderr),
    };
    throw error;
  } finally {
    clearTimeout(timeout);
    await connection.stop();
  }
}

export function invokeProductAgent({
  workspacePath,
  prompt,
  model = "auto",
  resumeSessionId,
  copilotPath,
  timeoutMs = 15 * 60 * 1000,
  spawnSyncImpl = spawnSync,
} = {}) {
  const executable = resolveCopilotBinary(copilotPath ?? process.env.COPILOT_CLI_PATH);
  const startedAt = Date.now();
  const result = spawnSyncImpl(
    executable,
    productInvocationArgs({ workspacePath, prompt, model, resumeSessionId }),
    {
      encoding: "utf8",
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      maxBuffer: 100 * 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  const events = parseJsonLines(result.stdout);
  const terminalResult = events.findLast((event) => event.type === "result");
  return {
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    sessionId: terminalResult?.sessionId ?? null,
    models: selectedModels(events),
    response: responseText(events),
    stderr: String(result.stderr ?? "").trim().slice(-2000),
    events,
  };
}

function cliVersion(executable) {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unable to read Copilot CLI version: ${String(result.stderr ?? "").trim()}`);
  }
  return String(result.stdout).trim();
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

export function runRouteProbe({ outputPath = defaultEvidencePath, copilotPath, model = "auto" } = {}) {
  const productPackage = validateProductPackage();
  const executable = resolveCopilotBinary(copilotPath ?? process.env.COPILOT_CLI_PATH);
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "batch-assessment-route-"));
  const evidence = {
    schemaVersion: 1,
    status: "running",
    scenario: "product-route-gate",
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    nodeVersion: process.version,
    copilotVersion: cliVersion(executable),
    productPackage,
    probes: {},
  };
  atomicWriteJson(outputPath, evidence);

  try {
    const run = invokeProductAgent({
      workspacePath,
      copilotPath: executable,
      model,
      prompt: "Plan changes for multiple repositories in batch mode. "
        + "Do not assess or modify anything; state whether this Batch Assessment action is available.",
    });
    if (run.exitCode !== 0) {
      throw new Error(`Product route probe exited ${run.exitCode}: ${run.stderr}`);
    }
    if (!/not (?:available|supported)|supports only Batch Assessment/i.test(run.response)) {
      throw new Error(`Product route probe did not reject Batch Planning: ${run.response}`);
    }
    evidence.probes.unsupportedBatchPlanning = {
      status: "passed",
      sessionId: run.sessionId,
      models: run.models,
      durationMs: run.durationMs,
      response: run.response,
    };
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error.message;
    throw error;
  } finally {
    evidence.completedAt = new Date().toISOString();
    atomicWriteJson(outputPath, evidence);
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
  return evidence;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const preparePath = optionValue("--prepare-fixture");
    if (preparePath) {
      console.log(JSON.stringify(createProductFixture(preparePath), null, 2));
      process.exit(0);
    }
    const outputPath = path.resolve(optionValue("--output") ?? defaultEvidencePath);
    const evidence = runRouteProbe({
      outputPath,
      copilotPath: optionValue("--copilot"),
      model: optionValue("--model") ?? "auto",
    });
    console.log(JSON.stringify({ status: evidence.status, outputPath }));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
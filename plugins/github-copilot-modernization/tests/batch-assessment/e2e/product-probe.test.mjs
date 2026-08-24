import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acceptFormElicitation,
  acceptToolPermission,
  createProductFixture,
  ensureProductAgentSelected,
  parseJsonLines,
  pluginRoot,
  productAcpEnvironment,
  productAcpInvocationArgs,
  productInvocationArgs,
  REQUIRED_PRODUCT_FILES,
  submitAcpPrompts,
  summarizeAcpTranscript,
  validateProductPackage,
  verifySourceCanaries,
} from "./product-probe.mjs";

function copyProductPackage(destination) {
  for (const relativePath of REQUIRED_PRODUCT_FILES) {
    const source = path.join(pluginRoot, ...relativePath.split("/"));
    const target = path.join(destination, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

test("product package contains every Batch Assessment runtime surface", () => {
  const result = validateProductPackage();
  assert.equal(result.name, "github-copilot-modernization");
  assert.match(result.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(result.requiredFiles, [...REQUIRED_PRODUCT_FILES]);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test("product package validation fails closed on a missing runtime file", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-product-package-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  copyProductPackage(temporaryRoot);
  fs.rmSync(path.join(temporaryRoot, "agents", "batch-assessment.agent.md"));
  assert.throws(
    () => validateProductPackage(temporaryRoot),
    /agents\/batch-assessment\.agent\.md/,
  );
});

test("product package digest is stable across LF and CRLF checkouts", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-product-line-endings-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  copyProductPackage(temporaryRoot);
  const agentPath = path.join(temporaryRoot, "agents", "modernize.agent.md");
  const content = fs.readFileSync(agentPath, "utf8").replace(/\r\n/g, "\n");
  fs.writeFileSync(agentPath, content, "utf8");
  const lfDigest = validateProductPackage(temporaryRoot).sha256;
  fs.writeFileSync(agentPath, content.replace(/\n/g, "\r\n"), "utf8");
  assert.equal(validateProductPackage(temporaryRoot).sha256, lfDigest);
});

test("product invocation loads the real plugin and modernize agent", () => {
  const args = productInvocationArgs({
    workspacePath: path.resolve("workspace"),
    prompt: "probe",
  });
  assert.deepEqual(args.slice(0, 4), ["-C", path.resolve("workspace"), "--plugin-dir", pluginRoot]);
  assert.equal(args.includes("--agent=github-copilot-modernization:modernize"), true);
  assert.equal(args.includes("--model"), true);
  assert.equal(args[args.indexOf("--model") + 1], "auto");
  assert.equal(args.includes("--output-format"), true);

  const resumed = productInvocationArgs({
    workspacePath: path.resolve("workspace"),
    prompt: "continue",
    resumeSessionId: "session-1",
  });
  assert.equal(resumed.includes("--resume=session-1"), true);
  assert.equal(resumed.some((arg) => arg.startsWith("--agent=")), false);

  const acpArgs = productAcpInvocationArgs({ workspacePath: path.resolve("workspace") });
  assert.equal(acpArgs[0], "--acp");
  assert.deepEqual(acpArgs.slice(1, 3), ["-C", path.resolve("workspace")]);
  assert.equal(acpArgs.includes(pluginRoot), true);
  assert.equal(acpArgs.includes("--agent=github-copilot-modernization:modernize"), true);
  assert.equal(acpArgs[acpArgs.indexOf("--model") + 1], "auto");
  assert.equal(acpArgs.includes("--prompt"), false);
  assert.equal(acpArgs.includes("--acp"), true);
  assert.equal(acpArgs.includes("--allow-all-tools"), true);
  const permissionProbeArgs = productAcpInvocationArgs({
    workspacePath: path.resolve("workspace"),
    allowAllTools: false,
  });
  assert.equal(permissionProbeArgs.includes("--allow-all-tools"), false);
  const acpEnvironment = productAcpEnvironment({ PATH: "probe-path" });
  assert.equal(acpEnvironment.PATH, "probe-path");
  assert.equal(acpEnvironment.PLUGIN_ROOT, pluginRoot);
  assert.equal(acpEnvironment.NO_COLOR, "1");
});

test("ACP form responses select Start batch from structured choices", () => {
  assert.deepEqual(acceptFormElicitation({
    mode: "form",
    requestedSchema: {
      type: "object",
      properties: {
        approval: { type: "string", enum: ["Start batch (Recommended)", "Cancel"] },
      },
      required: ["approval"],
    },
  }), {
    action: "accept",
    content: { approval: "Start batch (Recommended)" },
  });
  assert.throws(
    () => acceptFormElicitation({ mode: "url" }),
    /Unsupported ACP elicitation mode/,
  );
});

test("ACP form responses select Batch or Single workspace mode exactly", () => {
  const params = {
    mode: "form",
    requestedSchema: {
      type: "object",
      properties: {
        workspaceMode: {
          type: "string",
          enum: ["Process repositories from repos.json", "Only process the current repository"],
        },
      },
      required: ["workspaceMode"],
    },
  };
  assert.deepEqual(acceptFormElicitation(params, "Process repositories from repos.json"), {
    action: "accept",
    content: { workspaceMode: "Process repositories from repos.json" },
  });
  assert.deepEqual(acceptFormElicitation(params, "Only process the current repository"), {
    action: "accept",
    content: { workspaceMode: "Only process the current repository" },
  });
});

test("product fixtures contain two clean whole repositories and detect source changes", (t) => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "batch-product-fixture-test-")), "launch");
  t.after(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }));
  const fixture = createProductFixture(root);
  assert.deepEqual(fixture.repositories.map((repository) => repository.name), [
    "alpha-service",
    "beta-service",
  ]);
  assert.equal(JSON.parse(fs.readFileSync(fixture.configPath, "utf8")).repos.length, 2);
  assert.deepEqual(verifySourceCanaries(fixture).changed, []);
  fs.appendFileSync(path.join(fixture.repositories[0].path, "src", "index.js"), "// changed\n");
  assert.deepEqual(verifySourceCanaries(fixture).changed, ["alpha-service/src/index.js"]);
});

test("bootstrap failure fixture uses a repository condition instead of production fault injection", (t) => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "batch-product-failure-fixture-")), "launch");
  t.after(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }));
  const fixture = createProductFixture(root, { bootstrapFailureRepository: "alpha-service" });
  assert.equal(fixture.variant, "bootstrap-failure");
  assert.equal(
    fs.statSync(path.join(fixture.repositories[0].path, ".github", "modernize", ".runtime")).isFile(),
    true,
  );
  assert.equal(Object.hasOwn(fixture.canaries, "alpha-service/.github/modernize/.runtime"), true);
  assert.deepEqual(verifySourceCanaries(fixture).changed, []);
});

test("JSONL parsing retains session, model, and assistant evidence", () => {
  const output = [
    "custom agent warning",
    JSON.stringify({ type: "model.call_start", data: { model: "gpt-test" } }),
    JSON.stringify({ type: "assistant.message", data: { content: "Not available." } }),
    JSON.stringify({ type: "result", sessionId: "session-1", exitCode: 0 }),
  ].join("\n");
  assert.deepEqual(parseJsonLines(output).map((event) => event.type), [
    "model.call_start",
    "assistant.message",
    "result",
  ]);
});

test("ACP retains the startup product agent without redundant selection", async () => {
  const requests = [];
  const connection = {
    request(method, params) {
      requests.push({ method, params });
      throw new Error("agent selection should not be requested");
    },
  };
  const session = {
    sessionId: "session-1",
    configOptions: [
      { id: "agent", currentValue: "github-copilot-modernization:modernize" },
      { id: "allow_all", currentValue: "off" },
    ],
  };
  const result = await ensureProductAgentSelected(connection, session);
  assert.deepEqual(result.configOptions, session.configOptions);
  assert.deepEqual(requests, []);
});

test("ACP selects and verifies the product agent when startup did not", async () => {
  const requests = [];
  const connection = {
    async request(method, params) {
      requests.push({ method, params });
      return {
        configOptions: [
          { id: "agent", currentValue: "github-copilot-modernization:modernize" },
        ],
      };
    },
  };
  await ensureProductAgentSelected(connection, {
    sessionId: "session-2",
    configOptions: [{ id: "agent", currentValue: "other" }],
  });
  assert.deepEqual(requests, [{
    method: "session/set_config_option",
    params: {
      sessionId: "session-2",
      configId: "agent",
      value: "github-copilot-modernization:modernize",
    },
  }]);
});

test("ACP transcript evidence distinguishes tool activity from host quota errors", () => {
  const transcript = [
    {
      direction: "agent",
      message: {
        method: "session/update",
        params: { update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Run batch review",
          kind: "execute",
          status: "in_progress",
          rawInput: { command: "review" },
        } },
      },
    },
    {
      direction: "agent",
      message: {
        method: "session/update",
        params: { update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
        } },
      },
    },
    {
      direction: "agent",
      message: {
        method: "session/update",
        params: { update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "You have exceeded your monthly quota" },
        } },
      },
    },
  ];
  const evidence = summarizeAcpTranscript(transcript);
  assert.equal(evidence.agentText, "You have exceeded your monthly quota");
  assert.equal(evidence.hostErrors.length, 1);
  assert.deepEqual(evidence.toolCalls, [{
    toolCallId: "tool-1",
    title: "Run batch review",
    kind: "execute",
    status: "completed",
    rawInput: { command: "review" },
    rawOutput: undefined,
    promptIndex: null,
    sequence: 0,
    sessionUpdate: "tool_call_update",
  }]);

  const stderrOnly = summarizeAcpTranscript([], "Request failed with HTTP status 402");
  assert.deepEqual(stderrOnly.hostErrors, ["http (?:status )?402"]);
});

test("ACP permission responses distinguish persistent and one-shot grants", () => {
  const request = {
    options: [
      { kind: "allow_once", optionId: "once" },
      { kind: "allow_always", optionId: "always" },
    ],
  };
  assert.deepEqual(acceptToolPermission(request), {
    outcome: { outcome: "selected", optionId: "always" },
  });
  assert.deepEqual(acceptToolPermission(request, { persist: false }), {
    outcome: { outcome: "selected", optionId: "once" },
  });
  assert.deepEqual(acceptToolPermission({ options: [request.options[0]] }), {
    outcome: { outcome: "selected", optionId: "once" },
  });
  assert.throws(
    () => acceptToolPermission({ options: [] }, { persist: false }),
    /no allow_once option/,
  );
});

test("ACP invocation can select another packaged agent for capability probes", () => {
  const args = productAcpInvocationArgs({
    workspacePath: "C:\\work",
    agentName: "github-copilot-modernization:modernize-java-upgrade",
  });
  assert.equal(args.includes("--agent=github-copilot-modernization:modernize-java-upgrade"), true);
  assert.equal(args.includes("--agent=github-copilot-modernization:modernize"), false);
});

test("ACP prompt sequences submit explicit follow-up user turns in order", async () => {
  const requests = [];
  const connection = {
    async request(method, params) {
      requests.push({ method, params });
      return { stopReason: "end_turn", index: requests.length };
    },
  };
  const result = await submitAcpPrompts(connection, "session-approval", ["Review", "Start batch"]);
  assert.deepEqual(result.userPrompts, ["Review", "Start batch"]);
  assert.deepEqual(result.promptResults.map((entry) => entry.index), [1, 2]);
  assert.equal(result.promptResult.index, 2);
  assert.deepEqual(requests, [
    {
      method: "session/prompt",
      params: { sessionId: "session-approval", prompt: [{ type: "text", text: "Review" }] },
    },
    {
      method: "session/prompt",
      params: { sessionId: "session-approval", prompt: [{ type: "text", text: "Start batch" }] },
    },
  ]);
});

test("ACP prompt sequences skip fallback turns after structured elicitation", async () => {
  const requests = [];
  let elicitationObserved = false;
  const connection = {
    async request(method, params) {
      requests.push({ method, params });
      elicitationObserved = true;
      return { stopReason: "end_turn" };
    },
  };
  const result = await submitAcpPrompts(
    connection,
    "session-structured",
    ["Review", "Start batch"],
    { continueAfterPrompt: () => !elicitationObserved },
  );
  assert.deepEqual(result.userPrompts, ["Review"]);
  assert.equal(result.promptResults.length, 1);
  assert.equal(requests.length, 1);
});
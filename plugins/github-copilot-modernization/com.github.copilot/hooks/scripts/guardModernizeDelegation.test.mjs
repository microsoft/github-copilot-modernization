import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { renderAgentContent, renderGuardContent } = require(path.resolve(scriptsRoot, "..", "..", "..", "scripts", "render-agent-platform.js"));
const guardSourcePath = path.join(scriptsRoot, "guardModernizeDelegation.mjs");
const {
  evaluateModernizePostTool: evaluateVscodePostTool,
  evaluateModernizeTool: evaluateVscodeTool,
} = await import(`${pathToFileURL(guardSourcePath).href}?platform=vscode`);
const renderedGuardRoot = fs.mkdtempSync(path.join(os.tmpdir(), "modernize-plugin-guard-"));
const scriptPath = path.join(renderedGuardRoot, "guardModernizeDelegation.mjs");
fs.writeFileSync(
  scriptPath,
  renderGuardContent(fs.readFileSync(guardSourcePath, "utf8"), "plugin"),
  "utf8",
);
const {
  evaluateCliGlobalPostTool,
  evaluateCliGlobalTool,
  evaluateModernizePostTool,
  evaluateModernizeTool,
} = await import(pathToFileURL(scriptPath).href);
after(() => fs.rmSync(renderedGuardRoot, { recursive: true, force: true }));
const modernizeAgentPath = path.resolve(scriptsRoot, "..", "..", "modernize.agent.md");
const batchModeProbeAgentPath = path.resolve(scriptsRoot, "..", "..", "batch-mode-probe.agent.md");
const reviewAgentPath = path.resolve(scriptsRoot, "..", "..", "batch-review.agent.md");
const coordinatorAgentPath = path.resolve(scriptsRoot, "..", "..", "batch-coordinator.agent.md");
const batchAssessmentAgentPath = path.resolve(scriptsRoot, "..", "..", "batch-assessment.agent.md");
const assessmentCoordinatorAgentPath = path.resolve(scriptsRoot, "..", "..", "assessment-coordinator.agent.md");
const planningCoordinatorAgentPath = path.resolve(scriptsRoot, "..", "..", "planning-coordinator.agent.md");
const executionCoordinatorAgentPath = path.resolve(scriptsRoot, "..", "..", "execution-coordinator.agent.md");
const hooksManifestPath = path.resolve(scriptsRoot, "..", "hooks.json");
const FOLLOW_UP_APPROVAL = '{"mode":"explicit-follow-up","value":"Start batch","entireUserTurn":"Start batch","immediatelyAfterReview":true}';

function permission(payload) {
  return evaluateModernizeTool(payload).hookSpecificOutput.permissionDecision;
}

function approvedCoordinatorPrompt() {
  return [
    "BATCH_REVIEW_READY",
    "batchRoot: C:\\workspace\\.github\\modernize\\batches\\batch-1",
    "reviewPath: C:\\workspace\\.github\\modernize\\batches\\batch-1\\review.json",
    "reviewMarkdownPath: C:\\workspace\\.github\\modernize\\batches\\batch-1\\REVIEW.md",
    `reviewSha256: ${"a".repeat(64)}`,
    `reviewMarkdownSha256: ${"b".repeat(64)}`,
    "inspectedReposPath: C:\\workspace\\.github\\modernize\\batches\\batch-1\\inspected.json",
    `inspectedReposSha256: ${"d".repeat(64)}`,
    "batchAttemptScriptPath: C:\\plugin\\batch-attempt.mjs",
    `configSha256: ${"c".repeat(64)}`,
    'selectedExecutionUnitIds: ["alpha"]',
    "approvedNeedsAttention: []",
    'effectiveAssessments: [{"executionUnitId":"alpha","language":"java","domains":["java-upgrade"]}]',
    "blockedExecutionUnits: []",
    "analysisCoverage: issue-only",
    "maxConcurrency: 1",
    '{"mode":"structured","value":"Start batch","accepted":true}',
  ].join("\n");
}

function approvedCoordinatorJsonPrompt() {
  return [
    "BATCH_REVIEW_READY handoff:",
    JSON.stringify({
      Status: "BATCH_REVIEW_READY",
      batchRoot: "C:\\workspace\\.github\\modernize\\batches\\batch-1",
      reviewPath: "C:\\workspace\\.github\\modernize\\batches\\batch-1\\review.json",
      reviewMarkdownPath: "C:\\workspace\\.github\\modernize\\batches\\batch-1\\REVIEW.md",
      reviewSha256: "a".repeat(64),
      reviewMarkdownSha256: "b".repeat(64),
      inspectedReposPath: "C:\\workspace\\.github\\modernize\\batches\\batch-1\\inspected.json",
      inspectedReposSha256: "d".repeat(64),
      batchAttemptScriptPath: "C:\\plugin\\batch-attempt.mjs",
      configSha256: "c".repeat(64),
      selectedExecutionUnitIds: ["alpha"],
      approvedNeedsAttention: [],
      effectiveAssessments: [{ executionUnitId: "alpha", language: "java", domains: ["java-upgrade"] }],
      blockedExecutionUnits: [],
      analysisCoverage: "issue-only",
      maxConcurrency: 1,
    }),
    FOLLOW_UP_APPROVAL,
  ].join("\n");
}

function fallbackTranscript() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "modernize-delegation-"));
  const transcriptPath = path.join(root, "events.jsonl");
  const events = [
    { type: "user.message", data: { content: "Assess all configured repositories." } },
    { type: "user.message", data: { content: "Process repositories from repos.json" } },
    { type: "tool.execution_complete", data: { result: { content: approvedCoordinatorPrompt().replace('{"mode":"structured","value":"Start batch","accepted":true}', "") } } },
    { type: "assistant.message", data: { content: "BATCH_REVIEW_READY" } },
    { type: "user.message", data: { content: "Start batch" } },
  ];
  fs.writeFileSync(transcriptPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  return { root, transcriptPath };
}

function assessmentTranscript(config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "assessment-coverage-"));
  const transcriptPath = path.join(root, "events.jsonl");
  const prompt = [
    "project-path: C:\\workspace",
    'user-request: "assess my app"',
    "mode: coordinator",
    `config: ${JSON.stringify(config)}`,
  ].join("\n");
  fs.writeFileSync(
    transcriptPath,
    `${JSON.stringify({ type: "user.message", data: { content: prompt } })}\n`,
    "utf8",
  );
  return { root, transcriptPath };
}

test("VS Code guard does not probe Batch workspace state", () => {
  const payload = {
    cwd: path.join(os.tmpdir(), "missing-vscode-workspace"),
    tool_name: "vscode_askQuestions",
    tool_input: {
      questions: [{
        header: "Workspace Mode",
        options: [
          { label: "Process repositories from repos.json" },
          { label: "Only process the current repository" },
        ],
      }],
    },
  };

  assert.equal(
    evaluateVscodeTool(payload).hookSpecificOutput.permissionDecision,
    "allow",
  );
  assert.deepEqual(evaluateVscodePostTool({
    ...payload,
    tool_name: "runSubagent",
    tool_input: { agentName: "github-copilot-modernization:batch-mode-probe" },
  }), {});
});

test("routing agents inherit host tool and agent capabilities", () => {
  const agents = [
    renderAgentContent(fs.readFileSync(modernizeAgentPath, "utf8"), "plugin"),
    fs.readFileSync(planningCoordinatorAgentPath, "utf8"),
    fs.readFileSync(executionCoordinatorAgentPath, "utf8"),
  ];

  for (const agent of agents) {
    const frontmatter = agent.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
    assert.doesNotMatch(frontmatter, /^tools:/m);
    assert.doesNotMatch(frontmatter, /^agents:/m);
  }

  assert.match(agents[2], /FIRST WORK ACTION MUST BE constraint\/plan loading/);
});

test("Copilot CLI discovers the native global guard", () => {
  const manifest = JSON.parse(fs.readFileSync(hooksManifestPath, "utf8"));

  assert.equal(manifest.version, 1);
  assert.deepEqual(Object.keys(manifest.hooks).sort(), ["postToolUse", "preToolUse"]);
  for (const [eventName, entries] of Object.entries(manifest.hooks)) {
    assert.equal(entries.length, 1, `${eventName} must have one guard entry`);
    assert.equal(entries[0].exec, "node");
    assert.match(entries[0].args.join(" "), /guardModernizeDelegation\.mjs.*--cli-global/);
  }
});

test("Copilot CLI global guard is a no-op for unrelated calls", () => {
  for (const payload of [
    { toolName: "view", toolArgs: { path: "README.md" } },
    { toolName: "task", toolArgs: { agent_type: "general-purpose", prompt: "Assess this app." } },
    { toolName: "task", toolArgs: { agent_type: "another-plugin:assessment-coordinator", prompt: "config: {bad}" } },
    { toolName: "task", toolArgs: { agent_type: "github-copilot-modernization:planning-coordinator", prompt: "Plan the work." } },
  ]) {
    assert.deepEqual(evaluateCliGlobalTool(payload), {});
  }
});

test("Copilot CLI global guard translates assessment config mutations and denials", () => {
  const updated = evaluateCliGlobalTool({
    toolName: "task",
    toolArgs: {
      agent_type: "github-copilot-modernization:assessment-coordinator",
      prompt: "Assess the current application.",
    },
  });
  assert.equal(updated.permissionDecision, "allow");
  assert.equal(updated.modifiedArgs.prompt, "Assess the current application.\nconfig: {}");
  assert.equal(updated.hookSpecificOutput, undefined);

  const denied = evaluateCliGlobalTool({
    toolName: "task",
    toolArgs: {
      agent_type: "github-copilot-modernization:assessment-coordinator",
      prompt: "Assess the current application.\nconfig: {bad}",
    },
  });
  assert.equal(denied.permissionDecision, "deny");
  assert.match(denied.permissionDecisionReason, /single-line JSON config/);
  assert.equal(denied.hookSpecificOutput, undefined);
});

test("Copilot CLI global guard enforces only target-dependent Batch delegation", () => {
  const incomplete = evaluateCliGlobalTool({
    toolName: "task",
    toolArgs: {
      agent_type: "github-copilot-modernization:batch-coordinator",
      prompt: "Start batch.",
    },
  });
  assert.equal(incomplete.permissionDecision, "deny");
  assert.match(incomplete.permissionDecisionReason, /BATCH_REVIEW_READY/);

  assert.deepEqual(evaluateCliGlobalTool({
    toolName: "task",
    toolArgs: {
      agent_type: "github-copilot-modernization:batch-coordinator",
      prompt: approvedCoordinatorPrompt(),
    },
  }), {});

  const wrongSingleTarget = evaluateCliGlobalTool({
    toolName: "task",
    toolArgs: {
      agent_type: "github-copilot-modernization:assessment-coordinator",
      prompt: "Assess multiple repositories from repos.json as a batch.",
    },
  });
  assert.equal(wrongSingleTarget.permissionDecision, "deny");
  assert.match(wrongSingleTarget.permissionDecisionReason, /Batch scope/);
});

test("Copilot CLI global post-hook validates only batch-mode-probe results", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-batch-mode-post-hook-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = evaluateCliGlobalPostTool({
    cwd: root,
    toolName: "task",
    toolArgs: { agent_type: "github-copilot-modernization:batch-mode-probe" },
    toolResult: '{"status":"found"}',
  });
  assert.match(result.additionalContext, /"status":"absent"/);
  assert.equal(result.hookSpecificOutput, undefined);

  assert.deepEqual(evaluateCliGlobalPostTool({
    cwd: root,
    toolName: "task",
    toolArgs: { agent_type: "general-purpose" },
    toolResult: "unrelated",
  }), {});
});

test("allows the exact Batch Review agent", () => {
  assert.equal(permission({
    tool_name: "task",
    tool_input: {
      agent_type: "github-copilot-modernization:batch-review",
      prompt: "Process repositories from repos.json using Batch Assessment.",
    },
  }), "allow");
});

test("rejects batch-coordinator before a ready approved handoff", () => {
  const result = evaluateModernizeTool({
    tool_name: "task",
    tool_input: {
      agent_type: "github-copilot-modernization:batch-coordinator",
      prompt: "Prepare a review for repositories from repos.json.",
    },
  });

  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /Do not rerun or repair the Review/);
});

test("allows batch-coordinator only with the complete handoff and exact approval", () => {
  assert.equal(permission({
    tool_name: "task",
    tool_input: JSON.stringify({
      agent_type: "github-copilot-modernization:batch-coordinator",
      prompt: approvedCoordinatorPrompt(),
    }),
  }), "allow");
});

test("allows a lossless JSON encoding of the complete approved handoff", () => {
  assert.equal(permission({
    tool_name: "task",
    tool_input: {
      agent_type: "github-copilot-modernization:batch-coordinator",
      prompt: approvedCoordinatorJsonPrompt(),
    },
  }), "allow");
});

test("rejects JSON handoffs with a missing field or paraphrased approval", () => {
  const approved = approvedCoordinatorJsonPrompt();
  for (const prompt of [
    approved.replace(/"reviewSha256":"[a-f0-9]+",/, ""),
    approved.replace(/"inspectedReposSha256":"[a-f0-9]+",/, ""),
    approved.replace(FOLLOW_UP_APPROVAL, "The user approved the batch."),
  ]) {
    assert.equal(permission({
      tool_name: "task",
      tool_input: {
        agent_type: "github-copilot-modernization:batch-coordinator",
        prompt,
      },
    }), "deny");
  }
});

test("normalizes an incomplete fallback coordinator prompt from trusted transcript evidence", (t) => {
  const { root, transcriptPath } = fallbackTranscript();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = evaluateModernizeTool({
    session_id: "session-1",
    transcript_path: transcriptPath,
    cwd: "C:\\workspace",
    tool_name: "task",
    tool_input: {
      agent_type: "github-copilot-modernization:batch-coordinator",
      prompt: "BATCH_REVIEW_READY handoff: {\"batchRoot\":\"C:\\\\workspace\\\\batch-1\"}",
    },
  });

  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.updatedInput.prompt, /batchRoot: C:\\workspace/);
  assert.match(result.hookSpecificOutput.updatedInput.prompt, /"mode":"explicit-follow-up"/);
  assert.match(result.hookSpecificOutput.updatedInput.prompt, /user-request: "Assess all configured repositories\."/);
});

test("does not normalize without an exact current fallback approval", (t) => {
  const { root, transcriptPath } = fallbackTranscript();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lines = fs.readFileSync(transcriptPath, "utf8").trimEnd().split("\n");
  lines[lines.length - 1] = JSON.stringify({ type: "user.message", data: { content: "Please start batch" } });
  fs.writeFileSync(transcriptPath, `${lines.join("\n")}\n`, "utf8");

  assert.equal(permission({
    transcript_path: transcriptPath,
    cwd: "C:\\workspace",
    tool_name: "task",
    tool_input: {
      agent_type: "github-copilot-modernization:batch-coordinator",
      prompt: "incomplete",
    },
  }), "deny");
});

test("rejects Batch work sent to a Single phase coordinator", () => {
  assert.equal(permission({
    tool_name: "task",
    tool_input: {
      agent_type: "github-copilot-modernization:assessment-coordinator",
      prompt: "Assess multiple repositories from repos.json as a batch.",
    },
  }), "deny");
});

test("allows classic Single phase delegation", () => {
  const result = evaluateModernizeTool({
    tool_name: "task",
    tool_input: {
      agent_type: "github-copilot-modernization:assessment-coordinator",
      prompt: "Assess only the current repository.",
    },
  });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.updatedInput.prompt, /\nconfig: \{\}$/);
});

test("allows VS Code runSubagent payload for classic Single delegation", () => {
  const result = evaluateModernizeTool({
    hook_event_name: "PreToolUse",
    tool_name: "runSubagent",
    tool_input: {
      agentName: "github-copilot-modernization:assessment-coordinator",
      prompt: "Migrate the current application to Azure.",
    },
  });

  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.updatedInput.prompt, /\nconfig: \{\}$/);
});

test("rejects direct router delegation without a frontmatter allowlist", () => {
  for (const worker of [
    "modernize-java-upgrade",
    "modernize-azure-java",
    "modernize-java-security",
    "modernize-azure-dotnet",
    "modernize-deployment",
    "modernize-azure-integration-tester",
    "modernize-rearchitecture",
  ]) {
    const result = evaluateVscodeTool({
      tool_name: "runSubagent",
      tool_input: { agentName: worker, prompt: "Execute a migration task." },
    }).hookSpecificOutput;
    assert.equal(result.permissionDecision, "deny");
    assert.match(result.permissionDecisionReason, /execution-coordinator/);
  }

  assert.equal(evaluateVscodeTool({
    tool_name: "runSubagent",
    tool_input: { agentName: "execution-coordinator", prompt: "Execute the validated plan." },
  }).hookSpecificOutput.permissionDecision, "allow");
});

test("allows the VS Code manage_todo_list router tool", () => {
  assert.equal(permission({
    hook_event_name: "PreToolUse",
    tool_name: "manage_todo_list",
    tool_input: { todoList: [] },
  }), "allow");
});

test("allows the VS Code vscode_askQuestions router tool", () => {
  assert.equal(permission({
    hook_event_name: "PreToolUse",
    tool_name: "vscode_askQuestions",
    tool_input: {
      questions: [{
        header: "Migration scope",
        question: "What do you want to migrate to Azure?",
        allowFreeformInput: false,
      }],
    },
  }), "allow");
});

test("revalidates the default config before showing the VS Code Workspace Mode UI", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-mode-question-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, ".github", "modernize", "repos.json");
  const payload = {
    hook_event_name: "PreToolUse",
    cwd: root,
    tool_name: "vscode_askQuestions",
    tool_input: {
      questions: [{
        header: "Workspace Mode",
        question: "How should I process this workspace?",
        options: [
          { label: "Process repositories from repos.json" },
          { label: "Only process the current repository" },
        ],
        allowFreeformInput: false,
      }],
    },
  };

  const absent = evaluateModernizeTool(payload).hookSpecificOutput;
  assert.equal(absent.permissionDecision, "deny");
  assert.match(absent.permissionDecisionReason, /default config is absent/);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{"repos":[]}\n', "utf8");
  assert.equal(permission(payload), "allow");

  fs.rmSync(configPath);
  fs.mkdirSync(configPath);
  const invalid = evaluateModernizeTool(payload).hookSpecificOutput;
  assert.equal(invalid.permissionDecision, "deny");
  assert.match(invalid.permissionDecisionReason, /not a file/);

  const unverifiable = evaluateModernizeTool({ ...payload, cwd: undefined }).hookSpecificOutput;
  assert.equal(unverifiable.permissionDecision, "deny");
  assert.match(unverifiable.permissionDecisionReason, /no absolute launch root/);
});

test("supersedes inconsistent batch-mode-probe responses with authoritative filesystem state", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-mode-post-hook-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, ".github", "modernize", "repos.json");
  const payload = {
    hook_event_name: "PostToolUse",
    cwd: root,
    tool_name: "runSubagent",
    tool_input: {
      agentName: "github-copilot-modernization:batch-mode-probe",
      prompt: `launch-root: ${root}`,
    },
  };

  const inconsistent = evaluateModernizePostTool({
    ...payload,
    tool_response: JSON.stringify({
      schemaVersion: 1,
      launchRoot: root,
      configPath,
      status: "found",
    }),
  });
  assert.equal(inconsistent.decision, undefined);
  assert.equal(inconsistent.reason, undefined);
  assert.match(inconsistent.hookSpecificOutput.additionalContext, /"status":"absent"/);
  assert.match(inconsistent.hookSpecificOutput.additionalContext, /superseded/);

  const correct = evaluateModernizePostTool({
    ...payload,
    tool_response: `stdout:\n${JSON.stringify({
      schemaVersion: 1,
      launchRoot: root,
      configPath,
      status: "absent",
    })}`,
  });
  assert.equal(correct.decision, undefined);
  assert.match(correct.hookSpecificOutput.additionalContext, /"status":"absent"/);

  const malformed = evaluateModernizePostTool({ ...payload, tool_response: "status: found" });
  assert.equal(malformed.decision, undefined);
  assert.match(malformed.hookSpecificOutput.additionalContext, /"status":"absent"/);

  assert.deepEqual(evaluateModernizePostTool({
    ...payload,
    tool_input: { agentName: "github-copilot-modernization:assessment-coordinator" },
  }), {});
});

test("batch-mode probe uses one physical PowerShell command", () => {
  const agent = fs.readFileSync(batchModeProbeAgentPath, "utf8");
  const powershellBlock = agent.match(/PowerShell:\r?\n\r?\n```powershell\r?\n([\s\S]*?)\r?\n```/)?.[1];
  assert.ok(powershellBlock);
  assert.equal(powershellBlock.split(/\r?\n/).length, 1);
  assert.match(powershellBlock, /ConvertTo-Json -Compress$/);
});

test("rejects malformed or unsupported Single assessment config", () => {
  for (const config of ["{bad-json}", '{"analysisCoverage":"source-only"}']) {
    assert.equal(permission({
      tool_name: "task",
      tool_input: {
        agent_type: "github-copilot-modernization:assessment-coordinator",
        prompt: `Assess only the current repository.\nconfig: ${config}`,
      },
    }), "deny");
  }
});

test("rejects direct top-level file and command tools", () => {
  for (const toolName of ["powershell", "view", "edit", "search", "web"]) {
    assert.equal(permission({ tool_name: toolName, tool_input: {} }), "deny", toolName);
  }
});

test("product-scoped guards reject Assessment bypasses and Batch workaround paths", () => {
  for (const payload of [
    { tool_name: "appmod-mcp-server-appmod-run-assessment-action", tool_input: {} },
    { tool_name: "view", tool_input: { path: "C:\\workspace\\.github\\modernize\\repos.json" } },
    { tool_name: "view", tool_input: { path: "C:\\workspace\\.github\\modernize\\batches\\review-1\\REVIEW.md" } },
    { tool_name: "create", tool_input: { path: "C:\\workspace\\.copilot\\batch-review\\REVIEW.md" } },
  ]) {
    assert.equal(
      evaluateModernizeTool(payload, { scope: "assessment" }).hookSpecificOutput.permissionDecision,
      "deny",
    );
  }
});

test("review guard requires the loaded skill's deterministic script", () => {
  assert.equal(evaluateModernizeTool(
    { tool_name: "skill", tool_input: { name: "batch-modernization" } },
    { scope: "review" },
  ).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(evaluateModernizeTool(
    { tool_name: "powershell", tool_input: { command: "node C:\\plugin\\skills\\batch-modernization\\scripts\\prepare-review.mjs" } },
    { scope: "review" },
  ).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(evaluateModernizeTool(
    { tool_name: "powershell", tool_input: { command: "node C:\\plugin\\skills\\batch-modernization\\scripts\\resolve-repos.mjs" } },
    { scope: "review" },
  ).hookSpecificOutput.permissionDecision, "deny");
});

test("coordinator guard allows the phase agent but rejects simulated outcomes", () => {
  assert.equal(evaluateModernizeTool(
    {
      tool_name: "task",
      tool_input: { agent_type: "github-copilot-modernization:batch-assessment", prompt: "Process request.json" },
    },
    { scope: "coordinator" },
  ).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(evaluateModernizeTool(
    { tool_name: "powershell", tool_input: { command: "node batch-attempt.mjs session-commit --request request.json" } },
    { scope: "coordinator" },
  ).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(evaluateModernizeTool(
    { tool_name: "powershell", tool_input: { command: "Set-Content outcome.json '{}'; node batch-attempt.mjs publish --outcome outcome.json" } },
    { scope: "coordinator" },
  ).hookSpecificOutput.permissionDecision, "deny");
});

test("assessment guard rejects every subagent delegation", () => {
  for (const agentName of [
    "github-copilot-modernization:modernize",
    "github-copilot-modernization:assessment-coordinator",
    "github-copilot-modernization:batch-assessment",
    "github-copilot-modernization:batch-mode-probe",
    "github-copilot-modernization:planning-coordinator",
    "general-purpose",
    "github-copilot-modernization:assessment-task-worker",
  ]) {
    assert.equal(evaluateModernizeTool(
      { tool_name: "task", tool_input: { agent_type: agentName } },
      { scope: "assessment" },
    ).hookSpecificOutput.permissionDecision, "deny");
  }
  assert.equal(evaluateModernizeTool(
    { tool_name: "skill", tool_input: { skill: "assessment" } },
    { scope: "assessment" },
  ).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(evaluateModernizeTool(
    { tool_name: "runSubagent", tool_input: { agentName: "general-purpose" } },
    { scope: "assessment" },
  ).hookSpecificOutput.permissionDecision, "deny");
});

test("assessment guard enforces default issue-only coverage", (t) => {
  const { root, transcriptPath } = assessmentTranscript();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const command of [
    "node assess-cli.mjs prepare-run --workspace-path C:\\workspace --run-id 1 --language java --coverage-source default",
    "node assess-cli.mjs prepare-run --workspace-path C:\\workspace --run-id 1 --language java --coverage issue-only --coverage-source default",
  ]) {
    assert.equal(evaluateModernizeTool({
      transcript_path: transcriptPath,
      tool_name: "powershell",
      tool_input: { command },
    }, { scope: "assessment" }).hookSpecificOutput.permissionDecision, "allow");
  }

  const denied = evaluateModernizeTool({
    transcript_path: transcriptPath,
    tool_name: "powershell",
    tool_input: {
      command: "node assess-cli.mjs prepare-run --workspace-path C:\\workspace --run-id 1 --language java --coverage full",
    },
  }, { scope: "assessment" }).hookSpecificOutput;
  assert.equal(denied.permissionDecision, "deny");
  assert.match(denied.permissionDecisionReason, /coverage-source/);

  const escalated = evaluateModernizeTool({
    transcript_path: transcriptPath,
    tool_name: "powershell",
    tool_input: {
      command: "node assess-cli.mjs prepare-run --workspace-path C:\\workspace --run-id 1 --language java --coverage full --coverage-source explicit-user",
    },
  }, { scope: "assessment" }).hookSpecificOutput;
  assert.equal(escalated.permissionDecision, "deny");
  assert.match(escalated.permissionDecisionReason, /expected issue-only/);
});

test("assessment guard allows only the explicitly configured full coverage", (t) => {
  const { root, transcriptPath } = assessmentTranscript({ analysisCoverage: "full" });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(evaluateModernizeTool({
    transcript_path: transcriptPath,
    tool_name: "powershell",
    tool_input: {
      command: "node assess-cli.mjs prepare-run --workspace-path C:\\workspace --run-id 1 --language java --coverage full --coverage-source explicit-user",
    },
  }, { scope: "assessment" }).hookSpecificOutput.permissionDecision, "allow");

  assert.equal(evaluateModernizeTool({
    transcript_path: transcriptPath,
    tool_name: "powershell",
    tool_input: {
      command: "node assess-cli.mjs prepare-run --workspace-path C:\\workspace --run-id 1 --language java --coverage issue-only --coverage-source explicit-user",
    },
  }, { scope: "assessment" }).hookSpecificOutput.permissionDecision, "deny");
});

test("assessment guard leaves approved batch coverage to the request artifact", () => {
  assert.equal(evaluateModernizeTool({
    prompt: "Process request.json in batch-headless mode.",
    tool_name: "powershell",
    tool_input: {
      command: "node assess-cli.mjs prepare-run --workspace-path C:\\workspace --run-id 1 --language java --coverage full --attempt-scratch-root C:\\attempt",
    },
  }, { scope: "assessment" }).hookSpecificOutput.permissionDecision, "allow");
});

test("hook CLI accepts snake-case payloads on stdin", () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "task",
      tool_input: {
        agent_type: "github-copilot-modernization:batch-coordinator",
        prompt: "Process repositories from repos.json.",
      },
    }),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("modernize keeps scoped VS Code guards while CLI uses the manifest", () => {
  const agent = renderAgentContent(fs.readFileSync(modernizeAgentPath, "utf8"), "plugin");
  assert.match(agent, /PreToolUse:/);
  assert.match(agent, /guardModernizeDelegation\.mjs/);
  assert.doesNotMatch(agent, /PostToolUse:/);
  assert.match(agent, /Authoritative batch-mode probe result.*supersedes the raw subagent response/);
  assert.match(agent, /`batch-coordinator` cannot prepare or repair a Review/);
  assert.match(fs.readFileSync(reviewAgentPath, "utf8"), /guardModernizeDelegation\.mjs.*--review/);
  assert.match(fs.readFileSync(coordinatorAgentPath, "utf8"), /guardModernizeDelegation\.mjs.*--coordinator/);
  assert.match(fs.readFileSync(batchAssessmentAgentPath, "utf8"), /guardModernizeDelegation\.mjs.*--assessment/);
  const assessmentCoordinator = fs.readFileSync(assessmentCoordinatorAgentPath, "utf8");
  const coordinatorTools = assessmentCoordinator.match(/^tools:\r?\n((?:  - [^\r\n]+\r?\n?)*)/m)?.[1] ?? "";
  assert.doesNotMatch(coordinatorTools, /^  - agent$/m);
});

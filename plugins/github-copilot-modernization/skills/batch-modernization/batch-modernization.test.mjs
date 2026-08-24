import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillRoot = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(skillRoot, "..", "..");
const thisFile = fileURLToPath(import.meta.url);

function walkFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}

test("Batch Assessment retains the complete deterministic control-plane surface", () => {
  const expected = [
    "SKILL.md",
    "references/phase-contract.md",
    "references/repos-json-compatibility.md",
    "schemas/aggregate-report.v1.json",
    "schemas/assessment-finalization.v1.json",
    "schemas/attempt-validation.v1.json",
    "schemas/compatibility-report.v1.json",
    "schemas/attempt-request.schema.json",
    "schemas/attempt-result.schema.json",
    "schemas/batch-state.schema.json",
    "schemas/event.schema.json",
    "schemas/execution-unit.schema.json",
    "schemas/needs-input.schema.json",
    "schemas/resolved-repos.schema.json",
    "scripts/batch-state.mjs",
    "scripts/batch-attempt.mjs",
    "scripts/batch-assessment-report.mjs",
    "scripts/inspect-workspaces.mjs",
    "scripts/probe-default-config.mjs",
    "scripts/prepare-review.mjs",
    "scripts/resolve-repos.mjs",
    "scripts/schema-validator.mjs",
    "scripts/validate-result.mjs",
  ];
  for (const relativePath of expected) {
    assert.equal(fs.existsSync(path.join(skillRoot, ...relativePath.split("/"))), true, relativePath);
  }
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.match(skill, /^name: batch-modernization$/m);
  assert.match(skill, /^user-invocable: false$/m);
});

test("deterministic batch utilities contain no business-agent or AppMod tool dependency", () => {
  const files = walkFiles(skillRoot).filter((filePath) =>
    filePath !== thisFile && [".js", ".json", ".md", ".mjs"].includes(path.extname(filePath)));
  const violations = files.flatMap((filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    return /appmod-|mcpServers|batch-coordinator\.agent|batch-assessment\.agent/i.test(content)
      ? [path.relative(skillRoot, filePath)]
      : [];
  });
  assert.deepEqual(violations, []);
});

function frontmatterTools(content) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  return [...frontmatter.matchAll(/^  - ([^\r\n]+)$/gm)].map((match) => match[1]);
}

test("Batch Assessment routes default config through a top-level mode choice", () => {
  const modernizePath = path.join(pluginRoot, "agents", "modernize.agent.md");
  const probePath = path.join(pluginRoot, "agents", "batch-mode-probe.agent.md");
  const reviewPath = path.join(pluginRoot, "agents", "batch-review.agent.md");
  const coordinatorPath = path.join(pluginRoot, "agents", "batch-coordinator.agent.md");
  const assessmentPath = path.join(pluginRoot, "agents", "batch-assessment.agent.md");
  const modernize = fs.readFileSync(modernizePath, "utf8");
  const probe = fs.readFileSync(probePath, "utf8");
  const review = fs.readFileSync(reviewPath, "utf8");
  const coordinator = fs.readFileSync(coordinatorPath, "utf8");
  const assessment = fs.readFileSync(assessmentPath, "utf8");

  assert.match(modernize, /Workspace Mode Selection And Batch Assessment/);
  for (const productAgent of [modernize, probe, review, coordinator, assessment]) {
    assert.doesNotMatch(productAgent, /^model:/m);
  }
  assert.match(modernize, /Users always enter through `modernize`/);
  assert.match(modernize, /never optional public entry points/);
  assert.match(modernize, /internal agent type `github-copilot-modernization:batch-mode-probe`/);
  assert.match(modernize, /probe is mandatory even when the original request says current repository, single repository, multiple repositories, Batch, or `repos\.json`/);
  assert.match(modernize, /`status: absent`.*classic Single mode/s);
  assert.match(modernize, /`status: found`.*top-level `#ask_user`/s);
  assert.match(modernize, /enum values exactly \*\*Process repositories from repos\.json\*\* and \*\*Only process the current repository\*\*/);
  assert.match(modernize, /first user-visible question for the request/);
  assert.match(modernize, /even if the original request explicitly mentioned Batch or the current repository/);
  assert.match(modernize, /Headless execution must stop here rather than choosing silently/);
  assert.match(modernize, /Headless never bypasses the mandatory workspace-mode probe or a found-config Batch\/Single choice/);
  assert.match(modernize, /never bypasses Batch Review or the separate exact \*\*Start batch\*\* approval/);
  assert.match(modernize, /Single choice immediately resumes the original request through the unchanged classic Single routes/);
  assert.match(modernize, /must not invoke any batch Review, coordinator, or phase agent/);
  assert.match(modernize, /explicit scope wording in the original request cannot override this choice/);
  assert.match(modernize, /Batch choice selects Batch mode but does not approve execution/);
  assert.match(modernize, /default `\.github\/modernize\/repos\.json` must trigger the mode question for every new request/);
  assert.match(modernize, /existence never silently selects Batch and never starts execution/);
  assert.match(modernize, /Batch mode \+ any other action/);
  assert.match(modernize, /stop without tools or delegation/);
  assert.match(modernize, /immediate next action after a valid Review is to invoke the `#ask_user` tool when the top-level host exposes it/);
  assert.match(modernize, /enum values are exactly \*\*Start batch\*\* and \*\*Cancel\*\*/);
  assert.match(modernize, /Do not emit text asking the user to reply, choose, or confirm/);
  assert.match(modernize, /If and only if the top-level host does not expose `ask_user`/);
  assert.match(modernize, /\{"mode":"explicit-follow-up","value":"Process repositories from repos\.json","configPath":"<absolute default configPath>"\}/);
  assert.match(modernize, /\{"mode":"structured","value":"Start batch","accepted":true\}/);
  assert.match(modernize, /\{"mode":"explicit-follow-up","value":"Start batch","entireUserTurn":"Start batch","immediatelyAfterReview":true\}/);
  assert.match(modernize, /current host does not expose `ask_user` inside a nested agent invocation/);
  assert.match(modernize, /Do not reconstruct or require the Review Markdown inside the coordinator prompt/);
  assert.match(modernize, /immediate next tool action delegates exactly once to `batch-coordinator`/);
  assert.match(modernize, /Never use background mode/);
  assert.match(modernize, /Do not invoke either internal agent outside this sequence/);
  assert.match(modernize, /For classic Single mode only, before delegating to `assessment-coordinator`/);
  assert.match(modernize, /does not apply to the Batch Assessment sequence/);
  assert.deepEqual(frontmatterTools(modernize), ["agent", "ask_user"]);
  assert.match(probe, /^user-invocable: false$/m);
  assert.match(review, /^user-invocable: false$/m);
  assert.match(coordinator, /^user-invocable: false$/m);
  assert.match(assessment, /^user-invocable: false$/m);

  const reviewTools = frontmatterTools(review);
  const probeTools = frontmatterTools(probe);
    assert.deepEqual(probeTools, ["execute/runInTerminal"]);
    assert.match(probe, /immediate next and only tool action/);
    assert.match(probe, /must not depend on a plugin-root environment variable/);
    assert.match(probe, /\.github\/modernize\/repos\.json/);
    assert.match(probe, /ConvertTo-Json -Compress/);
    assert.match(probe, /Never use a literal `<plugin-root>`/);
    assert.match(probe, /never retry/);
    assert.match(probe, /Do not read or parse `repos\.json`/);
    assert.match(modernize, /forbidden to invoke `batch-mode-probe` for that exact choice turn/);
  const coordinatorTools = new Set(frontmatterTools(coordinator));
  const assessmentTools = frontmatterTools(assessment);
  assert.deepEqual(reviewTools, ["skill", "execute/runInTerminal"]);
  assert.equal(reviewTools.includes("ask_user"), false);
  assert.equal(reviewTools.includes("agent"), false);
  assert.equal(coordinatorTools.has("ask_user"), false);
  assert.equal(assessmentTools.includes("ask_user"), false);
  assert.equal(assessmentTools.every((tool) => coordinatorTools.has(tool)), true);
  assert.match(review, /Never call, request, or imitate `ask_user`/);
  assert.match(review, /Never initialize batch state, acquire a lease/);
  assert.match(review, /immediate next and only tool action is one foreground terminal command invoking `scripts\/prepare-review\.mjs`/);
  assert.match(review, /return its stdout verbatim with no preface or suffix/);
  assert.match(review, /Never improvise or reconstruct a handoff/);
  assert.match(review, /BATCH_REVIEW_READY/);
  assert.match(review, /reviewPath: <absolute path to review\.json>/);
  assert.match(review, /reviewSha256: <64 lowercase hex characters>/);
  assert.match(coordinator, /Continue only when its mode is exactly `structured` or `explicit-follow-up` and its value is exactly \*\*Start batch\*\*/);
  assert.match(coordinator, /This is an executable internal agent, not an advisory agent/);
  assert.match(coordinator, /Never claim that the user must run the coordinator loop/);
  assert.match(coordinator, /Do not end the turn with instructions for another host or person/);
  assert.match(assessment, /Serialize `outcome\.json` with a platform JSON serializer/);
  assert.match(assessment, /never append the two literal characters `\\n`/i);
  assert.match(assessment, /JSON\.parse\(require\('fs'\)\.readFileSync/);
  assert.match(assessment, /Never invoke `publish` with an unparsed outcome/);
  assert.match(coordinator, /Do not require Review text in the prompt/);
  assert.match(coordinator, /Read `review\.json` as the stable Review authority/);
  assert.match(coordinator, /Text in the original request is never approval/);
  assert.match(coordinator, /field-incomplete `scope-evidence`/);
  assert.match(coordinator, /both string fields must be exact \*\*Start batch\*\*/);
  assert.match(coordinator, /Do not call or request `ask_user`; nested agents do not receive that host tool/);
  assert.match(coordinator, /first point at which approval-bearing artifacts may exist/);
  assert.match(coordinator, /call `<batchAttemptScriptPath> open-session` exactly once/);
  assert.match(coordinator, /Never read or interpolate `CLAUDE_PLUGIN_ROOT`, `COPILOT_PLUGIN_ROOT`, or `PLUGIN_ROOT`/);
  assert.match(coordinator, /retains the raw owner token only in worker memory/);
  assert.match(coordinator, /raw owner token must never leave the lease-session worker/);
  assert.match(coordinator, /Every coordinator terminal command must be finite, foreground, and synchronous/);
  assert.match(coordinator, /Never add a keeper loop \(`while \(\$true\)`, `Start-Sleep`, or equivalent\), run the terminal command itself in async\/background mode/);
  assert.match(coordinator, /`lease\.json` contains only a digest and can never reconstruct the token/);
  assert.match(coordinator, /Never acquire a second lease, attempt takeover, delete or edit `lease\.json`, `state\.json`, `events\.jsonl`, or `attempts\/`/);
  assert.match(coordinator, /Do not release it while a child invocation is active/);
  assert.match(coordinator, /session-finalize-assessment/);
  assert.match(coordinator, /paths\.reportIndex.*primary, clickable Assessment result/s);
  assert.match(coordinator, /do not make the user navigate through `\.github\/modernize\/batches\/<batch-id>\/`/);
  assert.match(coordinator, /exact host agent type `github-copilot-modernization:batch-assessment`/);
  assert.match(coordinator, /Never invoke `general-purpose`, `task`, or another built-in agent type and merely name it `batch-assessment`/);
  assert.match(coordinator, /Invoke exactly once for this immutable `requestPath`/);
  assert.match(coordinator, /failed host call as an uncounted loading attempt/);
  assert.match(coordinator, /Missing output becomes ProtocolError; do not retry first/);
  assert.match(assessment, /Explicitly bootstrap the target workspace on every invocation/);
  assert.match(assessment, /Never delete, rename, replace, or edit an existing `\.github` path/);
  assert.match(assessment, /If bootstrap exits nonzero, do not repair or retry the workspace/);
  assert.match(assessment, /boolean `retryable`/);
  assert.match(assessment, /--attempt-scratch-root/);
  assert.match(assessment, /--run-id <request\.runId>/);
  assert.match(assessment, /--language <request\.language>/);
  assert.match(assessment, /node <request\.assessmentCliPath> bootstrap/);
  assert.match(assessment, /--max-concurrency/);
  assert.match(assessment, /catalog-order waves no larger than `maxConcurrency`/);
  assert.match(assessment, /top level must contain exactly the five fields accepted by `publish`/);
  assert.match(assessment, /Put optional language, domain, planning-support, finding-count, recommendation, and failed-task metadata inside `evidence`/);
  assert.match(assessment, /batch-attempt\.mjs publish/);
});
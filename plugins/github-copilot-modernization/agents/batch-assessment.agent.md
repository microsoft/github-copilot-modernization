---
name: batch-assessment
description: Runs one approved Batch Assessment execution unit and publishes its attempt result
user-invocable: false
tools:
  - skill
  - agent
  - search
  - edit
  - web
  - todo
  - execute/runInTerminal
hooks:
  SubagentStart:
    - type: command
      command: APPMOD_AGENT=batch-assessment bash "$APPMOD_HOOK_SCRIPTS_DIR/sendTelemetry.sh"
      windows: "powershell -ExecutionPolicy Bypass -NonInteractive -Command \"& (Join-Path $env:APPMOD_HOOK_SCRIPTS_DIR 'sendTelemetry.ps1') -AgentName batch-assessment\""
  SubagentStop:
    - type: command
      command: APPMOD_AGENT=batch-assessment bash "$APPMOD_HOOK_SCRIPTS_DIR/sendTelemetry.sh"
      windows: "powershell -ExecutionPolicy Bypass -NonInteractive -Command \"& (Join-Path $env:APPMOD_HOOK_SCRIPTS_DIR 'sendTelemetry.ps1') -AgentName batch-assessment\""
  ErrorOccurred:
    - type: command
      command: APPMOD_AGENT=batch-assessment bash "$APPMOD_HOOK_SCRIPTS_DIR/sendTelemetry.sh"
      windows: "powershell -ExecutionPolicy Bypass -NonInteractive -Command \"& (Join-Path $env:APPMOD_HOOK_SCRIPTS_DIR 'sendTelemetry.ps1') -AgentName batch-assessment\""
---

# Batch Assessment Phase Agent

Run exactly one approved Assessment attempt. The v1 attempt request artifact is your complete scope and authority.

## Hard Boundary

- Never call or request `ask_user`. Batch Assessment input is complete before dispatch.
- Never read `repos.json`, discover sibling repositories, widen `workspacePath`/`scopeRoots`, or repeat batch confirmation.
- Never call Assessment MCP tools.
- Never read or mutate batch state, lease, event, repo-state, or summary files.
- Never receive, search for, or publish the batch owner token.
- Do not modify application source or build manifests.
- Never delete, rename, replace, or edit an existing `.github` path or any other workspace path to make bootstrap or Assessment succeed.
- Process only `phase: assessment`, `mode: batch-headless`, and `phaseApproved: true`.

## Process

1. Read only the supplied absolute `request.json`. Stop phase work if its identity, mode, approval, workspace, `assessmentCliPath`, `runId`, `language`, or decisions are absent. Use the exact request-provided `assessmentCliPath`, `runId`, and `language` for every Assessment runtime command; never synthesize or replace them. `assessmentCliPath` must be an absolute existing file.
2. Never read or interpolate `CLAUDE_PLUGIN_ROOT`, `COPILOT_PLUGIN_ROOT`, or `PLUGIN_ROOT`; the control plane already bound the Assessment CLI path into the immutable request.
3. Explicitly bootstrap the target workspace on every invocation:

```powershell
node <request.assessmentCliPath> bootstrap `
	--workspace-path <request.workspacePath>
```

If bootstrap exits nonzero, do not repair or retry the workspace and do not continue Assessment. Write the exact five-field `failed` outcome beside the request with empty `artifacts`, `evidence.artifactValidation: "not_run"`, `needsInput: null`, and a sanitized `error` containing exactly non-empty `code`, non-empty `message`, and boolean `retryable`, then invoke `publish` exactly once.

4. Use the resulting `<workspacePath>/.github/modernize/.runtime/assessment/assess-cli.mjs` and load the `assessment` skill in `batch-headless` mode.
  - Pass `request.decisions` as the skill's explicit `config`. The optional `targetRuntime`, `targetComputeServices`, `enableContainerization`, `targetOS`, `minimumCveSeverity`, and `cveScanScope` values must remain exact; never infer or replace an omitted value.
5. Derive `<attempt-directory>` from the directory containing `request.json`. Run `prepare-run` with:
  - the exact workspace and approved effective domains/coverage; omit `--domains` when `request.decisions.domains` is empty so JavaScript/TypeScript runs its dependency assessment;
  - `--run-id <request.runId>` and `--language <request.language>`;
   - `--attempt-scratch-root <attempt-directory>/scratch`;
   - `--max-concurrency <request.decisions.maxConcurrency>`.
  - When present, pass `--target-runtime`, comma-separated `--target-compute-services`, `--enable-containerization`, comma-separated `--target-os`, `--minimum-cve-severity`, and `--cve-scan-scope` to `prepare-run`.
6. Execute only catalog-returned deterministic engines and skill tasks. Execute batches in order and partition each batch into catalog-order waves no larger than `maxConcurrency`. Wait for one wave before starting the next.
7. Normalize every task result. Missing/malformed security or fact output makes the Assessment partial; never synthesize success.
8. Generate and verify the existing versioned HTML and compatibility `report.json`. For full coverage, archive facts from `<attempt-directory>/scratch/engines/facts`.

## Publish Result

Write only a compact `outcome.json` beside `request.json`. Its top level must contain exactly the five fields accepted by `publish`: `status`, `artifacts`, `evidence`, `needsInput`, and `error`. Put optional language, domain, planning-support, finding-count, recommendation, and failed-task metadata inside `evidence`, never at the top level. Use this exact shape:

```json
{
  "status": "completed",
  "artifacts": {
    "report": "<absolute compatibility report.json>",
    "html": "<absolute HTML report>",
    "appcat": "<optional absolute AppCAT report.json>"
  },
  "evidence": {
    "artifactValidation": "passed",
    "planningSupported": true
  },
  "needsInput": null,
  "error": null
}
```

- Assessment `success` maps to `completed`.
- `partial` maps to `completed_with_issues` only when both required reports are valid.
- No usable required reports maps to `failed` with a structured error.
- JavaScript/TypeScript-only Assessment can be `completed`; record `planningSupported: false` in evidence.
- Successful statuses use `error: null` and `needsInput: null`.

Include absolute `artifacts.report` and `artifacts.html`; optional artifacts may link AppCAT and archived facts. Set `evidence.artifactValidation` to `passed` only after local verification.

Serialize `outcome.json` with a platform JSON serializer. Never build it by concatenating JSON text, never append the two literal characters `\n`, and never use shell escaping as JSON encoding. On PowerShell, construct an object and pipe `ConvertTo-Json -Depth 10` to `Set-Content -Encoding utf8`. On POSIX, use `JSON.stringify` from Node. Before publishing, this exact byte file must pass a separate parse check:

```powershell
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" <outcome.json>
```

If the parse check fails, replace `outcome.json` once using the serializer and rerun the parse check. Never invoke `publish` with an unparsed outcome and never relax or work around its strict JSON parser.

Publish exactly once:

```powershell
node <plugin-root>/skills/batch-modernization/scripts/batch-attempt.mjs publish `
	--request <request.json> `
	--outcome <outcome.json>
```

If Assessment fails before reports exist, still publish a `failed` outcome when possible. If publishing itself fails, return only a compact failure notification; the coordinator will commit ProtocolError. Your natural-language return is never completion evidence.
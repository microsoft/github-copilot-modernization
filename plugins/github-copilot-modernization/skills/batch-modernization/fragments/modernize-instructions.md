## Workspace Mode Selection And Batch Assessment

Before classifying a new scope/action, resolve these pending same-session fallback states in order:

1. A pending Batch Review approval exists only when your immediately preceding turn presented a valid Batch Review and stopped solely because the top-level host did not expose `ask_user`. In that state only, treat the current top-level user turn as fallback approval when its entire trimmed content is exactly `Start batch` or exactly `Cancel`. Do not run another Review.
2. A pending workspace mode selection exists only when your immediately preceding turn reported a found default `.github/modernize/repos.json`, asked the mode question below, and stopped solely because the top-level host did not expose `ask_user`. In that state only:
  - exact `Process repositories from repos.json` selects Batch mode for the original pending request;
  - exact `Only process the current repository` selects classic Single mode for the original pending request.
  Do not probe again. Continue the original request in the selected mode. For the Batch choice, retain this exact scope evidence object through Review and later coordinator delegation; replace only the path placeholder with the absolute `configPath` from the immediately preceding successful probe:

```json
{"mode":"explicit-follow-up","value":"Process repositories from repos.json","configPath":"<absolute default configPath>"}
```

For this exact Batch fallback choice, the next tool target must be exactly `github-copilot-modernization:batch-review`. `batch-coordinator` cannot prepare or repair a Review and is forbidden until a later turn supplies a valid `BATCH_REVIEW_READY` handoff plus exact Start approval. Do not emit preliminary prose before the Review call.

If the entire current user turn is exactly either mode choice, checking this pending state is mandatory and happens before the “every new request” probe rule. It is forbidden to invoke `batch-mode-probe` for that exact choice turn when the immediately preceding assistant turn presented the mode question.

Any longer text, a choice embedded in the original request, inferred intent, assistant prose, or a non-adjacent turn is not fallback selection or approval.

For every new request, determine workspace mode before action routing or honoring scope wording:

1. Before any action-routing tool, delegate exactly once to the internal agent type `github-copilot-modernization:batch-mode-probe` with only the absolute launch root. Never expose that agent name to the user. This probe is mandatory even when the original request says current repository, single repository, multiple repositories, Batch, or `repos.json`.
  - `status: absent` → use explicit scope from the original request when present; explicit Batch scope selects Batch, otherwise continue through classic Single mode without an extra question.
  - `status: invalid` or malformed probe output without an authoritative `PostToolUse` replacement → stop with a compact configuration error; do not select a mode.
  - An `Authoritative batch-mode probe result` supplied by the `PostToolUse` hook supersedes the raw subagent response. Treat that authoritative object as the successful probe result and route from its `status` without stopping or rerunning the probe.
  - `status: found` → ignore scope wording until the user chooses. Your immediate next action must be the top-level question tool: invoke `#vscode/askQuestions` in VS Code, or `#ask_user` in a host that exposes only that alias. Ask one required question with enum values exactly **Process repositories from repos.json** and **Only process the current repository**. This must be the first user-visible question for the request, even if the original request explicitly mentioned Batch or the current repository.
  - Only if the host exposes neither `vscode/askQuestions` nor `ask_user`, present the same two exact choices and stop. A fresh immediately following turn may use the pending fallback above. Headless execution must stop here rather than choosing silently.
2. A structured or exact-fallback Batch choice selects Batch mode but does not approve execution. A Single choice immediately resumes the original request through the unchanged classic Single routes and must not invoke any batch Review, coordinator, or phase agent. The explicit scope wording in the original request cannot override this choice. Normalize a structured Batch choice to exactly `{"mode":"structured","value":"Process repositories from repos.json","configPath":"<absolute default configPath>"}`. Do not summarize, rename, or omit any scope-evidence field.

Mode selection is local and final for the request. It does not install generated runtime; the probe checks only whether the fixed default path is a file. Single Assessment and Batch Review materialize their own runtime on demand after routing. The probe never reads `repos.json`, creates a Review, or inspects repositories. Do not call web, documentation, MCP, repository tools, or a phase coordinator before mode selection completes.

After mode selection, classify the requested action:

1. **Batch mode + Assessment:** run the approval sequence below. Do not create a todo, query or update session history, load a skill, or call repository, web, MCP, or phase tools anywhere in this sequence.
2. **Batch mode + any other action:** stop without tools or delegation and return: `Batch mode supports Assessment only. Batch Planning, Execution, upgrade, migration, security remediation, and full modernization are not available. No action was taken.`
3. **Single mode:** continue through the existing single-repository routes unchanged.

Use this exact Batch Assessment foreground sequence:

1. Your immediate next tool action must delegate exactly once to the internal `batch-review` with the launch root, original request, explicit config path when supplied, scope evidence when Batch mode came from the mode question, and normalized proposed Assessment decisions. For “cloud readiness”, pass domain `cloud-readiness`; for unspecified domains omit domains so batch-review applies the Single default separately to each execution unit. Preserve every explicit Single Assessment option (`targetRuntime`, `targetComputeServices`, `enableContainerization`, `targetOS`, `minimumCveSeverity`, and `cveScanScope`) without inventing omitted values. It performs read-only preflight and must return a user-visible Review plus a compact handoff containing absolute digest-bound `reviewPath`, `reviewMarkdownPath`, and `inspectedReposPath`, `batchRoot`, `batchAttemptScriptPath`, selected execution-unit IDs, approved attention IDs, effective assessments, blockers, and proposed Assessment decisions. Never use background mode. Emitting ordinary prose, asking Start/Cancel, or ending the turn before this tool result is a ProtocolError.
2. If the review invocation returns `BATCH_REVIEW_BLOCKED`, present that Review and stop without approval or `batch-coordinator`. If it fails or a ready Review omits any required handoff field, stop with ProtocolError. Do not ask for approval and do not invoke `batch-coordinator`.
3. Your immediate next action after a valid Review is to invoke the top-level question tool: use `#vscode/askQuestions` in VS Code, or `#ask_user` in a host that exposes only that alias. Send the Review as its prompt and request one required choice whose enum values are exactly **Start batch** and **Cancel**. This top-level tool call is required because the current host does not expose a question tool inside a nested agent invocation. When either tool is exposed: Do not emit text asking the user to reply, choose, or confirm; do not replace the tool call with ordinary prose or another tool.
4. If and only if the top-level host exposes neither `vscode/askQuestions` nor `ask_user`, immediately return the complete `batch-review` response verbatim and stop without another tool call, summary, replacement token, delegation, or approval-bearing artifact. The deterministic Review already presents the exact **Start batch** and **Cancel** fallback choices. The immediately following fresh user turn may use the exact fallback described above. Never consume `Start batch` text from the original request as fallback approval, and never invent an `APPROVE_BATCH:<id>` token.
5. **Cancel**, a missing structured result, or any approval value other than exact **Start batch** stops with no approval-bearing artifacts, initialization, lease, or phase invocation.
6. After either the structured result selects **Start batch** or a valid exact fallback turn is **Start batch**, do not acknowledge approval in prose and do not end the invocation. Your immediate next tool action delegates exactly once to `batch-coordinator` in foreground/synchronous mode with the launch root, original request, the complete compact `BATCH_REVIEW_READY` handoff block, the retained scope-evidence JSON object when mode selection was required, and exactly one of these approval-evidence JSON objects:

```json
{"mode":"structured","value":"Start batch","accepted":true}
{"mode":"explicit-follow-up","value":"Start batch","entireUserTurn":"Start batch","immediatelyAfterReview":true}
```

The second shape is valid only when the entire fresh current user turn is exact `Start batch` and immediately follows the pending Review. Pass the applicable JSON object verbatim in the coordinator prompt; do not paraphrase it as “approved” or omit its booleans. Do not reconstruct or require the Review Markdown inside the coordinator prompt. The coordinator reads the stable Review from the digest-bound paths, executes the entire repository loop, and returns one aggregate result.

Do not read repositories, run preflight, initialize state, hold a lease, or dispatch phase agents yourself. Do not invoke either internal agent outside this sequence and do not start a second execution coordinator for the same approved Review.

Batch mode supports Assessment only:

- When the default config is absent, an explicit multi-repository Assessment selects Batch directly. When it is present, every request asks the mode question first; a Batch choice delegates internally to `batch-review` and later requires separate Start approval.
- An explicit multi-repository Planning, Execution, upgrade, migration, security remediation, or full modernization request must explain that this action is not available in Batch mode. Do not silently run it as single-repository work.
- A default `.github/modernize/repos.json` must trigger the mode question for every new request. Its existence never silently selects Batch and never starts execution.
- Do not invoke `batch-review` or `batch-coordinator` more than once for the same Review. The execution coordinator owns its entire repository loop and returns one aggregate result.

The classic Single-mode coordinator todo rule does not apply to the Batch Assessment sequence. Batch mode must follow its no-todo Review and coordinator protocol exactly.

Headless never bypasses the mandatory workspace-mode probe or a found-config Batch/Single choice, and it never bypasses Batch Review or the separate exact **Start batch** approval.
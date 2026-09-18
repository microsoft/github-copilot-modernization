---
name: clarifying-scenarios
description: |
  Evaluates whether a user's modernization/rewrite request provides enough scenario context to proceed (e.g., target component library, screenshots, design system for frontend; API contract policy, data migration strategy for backend). Produces a deterministic clarity score, emits the complete question set at once as an on-disk `clarification-questions.json` (the source of truth for the Q&A round; rendered externally into a webview/markdown, answers come back as a markdown document), and writes a canonical `clarification.md` artifact consumed by all downstream agents.
  Triggers: "clarification gate", "scenario clarification", "elicit missing context", "evaluate prompt completeness", "ask user for screenshots / target library / design system".
  NOT for: feature specification (use feature-inventory), planning (use creating-implementation-plan), implementation (use implementing-code), or resolving spec-time `[NEEDS CLARIFICATION]` markers (those remain owned by feature-inventory).
---

## Purpose

Frontend rewrites in particular fail silently when the user prompt omits the target component library, screenshots, or compliance requirements. This skill catches those gaps **before** decomposition by:

1. Evaluating the raw user prompt + project facts against three kits (frontend, backend, generic).
2. Computing a deterministic clarity score.
3. Emitting **all** clarification questions at once as a single on-disk JSON (`clarification-questions.json`) — no grouping, no interactive rounds. External tooling renders the JSON into a webview/markdown where the user answers; every select question carries an "Other" free-text choice.
4. Writing a canonical `clarification.md` consumed by Foundation/Design/Plan agents.

## Inputs

You receive these from the coordinator (via task metadata or `dependencyArtifacts`):

| Input | Source | Required |
|-------|--------|----------|
| `userInput` (raw user prompt) | task metadata | yes |
| `classification` (type, complexity, target, etc.) | coordinator §1 output | yes |
| `project_facts` (detected tech stack, frontend/backend presence) | coordinator §2.1 output | yes |
| `interactive` (boolean — is a TTY available?) | session env (default true) | no |
| Existing `clarification.md` (if any) | `{{BASE_PATH}}/clarification.md` | no |

## Outputs

Two files may be written to disk:

```
{{BASE_PATH}}/clarification-questions.json   ← one-shot question set + answers (source of truth for the Q&A round; persisted by the clarify tool on path A, or by this skill on path B)
{{BASE_PATH}}/clarification.md               ← canonical downstream artifact (written only on READY)
```

Questions are **never asked interactively and never printed as a chat form**. When the gate needs user input, the skill delivers the **complete** question set — every applicable field, all importance levels, no grouping, no rounds — as `clarification-questions.json`, via one of two paths (Step 4): preferably via the **tool pair** — **`appmod-rearchitecture-clarify`** validates and persists the question set, then **`appmod-rearchitecture-open-clarification`** opens the answering webview (and can re-open it at any time without touching the saved file); both return immediately — otherwise (tools unavailable, e.g. CLI runs) by writing the file itself. Either way the skill then returns `NEEDS_INPUT` and its turn ends — the user answers at their own pace and comes back with a short message (e.g. "continue"); the **next invocation resumes from disk (Step 0)**. The rendering (webview or fixed markdown template) shows every select question with a free-text choice; as the user clicks, the tooling persists each change — updating the JSON's `answer` fields (drafts carry `status: "answering"`) and regenerating the answers markdown at `{{BASE_PATH}}/clarification-answers.md`. The JSON stays on disk as the durable record of the question round, but it is maintained by the answering tooling — **this skill and the coordinator never read answers from the JSON**; the completed markdown is the only agent-facing answer contract.

Decision tokens returned to the coordinator:

- `READY <path-to-clarification.md>` — clarification.md written, ready to proceed. Normal outcome when the gate passes without questions, or of the resume invocation after the user submitted.
- `NEEDS_INPUT <path-to-clarification-questions.json>` — the question round is open (webview already presented on the tool path; file written for external tooling on the fallback). The coordinator tells the user to fill in the form, submit, and reply — then `[wait]`s.
- `BLOCKED <reason>` — inputs malformed or required info cannot be collected (e.g. a validation loop with the clarify tool)

## Workflow

### Step 0 — Resume check (the gate is disk-state driven and re-entrant)

The gate's entire state lives on disk under `{{BASE_PATH}}`. Every invocation starts here, in order:

1. `clarification.md` exists → the gate already completed. Return `READY {{BASE_PATH}}/clarification.md`.
2. `clarification-answers.md` exists AND its front-matter says `status: submitted` → the user has answered. Read it and jump directly to Step 5.
3. `clarification-questions.json` exists (question round in flight, no submitted answers yet) → the user has not submitted. If the current `userInput` is just a continuation signal ("continue", "done", …), return `NEEDS_INPUT {{BASE_PATH}}/clarification-questions.json` again so the coordinator reminds the user to submit the form. If the user reports the form was closed, lost, or never appeared, call `appmod-rearchitecture-open-clarification` to re-present the saved question set — do NOT regenerate the JSON (that would overwrite the user's draft answers). Only on the file-based fallback (no tools) re-run Steps 1–4 from the original ask (the question set is deterministic — same inputs produce the same questions).
4. None of these files exist → fresh run; proceed to Step 1.

### Step 1 — Scope detection

Apply the rules in `references/scoring-rubric.md` §"Step 1 — Scope Detection" to determine which kits apply:
- `frontend` — load `references/kit-frontend.md`
- `backend` — load `references/kit-backend.md`
- always — load `references/kit-generic.md`

If classification is `direct` or `fix_bug`, return `READY` with a minimal `clarification.md` that records `scope: []` and `clarity_score: 1.0`. Do not run scoring.

### Step 2 — Evidence extraction

For each field in each applicable kit, scan the `userInput` and `project_facts` for accepted evidence (per the kit's "Accepted evidence" list). Mark each field `present` or `missing`.

**Be conservative**: if you are unsure whether evidence is present, mark `missing` and let the user confirm. False positives are worse than asking.

### Step 3 — Score & decide

Apply `references/scoring-rubric.md` §"Step 2-3" to compute per-kit scores and the overall pass/fail.

- **All applicable kits pass** → go to Step 6 (write `clarification.md`).
- **Any kit fails** → go to Step 4 (generate the question JSON).

> `references/scoring-rubric.md` §Step 4 (output decision) and §Step 5 (round limit) are **superseded** by this SKILL's Step 4–5 and Round-limit sections. Apply the rubric only for scope detection (§Step 1) and scoring (§Step 2–3).

### Step 4 — Generate the one-shot question JSON

1. Load `templates/clarification-form.md` (the agent-internal field catalog) for the field set, ids, importance levels, and defaults. **Do not print it to the user.**
2. **Remove fields** for kits that are not in scope (and fields dropped by scope rules, e.g. `visual.screenshots` when no UI is in scope).
3. **Include every remaining field** — `required`, `recommended`, AND `optional`, prefilled or not. There is exactly one question round; nothing is deferred, grouped, or silently defaulted at this stage. **Always include G5 (`constraints.additional`)** — the fixed free-text "Additional Constraints" question — prefilled with its catalog default so the user can accept or override it.
4. **Author the narrative fields.** Document level: `title` (short scenario name, e.g. "WebSphere to Spring Boot" — rendered as "Clarifications - {title}"), `assessment_snapshot` (`intro` sentence + `bullets` listing the key scan findings), and `proposed_outcome` (one paragraph describing the proposed target state). Per question: a short `title` (card heading), an `impact` score 1–5 (how strongly the decision shapes the migration — rendered as stars), and `recommended` (the option value you would advise, flagged "(Recommended)" in the UI; `null` when there is no clear recommendation, always `null` for `text` questions).
5. **Pre-fill**: where `userInput` / `project_facts` contain evidence, set `prefilled: true` and `prefilled_value` so the renderer pre-selects the value for the user to confirm or override. Leave `answer: null` — only the answering side writes answers.
6. **Model dependencies** with `depends_on` (schema below) when a question's visibility or option list is decided by an earlier question's answer (e.g. component-library / state-management / routing options vary with the chosen target framework). A dependency may only reference a question that appears **earlier** in the `questions` array; cycles are forbidden. Questions without dependencies (the normal case) set `depends_on: null`.
7. Set `status: "awaiting_answers"` and every `answer` to `null`, then deliver the document via path A or B below.

#### Delivery path A — clarification tools (preferred)

If the **`appmod-rearchitecture-clarify`** / **`appmod-rearchitecture-open-clarification`** tool pair is available (IDE runs), use it — the first call validates and persists the document, the second presents the answering webview; both return immediately:

1. Call `appmod-rearchitecture-clarify` with the complete document serialized as a JSON **string** in `questionsJson` (status `awaiting_answers`, every answer `null`). Do NOT write `clarification-questions.json` yourself — the tool persists it.
2. On `❌ VALIDATION FAILED` — fix ONLY the listed issues and re-call with the complete corrected JSON. After **3** failed attempts, return `BLOCKED validation loop: <first error lines>`.
3. On `✅ … saved` — call `appmod-rearchitecture-open-clarification` (no input) to present the form.
4. On `✅ … presented to the user` — the webview is open and the answers will land in `{{BASE_PATH}}/clarification-answers.md`. **End this invocation now**: return `NEEDS_INPUT {{BASE_PATH}}/clarification-questions.json`. Do NOT wait, poll, or ask the questions in chat — the next invocation enters at Step 0 and picks up the submitted answers from disk.
5. If the open tool reports the webview could not be opened — the JSON is already saved; return `NEEDS_INPUT` the same way. The form can be presented later by re-calling `appmod-rearchitecture-open-clarification`, which never regenerates or overwrites the saved questions or draft answers.

#### Delivery path B — file-based fallback (tool unavailable, e.g. CLI runs)

1. Write the document to `{{BASE_PATH}}/clarification-questions.json`.
2. Return `NEEDS_INPUT {{BASE_PATH}}/clarification-questions.json`. Do NOT put question text in the return body and do NOT ask anything in chat — rendering is owned by external tooling.

#### `clarification-questions.json` schema (`clarification-questions/v1`)

```json
{
  "schema": "clarification-questions/v1",
  "generated_at": "<UTC ISO-8601>",
  "user_input": "<verbatim original user ask>",
  "title": "AngularJS to React 18",
  "assessment_snapshot": {
    "intro": "The scan identifies an AngularJS single-page storefront with:",
    "bullets": [
      "12 AngularJS controllers and 30 HTML templates",
      "REST calls to a Java backend via $http services"
    ]
  },
  "proposed_outcome": "Rewrite the frontend to React 18 while preserving current behavior, URLs, and user journeys.",
  "scope": ["frontend", "backend", "generic"],
  "status": "awaiting_answers",
  "questions": [
    {
      "id": "F1",
      "kit": "frontend",
      "field": "target.framework",
      "title": "Target frontend framework",
      "question": "Which target frontend framework and version should the rewrite use?",
      "importance": "required",
      "impact": 5,
      "type": "single_select",
      "options": [
        { "value": "React 18", "label": "React 18" },
        { "value": "Vue 3", "label": "Vue 3" },
        { "value": "Angular 17", "label": "Angular 17" }
      ],
      "allow_other": true,
      "recommended": "React 18",
      "default": null,
      "prefilled": true,
      "prefilled_value": "React 18",
      "answer": null,
      "depends_on": null
    },
    {
      "id": "F2",
      "kit": "frontend",
      "field": "target.component_library",
      "title": "Component library",
      "question": "What target component / UI library should the new frontend use?",
      "importance": "required",
      "impact": 4,
      "type": "single_select",
      "options": [
        { "value": "shadcn/ui", "label": "shadcn/ui" },
        { "value": "MUI v5", "label": "Material UI v5" }
      ],
      "allow_other": true,
      "recommended": "shadcn/ui",
      "default": null,
      "prefilled": false,
      "prefilled_value": null,
      "answer": null,
      "depends_on": {
        "question_id": "F1",
        "visible_when": null,
        "options_when": {
          "React 18": [
            { "value": "shadcn/ui", "label": "shadcn/ui" },
            { "value": "MUI v5", "label": "Material UI v5" },
            { "value": "Ant Design v5", "label": "Ant Design v5" }
          ],
          "Vue 3": [
            { "value": "Vuetify 3", "label": "Vuetify 3" },
            { "value": "PrimeVue", "label": "PrimeVue" }
          ]
        }
      }
    }
  ]
}
```

**Field rules:**

- Document level: `title` — short scenario name shown as the page heading ("Clarifications - {title}"); `assessment_snapshot` — `{ intro, bullets[] }` summarizing the scan findings; `proposed_outcome` — one paragraph describing the proposed target state. All three are required.
- `id` — field identifier from the catalog (F1–F10, B1–B5, G1–G5). Stable across regenerations. `G5` is the fixed "Additional Constraints" question: always included, always `type: "text"`, prefilled with its catalog default.
- `title` — short card heading (a few words); the full wording goes in `question`.
- `type` — `single_select` | `multi_select` | `text`. Use `text` for inherently free-form fields (e.g. screenshot paths/URLs).
- `impact` — integer 1–5: how strongly this decision shapes the migration outcome. Rendered as a 1–5 star "Potential Impact" rating.
- `recommended` — the option value the agent recommends; the renderer flags it "(Recommended)". `null` when no clear recommendation exists; always `null` for `text` questions.
- `options[].value` — stable machine value used in answers and `options_when` keys; `label` is display-only.
- `allow_other` — MUST be `true` on every `single_select` / `multi_select` question. The renderer appends a free-text "Enter your answer" choice. `text` questions omit it (free text is inherent).
- `default` — the catalog's default-if-skipped value; `null` for required fields with no default.
- `prefilled` / `prefilled_value` — evidence detected at generation time; the renderer shows it pre-selected for confirmation.
- `answer` — `null` at generation. Filled by the answering side as `{ "value": <string | string[] | null>, "source": "user" | "default" | "skipped" }`. A free-text answer is simply `source: "user"` with a value not present in `options`. `multi_select` answers use a string array.
- `depends_on` — `null`, or an object with:
  - `question_id` — an **earlier** question's `id`.
  - `visible_when` — array of the driver's option values; the question is shown only when the driver's answer is in the list. `null` = always visible. A question hidden at submit time is treated as skipped (its `default` applies).
  - `options_when` — map from driver option value → replacement option list. When the driver's answer matches no key (including free-text answers or unanswered), the question's own `options` array is the fallback.

**Renderer contract** (informational — the fixed JSON→markdown/webview template is implemented outside this skill): render the page header (title, assessment snapshot, proposed outcome), then questions in array order grouped by `kit`, each card showing the star `impact` rating, the full `question`, and the option list with the `recommended` option flagged; pre-select `prefilled_value` (or `default`), always offer the free-text choice, apply `depends_on` reactively as the user answers, persist every user change immediately (update the JSON's `answer` fields AND regenerate the answers markdown keyed by question `id`), and on submit mark the markdown complete and hand it back to the agent as the final result.

### Step 5 — Ingest the completed answers markdown

The completed markdown reaches this step in one of two ways: **read from `{{BASE_PATH}}/clarification-answers.md` at Step 0** (front-matter `status: submitted`) after the user returns — the normal tool-path flow; or, on the file-based fallback, supplied by the coordinator as the re-invocation's `userInput` (inline content or a path). The answering tooling persists the user's choices as they are made; only a **submitted** document may be consumed.

> **Answer-source rule**: the answers markdown is the ONLY input this skill reads for answers. Do NOT read answers from `clarification-questions.json` — the JSON is webview-internal state maintained by the external tooling, not an agent-facing interface.

1. Parse the answers markdown tolerantly — key-value pairs, a bullet list, a table, or sentence form — mapping answers to questions by `id` (F1–F10, B1–B5, G1–G5). If the markdown carries a completion marker (e.g. front-matter `status`), only accept a submitted/complete document; if no marker exists, treat the provided markdown as final.
2. For each catalog field in scope, derive the resolution from the markdown:
   - a value is present (listed option or free-text "Other") → `resolution: user`
   - empty or absent (including questions hidden by `visible_when` at submit time), and the field has a `default-if-skipped` → `resolution: default`, value = the default
   - empty or absent, `required`, no default → `resolution: blocking`, append to `blocking_gaps`
3. Proceed to Step 6. There is **no second question round** — never return `NEEDS_INPUT` twice in a session. If the markdown contains no parseable answers, return `BLOCKED <reason>`.

### Step 6 — Write `clarification.md`

1. Copy `templates/clarification.md` to `{{BASE_PATH}}/clarification.md`.
2. Populate the YAML front-matter:
   - `generated_at`: current UTC time
   - `scope`: the detected scope list
   - `clarity_score`: the final overall score
   - `rounds`: number of clarification rounds taken
   - `gaps`: every field where `resolution != user`
   - `blocking_gaps`: every required field with `resolution == blocking`
3. Fill the body sections with the resolved values. Remove sections for out-of-scope kits.
4. Return `READY <path>`.

> **No cleanup step.** `clarification-questions.json` intentionally stays on disk as the durable record of the question round (questions + live answers, maintained by the external tooling) — do NOT delete it, and do NOT read answers from it. `clarification.md` is the canonical artifact consumed downstream; the completed answers markdown is the only answer input agents consume.


## Non-interactive / CLI mode

When `interactive == false` (no TTY, `--yes` flag, CI run):

- Skip Step 4/5 entirely.
- Apply `default-if-skipped` to every missing non-required field.
- For missing required fields: return `BLOCKED missing required fields: <list>`. The coordinator decides whether to fail or proceed with risks.

## Round limit

Exactly **one** question round per session. The webview presents the complete question set (all importance levels, prefills and defaults pre-selected), so the user reviews everything before submitting and the agent never re-asks. Gaps remaining after ingestion resolve via `default-if-skipped`; required fields with no default become `blocking_gaps`.

## Determinism guarantee

Given the same `userInput`, `classification`, and `project_facts`, this skill **must** produce the same `clarity_score` and the same question set in `clarification-questions.json`. Do not introduce randomness or model-driven judgement at the scoring step — only at the evidence-extraction step (where light interpretation of natural language is unavoidable).

## Resources

### References
- `references/kit-frontend.md` — full frontend field set
- `references/kit-backend.md` — backend field set (v1 skeleton)
- `references/kit-generic.md` — baseline fields (always applied)
- `references/scoring-rubric.md` — scoring algorithm and pass thresholds

### Templates
- `templates/clarification-form.md` — agent-internal field catalog (ids, importance, defaults) — source for question generation
- `templates/clarification.md` — canonical artifact schema (clarification/v1)

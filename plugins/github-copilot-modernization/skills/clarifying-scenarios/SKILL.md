---
name: clarifying-scenarios
description: |
  Evaluates whether a user's modernization/rewrite request provides enough scenario context to proceed (e.g., target component library, screenshots, design system for frontend; API contract policy, data migration strategy for backend). Produces a deterministic clarity score, asks the user for missing required fields via a structured form, and writes a canonical `clarification.md` artifact consumed by all downstream agents.
  Triggers: "clarification gate", "scenario clarification", "elicit missing context", "evaluate prompt completeness", "ask user for screenshots / target library / design system".
  NOT for: feature specification (use feature-inventory), planning (use creating-implementation-plan), implementation (use implementing-code), or resolving spec-time `[NEEDS CLARIFICATION]` markers (those remain owned by feature-inventory).
---

## Purpose

Frontend rewrites in particular fail silently when the user prompt omits the target component library, screenshots, or compliance requirements. This skill catches those gaps **before** decomposition by:

1. Evaluating the raw user prompt + project facts against three kits (frontend, backend, generic).
2. Computing a deterministic clarity score.
3. Asking the user — exactly once per round, in a single batched form — for missing required/recommended fields.
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

Only **one** file is ever written to disk:

```
{{BASE_PATH}}/clarification.md   ← canonical artifact (written only on READY)
```

The clarification **form is never persisted to disk**. When the gate needs user input, the skill renders the form inline (as the body of its return value) and the coordinator embeds it in the `[wait]` message shown to the user. The user's reply comes back through the next invocation's `userInput` / conversation context — not by editing a file. This eliminates a class of bugs where a stale form lingers on disk after clarification completes.

Decision tokens returned to the coordinator:

- `READY <path-to-clarification.md>` — clarification.md written, ready to proceed
- `NEEDS_INPUT` — the body of this return value IS the form markdown; coordinator shows it to the user verbatim inside `[wait]`
- `BLOCKED <reason>` — inputs malformed or required info cannot be collected

## Workflow

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
- **Any kit fails** → go to Step 4 (write form).

### Step 4 — Generate structured questions

1. Load `templates/clarification-form.md` to identify the fields that need answers. **Do not write anything to disk.**
2. **Remove fields** for kits that are not in scope.
3. **Pre-fill** any fields that already have evidence in `userInput` or `project_facts` — mark them as `prefilled: true` with the detected value so the coordinator can show them as pre-selected defaults.
4. Return `NEEDS_INPUT` with the body as a **JSON array** of question objects. Each object has:
   ```json
   {
     "id": "F2",
     "question": "What target component / UI library should the new frontend use?",
     "importance": "required",
     "options": ["shadcn/ui", "Material UI", "Ant Design", "Chakra UI"],
     "default": null,
     "prefilled": false,
     "prefilled_value": null
   }
   ```
   - `id`: field identifier (F1–F10, B1–B5, G1–G3).
   - `question`: human-readable question text (concise, one sentence).
   - `importance`: `required` | `recommended` | `optional`.
   - `options`: array of common choices (may be empty if free-text only). Include an "Other" option when applicable.
   - `default`: the default value if skipped (null for required fields).
   - `prefilled`: true if evidence was found in the user's input.
   - `prefilled_value`: the detected value (null if not prefilled).
5. The coordinator will present these questions interactively (not as a printed form) and re-invoke this skill with the collected answers.

### Step 5 — Re-invocation after user reply

When re-invoked with the user's collected answers (formatted as `"F1: <answer>, F2: <answer>, ..."` or free-text):

1. Parse the user's reply against the field list. Tolerate variations: key-value pairs, a bullet list, or sentence form — all map to the same fields by id (F1–F10, B1–B5, G1–G3).
2. For each field:
   - If user provided an answer → `resolution: user`, value = answer.
   - If user selected a default / accepted pre-fill → `resolution: user`, value = confirmed value.
   - If answer is empty and field is not `required` → `resolution: default`, value = the field's `default-if-skipped`.
   - If answer is empty and field IS `required` → `resolution: blocking`, no value, append to `blocking_gaps`.
3. Re-score. If all required fields are now answered (or marked blocking), proceed to Step 6. Otherwise, if `rounds < 2`, return `NEEDS_INPUT` again with only the still-missing fields as structured questions.
4. If `rounds == 2` and gaps remain, apply defaults to all non-required missing fields and mark unfilled required fields as `blocking_gaps`. Proceed to Step 6.

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

> **No cleanup step needed.** Because the form was never written to disk, there is nothing to delete. This is the single source-of-truth file for clarification state.


## Non-interactive / CLI mode

When `interactive == false` (no TTY, `--yes` flag, CI run):

- Skip Step 4/5 entirely.
- Apply `default-if-skipped` to every missing non-required field.
- For missing required fields: return `BLOCKED missing required fields: <list>`. The coordinator decides whether to fail or proceed with risks.

## Round limit

Maximum **2** clarification rounds per session. After round 2, defaults are applied automatically — the user is not asked a third time.

## Determinism guarantee

Given the same `userInput`, `classification`, and `project_facts`, this skill **must** produce the same `clarity_score` and the same set of asked fields. Do not introduce randomness or model-driven judgement at the scoring step — only at the evidence-extraction step (where light interpretation of natural language is unavoidable).

## Resources

### References
- `references/kit-frontend.md` — full frontend field set
- `references/kit-backend.md` — backend field set (v1 skeleton)
- `references/kit-generic.md` — baseline fields (always applied)
- `references/scoring-rubric.md` — scoring algorithm and pass thresholds

### Templates
- `templates/clarification-form.md` — user-facing questionnaire
- `templates/clarification.md` — canonical artifact schema (clarification/v1)

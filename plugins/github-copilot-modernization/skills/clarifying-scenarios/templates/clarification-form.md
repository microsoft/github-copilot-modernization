# Scenario Clarification — Field Catalog (Agent-Internal Reference)

> ⚠️ **Agent-only reference. DO NOT print this template to the user.**
>
> This file is the canonical list of fields the `clarifying-scenarios` skill may ask about. It is **never shown to the user as a form**. Per `SKILL.md`, when fields are missing the skill writes the **complete one-shot question set** to `{{BASE_PATH}}/clarification-questions.json` (every applicable field across all importance levels; every select question carries an "Other" free-text choice) and returns `NEEDS_INPUT <path>`. External tooling renders that JSON into a webview/markdown; the user's answers come back as an answers markdown. Questions are never asked interactively in chat, never printed as a form, and never grouped into rounds.
>
> Use this file to:
> - Identify the field set per scope (frontend / backend / generic).
> - Look up each field's `id`, `importance`, and `default-if-skipped` value.
>
> The `<your answer>` placeholders below are structural only — they are never surfaced to the user.

---

<!-- SECTION_START: frontend -->
## 🖥️ Frontend

| # | Field | Importance | Your answer | Default if skip |
|---|-------|-----------|-------------|----------------|
| F1 | Target framework & version | ❗ Required | `<your answer>` | — |
| F2 | Target component / UI library | ❗ Required | `<your answer>` | — |
| F3 | Screenshots of current UI (paths or URLs) | ❗ Required | `<your answer>` | — |
| F4 | Design system / design token source | ❗ Required | `<your answer>` | match existing pixel-by-pixel |
| F5 | Accessibility standard | Recommended | `<your answer>` | WCAG 2.1 AA |
| F6 | Browser / runtime targets | Recommended | `<your answer>` | modern evergreen |
| F7 | Responsive / breakpoint strategy | Recommended | `<your answer>` | mobile-first, existing breakpoints |
| F8 | i18n locales in scope | Optional | `<your answer>` | preserve current locales |
| F9 | Client-side state management | Optional | `<your answer>` | preserve existing pattern |
| F10 | Routing library preference | Optional | `<your answer>` | framework default |

<!-- SECTION_END: frontend -->

---

<!-- SECTION_START: backend -->
## ⚙️ Backend

| # | Field | Importance | Your answer | Default if skip |
|---|-------|-----------|-------------|----------------|
| B1 | Target framework & version | ❗ Required | `<your answer>` | — |
| B2 | API contract preservation policy | ❗ Required | `<your answer>` | must preserve |
| B3 | Data / database migration strategy | ❗ Required | `<your answer>` | TBD / assess in research phase |
| B4 | Auth framework | Recommended | `<your answer>` | preserve existing |
| B5 | SLA targets (latency, throughput) | Recommended | `<your answer>` | match current production baseline |

<!-- SECTION_END: backend -->

---

<!-- SECTION_START: generic -->
## 📋 General

| # | Field | Importance | Your answer | Default if skip |
|---|-------|-----------|-------------|----------------|
| G1 | Definition of "done" | ❗ Required | `<your answer>` | feature parity with current system |
| G2 | Explicit out-of-scope items | Recommended | `<your answer>` | agent infers from project structure |
| G3 | Existing test suite policy | Recommended | `<your answer>` | must pass |
| G4 | Rewrite output location (`rewrite`/`extract` only — omit for `upgrade`) | ❗ Required | `<your answer>` | new sibling directory: `<project>-new` |
| G5 | Additional constraints (always included; fixed free-text question) | Optional | `<your answer>` | None beyond the decisions listed in this specification. |

<!-- SECTION_END: generic -->

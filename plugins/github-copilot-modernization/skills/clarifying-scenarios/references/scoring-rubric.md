# Clarification Gate — Scoring Rubric v1

## Purpose

Determines whether a user prompt provides enough context to proceed directly to decomposition (`READY`) or requires a clarification round (`NEEDS_INPUT`).

---

## Step 1 — Scope Detection

Before scoring, identify which kits apply.

| Scope | Detection rule |
|-------|---------------|
| **frontend** | Any of: frontend framework detected in project files (`package.json`, `angular.json`, `nuxt.config.*`), user prompt contains UI/component/page/screen/design keywords, tech stack file lists a frontend framework |
| **backend** | Any of: server-side framework detected (`pom.xml`, `build.gradle`, `*.csproj`, `requirements.txt`, `go.mod`), prompt contains API/service/endpoint/controller/database keywords |
| **both** | Both conditions above; score each kit independently |
| **neither** | Prompt is `direct` or `fix_bug` class — gate is **skipped entirely** |

> When detection is ambiguous, apply both frontend and backend kits.

---

## Step 2 — Field Scoring

For each field in the applicable kits, assign a score:

| Field importance | Evidence present | Score |
|-----------------|-----------------|-------|
| `required` | ✅ Present | 1.0 × weight |
| `required` | ❌ Missing | 0.0 × weight (hard gap) |
| `recommended` | ✅ Present | 1.0 × weight |
| `recommended` | ❌ Missing | 0.5 × weight (soft gap) |
| `optional` | ✅ Present | 1.0 × weight |
| `optional` | ❌ Missing | 1.0 × weight (no penalty) |

All field weights default to **1.0** unless overridden below.

### Weight overrides

| Kit | Field id | Weight |
|-----|----------|--------|
| frontend | `target.component_library` | **2.0** (highest impact on spec quality) |
| frontend | `visual.screenshots` | **1.5** (required for UI reproduction) |
| frontend | `visual.design_system` | **1.5** |
| backend | `api.contract_preservation` | **1.5** |
| backend | `data.migration_strategy` | **1.5** |

---

## Step 3 — Pass Criteria

### Per-kit scores

```
kit_score = Σ(field_score × weight) / Σ(max_score × weight)
```

### Pass thresholds

| Kit | Condition for PASS |
|-----|--------------------|
| **frontend** | All `required` fields present **AND** `kit_score ≥ 0.70` |
| **backend** | All `required` fields present **AND** `kit_score ≥ 0.60` |
| **generic** | All `required` fields present (score not computed; binary check) |

The overall gate **PASSES** only when **all applicable kits pass**.

---

## Step 4 — Output Decision

| Condition | Decision | Action |
|-----------|----------|--------|
| All applicable kits pass | `READY` | Write `clarification.md`, continue to decomposition |
| Any kit fails | `NEEDS_INPUT` | Write `clarification-form.md`, emit `[wait]` |

### Blocking gaps

A **blocking gap** is a `required` field that the user explicitly skips (writes `skip` for a required item). The gate:
1. Records it in `clarification.md` under `blocking_gaps`.
2. Continues (does not abort the workflow).
3. The coordinator surfaces it as a risk at the plan `[wait]` checkpoint.

---

## Step 5 — Round limit & fallback

- Maximum **2 clarification rounds** per session.
- After round 2, remaining gaps are resolved using `default-if-skipped` values.
- Each applied default is recorded as `resolution: default` in `clarification.md`.
- If a `required` field has no default and is still missing after round 2, it becomes a `blocking_gap`.

---
name: quality-gates
description: |
  Runs quality gate validation at each workflow stage. Supports 4 gate types: spec-quality, spec-to-plan, plan-to-tasks, completeness. Produces gate pass/fail reports with actionable feedback.
  Triggers: "run quality gate", "validate spec quality", "spec quality", "plan coverage", "check plan coverage", "validate plan to tasks", "check task traceability", "verify task completeness", "run completeness review", "review implementation", "check plan traceability", "check coverage", "completeness quality gate", "final sign-off", "feature parity sign-off", "completeness gate", "feature parity", "sign-off report", "verify all requirements".
  Requires `type` parameter to select the gate.
  NOT for: code review, implementation (use implementing-code), spec writing.
---

## User Input

You **MUST** consider the user input before proceeding (if not empty).


## Output

Reports and checkpoints are written under your task's `Artifact path:` (from task metadata).

```
checklists/requirements.md           ← spec-quality gate
checkpoints/spec-to-plan.yaml        ← spec-to-plan gate
traceability-matrix.yaml             ← completeness gate
migration-summary.md                 ← completeness gate
```

## Input

`type` = `spec-quality` | `spec-to-plan` | `plan-to-tasks` | `completeness`

## Workflow

### Step 1: Load Context

Load from cwd:
- constitution.md — **non-negotiable**; violations are always CRITICAL
- spec.md, plan.md, tasks.md, checkpoints/ (as relevant for the gate type)

### Step 2: Gate Routing

Load the checklist reference for the selected gate:

| type | Reference | Key Output |
|------|-----------|------------|
| `spec-quality` | `references/gate-spec-quality.md` | `checklists/requirements.md` |
| `spec-to-plan` | `references/gate-spec-to-plan.md` | `checkpoints/spec-to-plan.yaml` |
| `plan-to-tasks` | `references/gate-plan-to-tasks.md` | `checkpoints/plan-to-tasks.yaml` |
| `completeness` | `references/gate-completeness.md` | traceability-matrix.yaml + migration-summary.md |

### Step 3: Execute Gate

Follow the process defined in the referenced gate file.

### Step 4: Verdict

- **PASS**: all checklist items pass → `✓ [gate] PASSED.`
- **FAIL**: any CRITICAL → `✗ [gate] FAILED. N critical issues.` + remediation steps

## Rules

- **READ-ONLY**: never modify source code; only write checklists, checkpoints, reports.
- **Max 50 findings** per gate.
- **Deterministic**: rerunning without changes = same results.
- **Never hallucinate**: if artifact is missing, report it.

## Severity

| Level | Meaning |
|-------|---------|
| CRITICAL | Checkpoint failed, broken traceability, constitution violation, requirement not implemented, **testing strategy deviation without documented blocker** |
| HIGH | Partial requirement, implementation drift, untested acceptance criteria |
| MEDIUM | Incomplete non-functional coverage, terminology drift |
| LOW | Style/naming, documentation gaps |

## Resources

- `references/gate-spec-quality.md` — spec quality checklist and process
- `references/gate-spec-to-plan.md` — spec-to-plan checklist and process
- `references/gate-plan-to-tasks.md` — plan-to-tasks checklist and process
- `references/gate-completeness.md` — completeness checklist and process (includes plan coverage)
- `templates/report-template.md` — migration summary structure

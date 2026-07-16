# appmod.dependency.consumption-check

Verify that a completed task with dependency artifacts reports how those upstream artifacts were consumed.

## Purpose

`dependencyArtifacts` are not just ordering edges. They are input contracts from upstream work. A task that receives dependency artifacts must either consume them or explicitly explain why they were not applicable.

This action is role-neutral: architecture analysis, feature inventory, API design, test strategy, security findings, UX design, data-model plans, and any other upstream artifact are all treated the same.

## When

`after_task`, after the coordinator has verified the worker returned `[DONE]` and the task artifact exists/non-empty, but before dispatching dependent tasks.

## Inputs available from coordinator context

- Current task metadata, including the `## Dependency Artifacts` list used for dispatch.
- Current task artifact path, typically `{{BASE_PATH}}/artifacts/<taskId>-<role>.md`.
- Worker return message, if available.

## Required behavior

1. If the current task had **no dependency artifacts**, skip silently.
2. If the only dependency artifact is global clarification context (`clarification.md`), skip silently. The clarification file is a global scenario record, not a task-to-task input contract.
3. Otherwise read the completed task artifact and verify it contains dependency-consumption evidence.
4. Accept any section heading or YAML key whose meaning is "which upstream inputs were consumed / how they map to this output / why an input was not used." Match **case-insensitively and format-insensitively**: ignore Markdown heading markers (`#`/`##`), separator style (spaces, hyphens, underscores), and Title-vs-lower case. The headings the worker spec instructs workers to emit are the canonical forms and MUST match:
   - `## Upstream Artifacts Consumed` (canonical — worker output)
   - `## Evidence Mapping` (canonical — worker output)

   Equivalent forms that also satisfy the gate (non-exhaustive — judge by meaning, not by literal string): `upstream_artifacts_consumed`, `evidence_mapping`, `Dependencies consumed`, `Dependency artifacts consumed`, `Inputs consumed`, `Constraints applied`, `Dependencies not used`, `Inputs not used`. Do not fail an artifact that expresses consumption/evidence/not-used under a reasonable synonym just because its exact wording is absent from this list.
5. If none are present, mark the hook as failed and return a remediation message:

```text
Dependency consumption evidence missing.
This task received dependency artifacts but its output does not state which upstream inputs were consumed, which constraints were applied, or why inputs were not used.
Re-run the task or add a remediation task that updates the artifact with:
- Dependency artifacts consumed: <artifact path/id> -> <what it constrained>
- Constraints applied: <specific implementation/test evidence>
- Dependencies not used: <artifact path/id> -> <reason>
```

## Pass criteria

The hook passes when either:

- no task-specific dependency artifacts were provided; or
- the completed task artifact contains at least one accepted consumption/evidence section/key.

## Failure semantics

This action is a quality gate. On failure, the coordinator must not dispatch dependent tasks. Reopen the task as pending or create a remediation task for the same role to update the artifact and, if needed, the implementation/tests.

Do not judge whether the consumption is semantically correct. This hook only enforces that the worker makes dependency usage explicit. Semantic correctness belongs to review/validation tasks.

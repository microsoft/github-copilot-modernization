# Batch Phase Contract V1

## Ownership

The batch control plane owns configuration, preflight, lease, state, event, summary, and result verification. A phase agent owns one execution unit, one phase, and one attempt.

Natural-language returns are notifications only. The attempt result artifact is the protocol boundary.

## Schemas

The authoritative v1 files are under `schemas/`:

- `resolved-repos.schema.json`
- `execution-unit.schema.json`
- `attempt-request.schema.json`
- `attempt-result.schema.json`
- `batch-state.schema.json`
- `event.schema.json`
- `needs-input.schema.json`

Unknown schema versions fail closed. Do not infer compatibility.

## Attempt Identity

The following fields must exactly match the persisted dispatch record:

```text
batchId
invocationId
repoId
executionUnitId
phase
attempt
```

An attempt request never includes the batch owner token. It contains only its approved workspace/scope, input artifacts, decisions, and result path.

## Result Status

Supported result statuses are:

```text
completed
completed_with_issues
failed
protocol_error
needs_input
skipped
interrupted
```

- `needs_input` requires a valid persisted question payload.
- Other statuses require `needsInput: null`.
- `failed` requires an error payload.
- Successful statuses require `error: null` and phase evidence.
- Schema, identity, artifact, or evidence failure is always `protocol_error`.

## Artifact Boundary

Every artifact path must be absolute, exist, resolve canonically, and remain under either the batch root or execution-unit workspace. Symlink/junction escapes are rejected.

Success evidence by phase:

| Phase | Required evidence |
|---|---|
| Assessment | Parseable compatibility `report.json` and non-empty HTML report. |
| Planning | Non-empty `plan.md` and parseable tasks document containing `tasks[]`. |
| Execution | Non-empty summary, non-empty terminal task status list, and explicit build/test result or exemption. |

## State And Lease

- Manifest is immutable.
- JSON files use temporary write, file flush, and atomic rename.
- Events append under the same exclusive mutation lock as takeover.
- Only the active owner token can mutate.
- The raw owner token is never persisted.
- Takeover compare-and-swap rotates ownership but remains read-only.
- A read-only takeover cannot schedule or mutate until worker fencing is implemented.

## Recovery Boundary

A read-only takeover does not dispatch agents, resume work, retry attempts, process `NeedsInput`, or mutate source workspaces. Those capabilities require worker fencing and an explicit recovery workflow.
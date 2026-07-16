---
name: appmod-hooks
description: Lifecycle hooks for the modernize-rearchitecture coordinator. Defines hook points, registered actions, and execution rules.
---

# appmod-hooks

Lifecycle hooks that fire at defined points during coordinator execution. Each hook point triggers registered actions in order.

## Hook Points

| Point | When | Coordinator context |
|---|---|---|
| `before_all` | After DAG is generated, before first task dispatch | Full DAG available, no tasks started |
| `before_task` | Before dispatching each worker | Task ID and role known, profile read for Progress |
| `after_task` | After worker returns and verify passes | Task artifact available, status decided. If all tasks in the current phase are now ✅, also execute phase-completion actions (git commit, commit-pin, phase counter increment) |
| `after_all` | After completion criteria met (§3.7) | All tasks resolved |

## Registered Actions

See `references/actions.yml` for the action registry. Actions use dotted namespace: `appmod.<domain>.<verb>`.

## Execution Rules

1. Actions within a hook point execute **in order** (top to bottom in the registry)
2. An action that fails does NOT block subsequent actions — log the error and continue, unless the action explicitly declares itself a quality gate
3. `optional: false` actions MUST execute; `optional: true` actions execute only if their `condition` is met
4. The coordinator executes hook actions **itself** (shell commands for git, file writes for profile) — hooks are NOT delegated to workers
5. A quality-gate action failure blocks dependent dispatch: keep the task pending or create a remediation task, then re-run the hook after the artifact is updated

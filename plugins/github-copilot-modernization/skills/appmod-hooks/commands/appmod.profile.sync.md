# appmod.profile.sync

Update `progress_sync` in `project-profile.yaml` after each task completes. Handles both task-level and phase-level updates in one pass.

## Behavior

Read `{{BASE_PATH}}/artifacts/project-profile.yaml`, update the `progress_sync` section, write the full file back.

### progress_sync schema

```yaml
progress_sync:
  run_id: ""                      # UUID, set once at profile creation
  grouping_mode: ""               # none | merge | group-by-group
  execution_mode: ""              # all-at-once | phase-by-phase | saved
  plan_start_time: ""             # UTC timestamp when first plan-phase task is dispatched
  plan_completed_time: ""         # UTC timestamp when ALL plan-phase tasks are ✅
  execution_start_time: ""        # UTC timestamp when first execution-phase task is dispatched
  execution_completed_time: ""    # UTC timestamp when ALL execution-phase tasks are ✅
  validation_start_time: ""       # UTC timestamp when first validation-phase task is dispatched
  validation_completed_time: ""   # UTC timestamp when ALL validation-phase tasks are ✅
  total_phases: 0
  completed_phases: 0
  total_modules: 0
  completed_modules: 0
  total_tasks: 0
  completed_tasks: 0              # Increment by 1 for each task marked ✅
  total_commits: 0                # Increment by 1 for each git commit
  total_groups: 0
  completed_groups: 0
  build_verified: false           # Set true when smoke-test reports PASS
  test_verified: false            # Set true when tester reports test suite PASS
```

## Update rules

### Task-level (every task completion)

- **`completed_tasks`**: Increment by 1 per task.
- **`total_tasks`**: Set once when DAG is generated.
- **`total_commits`**: Increment by 1 for each git commit made.
- **`*_start_time`**: Set once when the first task in that phase is dispatched. Do NOT overwrite if already set.

### Phase-level (when all tasks in current phase are ✅)

After incrementing `completed_tasks`, check whether ALL tasks sharing the current `phase_label` are now ✅. If so:

- **`completed_phases`**: Increment by 1.
- **Set the matching `*_completed_time`** by categorizing the current phase:
  - Phases that analyze, plan, design, or research → `plan_completed_time`
  - Phases that implement, migrate, scaffold, or build → `execution_completed_time`
  - Phases that test, validate, verify, or review → `validation_completed_time`
  - Set the timestamp when ALL phases in that category are done (e.g. if there are two plan phases, only set `plan_completed_time` after both are ✅).
- **`completed_groups`**: Increment when all tasks in a group are ✅ (if grouping_mode != none).
- **`completed_modules`**: Increment when all tasks for a module are ✅ (multi-module only).

### Finalization (last task overall)

When all tasks are ✅, ensure no timestamp is left empty — set any remaining `*_completed_time` to current UTC as fallback.

## Execution

Read the YAML, modify the relevant fields in-memory, write the full file back (overwrite, not append).

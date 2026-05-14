# Consuming the Fan-out Guide

How to use a project topology when splitting work into tasks (DAG construction) or organizing output artifacts.

## Who reads this

The project topology has two consumer roles, regardless of what the surrounding orchestration calls them:

- **Caller** — whoever requested the guide. Validates the artifact before accepting it (see § Acceptance Check) and uses it to drive task generation.
- **Implementer** — anyone reading the guide to scope a single group's work. Reads group LOC to judge session scope; escalates if oversized.

## Fan-out groups are the PRIMARY splitting dimension

The project topology defines module groups (G1, G2, G3, ...). These groups serve two purposes:

1. **Splitting dimension** — each G-group is one unit of work in the DAG.
2. **Execution grouping dimension** — all tasks belonging to the same G-group execute together as a cohort, regardless of role.

### Splitting vs execution grouping

Tasks are **assigned** by role (backend, frontend, etc.) per the project's role definitions — this determines WHO does the work. But tasks are **grouped** by G-group for execution — this determines WHERE and WITH WHOM the work runs.

```
DAG tasks (role-based assignment):      Execution groups (G-based cohort):
  t20 [backend]  G2 APIs                 ┌─ G2 cohort ─────────────┐
  t21 [frontend] G2a UI                  │ t20 [backend]  G2 APIs   │
  t22 [frontend] G2b UI                  │ t21 [frontend] G2a UI    │
  t25 [backend]  G3 APIs                 │ t22 [frontend] G2b UI    │
  t26 [frontend] G3a UI                  └──────────────────────────┘
                                          ┌─ G3 cohort ─────────────┐
                                          │ t25 [backend]  G3 APIs   │
                                          │ t26 [frontend] G3a UI    │
                                          └──────────────────────────┘
```

When presenting plans to users, always use G-group as the primary display unit, not phase or role.

### Rules for topology-aligned splitting
- Each topology group runs its own pipeline (execute → validate). Within a group, tasks are split by natural boundaries (role, module, phase) — not forced into a single task. Oversized modules have **already been split into independent top-level groups** (G3a, G3b, ...) by the project topology — treat each as a normal group; do NOT re-split.
- Only `in-scope` groups generate DAG tasks. `context-only` groups do NOT become tasks — they exist solely to document dependency context for in-scope work.
- Task titles MUST include the G-group label, e.g. "G3 Data access: entities, repositories, migrations".
- Phase labels for implementation tasks should reference groups, e.g. "Feature Modules by Fan-out Group".
- Do NOT invent grouping schemes that don't exist in the project topology.
- Groups that don't need implementation work (test-only groups, build tooling, `context-only` groups) are skipped.

## Dependency correctness

CRITICAL: Each task depends on what it actually CONSUMES, not on the broadest upstream task.

- Scaffold creates the project structure. Shared services depend on scaffold.
- Shared services create API clients, interceptors, utilities. Shared components depend on services.
- Shared components create reusable modules. Feature tasks that use them depend on components, NOT on any container/shell task.
- Container tasks (if any) create the framework for a specific area. Only features that LOAD INSIDE a specific container depend on it. Features that exist outside a container depend on shared components/services and the specific backends they consume.

❌ WRONG (all features depend on one container):
```
t20 G3 Feature-A [deps: t19-container]  ← correct, renders inside container
t23 G5 Feature-B [deps: t19-container]  ← WRONG if B doesn't load in container
t24 G6 Feature-C [deps: t19-container]  ← WRONG if C doesn't load in container
```

✅ CORRECT (features depend on what they consume):
```
t20 G3 Feature-A [deps: t19-container]       ← correct, loads inside container
t23 G5 Feature-B [deps: t16-components, t12-api]  ← needs components + backend API
t24 G6 Feature-C [deps: t16-components]       ← only needs shared components
```

## Parallelism

- Tasks within the same plan phase that have no explicit inter-task dependency MUST be parallel (depends_on references only the specific upstream task whose output this task needs, not sibling tasks).
- Do NOT invent task-to-task dependencies the plan does not specify.
- Do NOT serialize tasks into a chain when the plan shows them as parallel.

❌ WRONG (serial chain between independent groups):
```
t20 G3-module-core [deps: t19]
t21 G3-module-settings [deps: t20]  ← WRONG: t21 doesn't need t20's output
t22 G3-module-tools [deps: t21]    ← WRONG: t22 doesn't need t21's output
```

✅ CORRECT (parallel siblings):
```
t20 G3-module-core [deps: t19]     ← all three depend on shared parent only
t21 G3-module-settings [deps: t19]
t22 G3-module-tools [deps: t19]
```

## Implementer consumer rules

1. Do NOT re-discover module groupings — the project topology is the source of truth.
2. Tag every output section with its group label (G1, G2, etc.).
3. Treat split-groups (G3a, G3b, ...) as independent top-level groups — they have their own dependencies and pipeline.
4. Keep group content cohesive — do not scatter a single group across unrelated sections.
5. `context-only` groups are read-only references. They may be read to understand API contracts, data models, or interface boundaries — but MUST NOT generate implementation tasks, modify code, or produce artifacts for them.

## Acceptance Check (MANDATORY — before accepting the project topology)

The caller MUST validate the project topology before using it. If any check fails, reject the guide and request a revision.

1. **L3 validation present**: The artifact's Provenance section MUST contain the verbatim `=== Grouping Validation ===` block followed by `=== Group Quality Scores ===`. If either block is missing or summarized, reject. (The script outputs raw scores only — band classification is judgment work, see check 3 below.)
2. **Module coverage**: Every non-test module from L1 appears in exactly one group. The L3 `Coverage` Quality Score line MUST read `complete (0 missing, 0 unknown, 0 duplicate)`. Re-check by spot-reading the artifact's module list against L1's module count.
3. **Path + band documented**: The artifact MUST state the path classified (Path A or Path B) and, for each of the 4 Quality Scores, the band placed (OK / Informational / Critical) per `topology-thresholds.md`. If any dimension is **Critical**, reject — the producing pass must apply the listed remedy and re-validate before resubmitting.
4. **Invariants clean**: The two hard invariants — `SCC integrity = 0` and `Group cycles = 0` — MUST both read 0 regardless of topology. Any non-zero value is Critical for every topology and means the grouping is invalid.
5. **Test/build modules absent**: L1 filters tests automatically. If any test/build-tooling module name appears in the artifact (e.g. `*.Tests`, `ClearPluginAssemblies`, `e2e`), the L1 output was edited — reject.

## Work Assignment (after Acceptance Check passes)

The project topology already includes split-groups (G3a, G3b, ...) as independent top-level groups in its Module Groups table. They are treated like any other group:

1. **Every group = one work unit** with its own full pipeline (plan → execute → validate). No special handling for split-groups.
2. **Inter-split dependencies** (e.g. G3b → G3a) appear as normal cross-group edges in the dependency graph.
3. **Trivial modules** are already merged into neighbors by the project topology; no further action needed.

Split boundaries are decided by L2 and frozen in the project topology — do NOT re-derive them.

# DAG Construction Rules

Rules for generating task DAGs from project analysis and plan artifacts.

## Task Schema

Each task has these fields:
- `id` — flat sequential identifier (`t1, t2, t3…`)
- `role` — assigned agent role
- `title` — imperative, action-first
- `description` — what to produce, what decisions to make
- `depends_on` — direct deps only
- `parallel_ok` — bool
- `phase_label` — user-facing wave name. A phase_label must not appear in multiple computed phases.

Output ONLY valid JSON:
```json
{"tasks": [{"id": "t<N>", "role": "<role>", "title": "<title>", "depends_on": ["<id>", ...], "phase_label": "<label>"}]}
```

## Grouping / Scope Rules

Each task-catalog fragment has a `scope` field (`per-group` or `global`).
- **group-by-group mode**: for `scope: per-group` fragments, emit a separate task per in-scope group tagged `[G<N>]` in the title. For `scope: global`, emit one task (no tag).
- **none / merge-all mode**: ignore scope, one task per fragment.

## Role Assignment

- Assign each task based on the role's charter boundaries and expected deliverable type, not role name associations. Read each role's "You own" and "You do NOT own" sections.
- Phase labels describe workflow milestones, not ownership containers. A single phase may contain multiple tasks owned by different roles. When a phase requires deliverables owned by different charters, decompose them into separate tasks or parallel tasks.
- Do NOT merge system design / API contract deliverables with implementation-planning / testing-strategy / task-breakdown deliverables unless the same charter explicitly owns both.
- Requirements roles define WHAT. Design roles define HOW. Keep them separate.

## Dependency Rules

1. **Implementation plan is source of truth** for execute-phase scope AND dependency structure. Always apply compression/sizing before emitting.
2. If no implementation plan, derive execute tasks from architecture analysis + pipeline fragments.
3. **Minimum dependency principle**: before adding edge D→T, verify T needs an artifact D produces. No deps based on phase grouping or role association. Do NOT make a task depend on ALL tasks in a prior group when it only needs output from ONE of them.
4. **Correct dependencies**: if a task consumes another's output, it MUST depend on it. UI pages calling APIs MUST depend on the API tasks, not just the scaffold. A task reading database tables MUST depend on the migration task.
5. **Scaffold gate (rewrite only)**: when the change_type is rewrite and a scaffold task creates the new project structure, any task that writes source code files MUST depend on the scaffold task. Does not apply to upgrade or extract.
6. **Output-to-consumer mapping**: for each role, identify what it produces and who needs that output. Only create a task if its output is consumed by another role, or if it's the final deliverable.

## Parallelism

- Same-phase tasks with no explicit inter-dependency MUST be parallel.
- Do NOT serialize tasks that the plan shows as parallel. Do NOT invent dependencies the plan doesn't specify.
- When a project topology exists, its `in-scope` groups each run their own pipeline. `context-only` groups are excluded. When no topology exists, split by module or domain.
- If a per-group step's work is too large for one agent session (~100-200 tool calls max), split by domain or module within the group.
- Split by **vertical feature slice**, not horizontal layer.

## Sizing & Compression

1. **Scale-aware splitting**: when change spans multiple independently-deployable modules, split broad tasks into per-module parallel tasks + synthesis. Keep each task scoped to one agent session.
2. **Sizing**: merge same-type repetitive items (e.g. multiple entity defs, CRUD endpoints) into one task. Tasks target ONE module or domain area — if the project has N independent modules, create roughly N tasks per role. Granularity must be consistent across roles.
3. **Compression**: (a) merge same-role A→B if A's only consumer is B; (b) reviews depend on implementation, not deployment; (c) no transitive deps (C→B→A: don't list A as dep of C); (d) width-1 layers merge with neighbors unless initial-analysis, blocking-scaffold, or final-signoff.
4. **Scale-aware compression**: when a single developer could hold the entire codebase in context, collapse implementation into as few tasks as role boundaries allow. Split only when changes are genuinely parallel AND assigned to different roles.
5. **Phase label reuse**: revalidation, recheck, and verification tasks belong in the phase that triggered them — do NOT create a separate phase. For example, a "Build Recheck" after "Implementation" is part of "Implementation", not its own phase. Reuse existing phase labels whenever the task is a follow-up to work in that phase.

## Task ID Rules

- Flat sequential IDs: `t1, t2, t3…`. Within the same wave, order alphabetically by role name.
- One task per role per wave unless the work spans multiple independent modules (split per module).
- Same input should produce the same decomposition every time.
- **Replan/remediation IDs**: tasks created after initial DAG generation (remediation, recheck, re-validation, splits) MUST use dotted sub-IDs under the parent task that triggered them (e.g., `t1.1`, `t1.2`). Never allocate new flat IDs for replan tasks.
- IDs continue from the offset provided by the coordinator (e.g. if last plan task is t5, execute tasks start at t6).

## Standard Tail Phases

The execute+validate DAG MUST include these after implementation (unless noted optional):

- **Scaffold** *(optional)* — project structure + build setup. Only when cross-stack migration producing new project structure.
- **Implementation** — feature slices from implementation plan
- **Review (Phase N-2)**: arch review + security audit, in parallel, deps on ALL implementation tasks
- **Testing / Validation (Phase N-1)**: runtime validation, deps on review
- **Conformance & Completeness (Phase N)**: verify against testing strategy, deps on testing

## Group Pipeline Rules

Within each group, tasks are split by natural boundaries (role, module, phase) — not forced into a single task. Oversized modules have already been split into independent groups by the topology stage.

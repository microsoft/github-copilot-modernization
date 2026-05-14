# DAG Construction Rules

Rules for generating task DAGs from project analysis and plan artifacts.

## Output Schema

Output ONLY valid JSON:
```json
{"tasks": [{"id": "t<N>", "role": "<role>", "title": "<title>", "depends_on": ["<id>", ...], "phase_label": "<label>"}]}
```

## Grouping / Scope Rules

Each task-catalog fragment has a `scope` field (`per-group` or `global`).
- **group-by-group mode**: for `scope: per-group` fragments, emit a separate task per in-scope group tagged `[G<N>]` in the title. For `scope: global`, emit one task (no tag).
- **none / merge-all mode**: ignore scope, one task per fragment.

## Dependency Rules

1. **Implementation plan is source of truth** for execute-phase scope AND dependency structure. But always apply compression/sizing before emitting.
2. If no implementation plan, derive execute tasks from architecture analysis + pipeline fragments.
3. Same-phase tasks with no explicit inter-dependency MUST be parallel.
4. Do NOT invent dependencies the plan doesn't specify.
5. Do NOT serialize tasks that the plan shows as parallel.
6. **Minimum dependency principle**: before adding edge D→T, verify T needs an artifact D produces. No deps based on phase grouping or role association.
7. **Role assignment**: match task to the role whose charter "You own" section covers that deliverable.

## Sizing & Compression

8. **Scale-aware splitting**: if plan covers 3+ modules, split broad tasks into per-module parallel tasks + synthesis. One agent session ≈ 100–200 tool calls max.
9. **Sizing**: merge same-type repetitive items (e.g. multiple entity defs, CRUD endpoints) into one task rather than one task per class/file.
10. **Compression**: (a) merge same-role A→B if A's only consumer is B; (b) reviews depend on implementation, not deployment; (c) no transitive deps; (d) width-1 layers merge with neighbors unless initial-analysis, blocking-scaffold, or final-signoff.

## Standard Tail Phases

The execute+validate DAG MUST include these after implementation (unless noted optional):

- **Scaffold** *(optional)* — project structure + build setup. Only when cross-stack migration producing new project structure.
- **Implementation** — feature slices from implementation plan
- **Review (Phase N-2)**: arch review + security audit, in parallel, deps on ALL implementation tasks
- **Testing / Validation (Phase N-1)**: runtime validation, deps on review
- **Conformance & Completeness (Phase N)**: verify against testing strategy, deps on testing

## Task ID Continuation

Task IDs continue from the offset provided by the coordinator (e.g. if last plan task is t5, execute tasks start at t6).

## Group Pipeline Rules

Within each group, tasks are split by natural boundaries (role, module, phase) — not forced into a single task. Oversized modules have already been split into independent groups by the topology stage.

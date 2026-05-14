---
name: dag-generation
description: Generate task DAGs for modernization projects — select fragments from task catalog, produce initial DAG (Stage 1), and execute/validate DAG from plan artifacts (Stage 2).
triggers:
  - "generate DAG"
  - "generate plan tasks"
  - "generate execute tasks"
  - "compose task list for project"
NOT for:
  - Greenfield, hotfix, or single-question requests (coordinator handles inline)
  - Pure architecture analysis (use analyzing-architecture)
  - Grouping / topology decisions (coordinator handles directly)
  - Recon / measurement (use project-recon FIRST)
---

# DAG Generation

Two-stage DAG generation for modernization projects:
1. **Stage 1** (§1.4) — select fragments from task-catalog, determine deferred_dag, produce DAG JSON
2. **Stage 2** (§3.2.2) — read plan artifacts, produce execute+validate DAG

## Reference Files

- `references/task-catalog.md` — fragment library with when/skip-when/after/scope
- `references/dag-rules.md` — DAG construction rules (dependencies, compression, sizing)

## Stage 1: Initial DAG

Select fragments from the task catalog and produce a DAG.

### Inputs

1. **Project profile** — read from `{{BASE_PATH}}/artifacts/project-profile.yaml` (project.loc, project.languages, project.modules, assessment.change_type, assessment.grouping_needed)
2. **user_ask** — natural-language migration target (passed by coordinator)

### Decision Procedure

#### Step 1: Select fragments
Read `references/task-catalog.md`. For each fragment, decide include/exclude with a one-line rationale based on:
- change_type (upgrade | extract | rewrite)
- user_ask intent
- Project profile (LOC, modules)

Respect `when` / `skip-when` conditions and `after` ordering from the catalog.

#### Step 2: Determine deferred_dag
- `true` if the pipeline includes an implementation-plan fragment (execute tasks depend on plan artifacts)
- `false` if no implementation-plan — all tasks are knowable upfront

#### Step 3: Generate DAG
Read `references/dag-rules.md` for construction rules.

- **If `deferred_dag: true`** → produce only plan-phase tasks as JSON
- **If `deferred_dag: false`** → produce the complete DAG (plan + execute + validate) as JSON

### Output

Return JSON to the coordinator (do NOT write files):

```json
{
  "deferred_dag": true,
  "tasks": [
    {"id": "t1", "role": "<role>", "title": "<title>", "depends_on": [], "phase_label": "<label>"},
    {"id": "t2", "role": "<role>", "title": "<title>", "depends_on": ["t1"], "phase_label": "<label>"}
  ]
}
```

## Stage 2: Execute+Validate DAG

When plan phase completes and `deferred_dag: true`, generate the execute+validate DAG from plan artifacts.

### Inputs (provided by coordinator)

- Artifact base path
- User ask (original migration request)
- Change type (upgrade / extract / rewrite)
- Grouping mode and in-scope groups
- Fan-out file path
- Task ID offset (continue from last plan-phase task)

### Procedure

1. Read plan artifacts (implementation plan, architecture analysis, etc.)
2. Read `references/dag-rules.md` for construction rules
3. Read `references/task-catalog.md` for fragment definitions
4. Generate JSON task graph per dag-rules.md

### Output

```json
{"tasks": [{"id": "t<N>", "role": "<role>", "title": "<title>", "depends_on": ["<id>", ...], "phase_label": "<label>"}]}
```

## What this skill does NOT do

- Does NOT decide grouping / topology (coordinator decides in §1.3)
- Does NOT compute topology groupings (that's `project-decomposition`)
- Does NOT perform role discovery from charters (assigns roles based on task content; coordinator refines using team-charters at dispatch)
- Does NOT match task → skill (that's worker subagent)
- Does NOT execute anything (that's coordinator + workers)
- Does NOT prompt user (that's coordinator at checkpoint)

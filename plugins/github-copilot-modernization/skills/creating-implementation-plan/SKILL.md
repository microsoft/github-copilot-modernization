---
name: creating-implementation-plan
description: |
  Creates an implementation plan AND task breakdown from a feature spec by consuming design artifacts. Produces plan.md with implementation steps, inline task list with full REQ traceability, and a Requirement Mapping table. This is the single skill for planning + decomposition.
  Triggers: "create implementation plan", "plan for implementation", "assemble implementation plan", "generate plan from spec", "break down tasks", "generate tasks from plan", "create implementation tasks", "decompose the plan into work items".
  NOT for: architecture analysis (use analyzing-architecture), implementation (use implementing-code), coordinator task decomposition.
---

## User Input

You **MUST** consider the user input before proceeding (if not empty).

## Output

All outputs are written under your task's `Artifact path:` (from task metadata).

```
plan.md                          ← main artifact: plan + task breakdown + requirement mapping table
research.md                      ← resolved spec-level unknowns (if any)
checkpoints/spec-to-plan.yaml    ← REQ-XXX → plan item traceability
checkpoints/plan-to-tasks.yaml   ← plan item → task traceability
```

## Workflow

### Step 1: Load Context

1. Read the feature spec. Extract all `REQ-XXX` requirement IDs.
2. Read `constitution.md` for principles and constraints.
3. Read `knowledge-graph.json` (if available) for architecture understanding.
4. Read all dependency artifacts listed in the task's `## Dependency Artifacts` metadata. These typically include architecture analysis, data model, API contracts, UX patterns, and feature specs — but filenames follow the `<taskId>-<role>.md` convention, not fixed names.
5. Read the project topology (`project-topology.md` in the artifacts directory) if it exists. Extract the module group table (G1, G2, ...) and their scope (`in-scope` / `context-only`). These G-group labels will be used in Step 3 and Step 4 to tag plan items and tasks.
6. If any required design artifact is missing, escalate — do NOT produce them yourself.

### Step 2: Resolve Remaining Unknowns

> **Ownership boundary**: `analyzing-architecture` produces codebase research and design artifacts. This step only resolves **spec-level unknowns** (NEEDS CLARIFICATION items, technology choices not yet decided). If codebase research is missing, escalate.

1. Extract any remaining NEEDS CLARIFICATION from the feature spec.
2. For each → research and resolve.
3. Consolidate in `research.md` (only if there were unknowns to resolve):
   - Decision: [what was chosen]
   - Rationale: [why]
   - Alternatives considered: [what else evaluated]

### Step 3: Plan Assembly

1. **Load all dependency artifacts** from task metadata (see Step 1.4).
2. **Fill plan template** (`templates/plan-template.md`):
   - Technical Context: derive HOW decisions from design artifacts + constitution + guidelines.
   - Constitution Check from constitution principles.
3. **Integrate guidelines**: Scan `skills/guidelines/` for matching tech patterns. Document under "Applied Guidelines".
4. **Map every plan item** to at least one REQ-XXX.
5. **Tag plan items with G-groups**: If a project topology was loaded in Step 1.5, every Implementation Step that maps to a specific module group MUST include the G-group label in its title (e.g., `### Step 3: [G1] Payment gateway integration`). Cross-cutting steps that span all groups use `[Cross-cutting]` instead. This enables downstream DAG generation to extract group membership directly from the plan.
6. **Write `plan.md`** section by section (write each section before moving to the next):
   a. Header + Summary
   b. Technical Context (from design artifacts)
   c. Constitution Check
   d. Applied Guidelines
   e. Implementation Steps (phases with plan items, each referencing REQ-XXX)
   f. Project Structure

### Step 4: Task Breakdown

For each implementation phase in the plan, expand every plan item into concrete tasks:

**Task format** (each task on its own line):
```
- [ ] T001 [G?] [P?] [Story?] [Plan:X.Y] Description with exact file path [Source: path/to/file.java#method] [BL: BL-XXX]
```

Format components:
- **Checkbox**: Always `- [ ]`
- **Task ID**: Sequential (T001, T002...) in execution order
- **[G] label**: `[G1]`, `[G2]`, `[Cross-cutting]` etc. **REQUIRED when project topology exists** — inherited from the plan item's G-group tag (Step 3.5). Omit when no project topology.
- **[P] marker**: Only if parallelizable (different files, no dependencies)
- **[Story] label**: `[US1]`, `[US2]` etc. Required for user story phases only; omit for Setup/Foundational/Polish phases
- **[Plan:X.Y]**: **REQUIRED** — references source plan item. Multiple: `[Plan:2.1,2.3]`
- **Description**: Clear action with exact file path
- **[Source:]**: **REQUIRED in rewrite mode** for code conversion tasks: `[Source: src/.../File.java#method1,method2]`
- **[BL: BL-XXX]**: optional link to business-logic-inventory.md

**Rewrite Mode Source Annotation Rules:**
- Path relative from repo root
- Methods after `#`, comma-separated
- Multiple files: multiple `[Source:]` annotations
- Entire file: omit `#`
- Non-source tasks (setup, config) don't need `[Source:]`

Task organization:
- **Phase 1**: Setup (project initialization, scaffold)
- **Phase 2**: Foundational (blocking prerequisites, data layer)
- **Phase 3+**: User stories in priority order (P1, P2, P3...)
  - Within each story: Models → Services → Endpoints → Integration
- **Final phase**: Cross-cutting concerns, polish

Write tasks inline in `plan.md` under each phase — **do NOT create a separate tasks/ directory**. Tasks are embedded in the plan document for coherence.

After writing all tasks, generate checkpoint files using the templates:
- `checkpoints/spec-to-plan.yaml` — using `templates/spec-to-plan-checkpoint-template.yaml`
- `checkpoints/plan-to-tasks.yaml` — using `templates/plan-to-tasks-checkpoint-template.yaml`

**Examples:**
```
- [ ] T001 [Plan:1.1] Create project structure per implementation plan
- [ ] T005 [P] [Plan:2.1] Implement auth middleware in src/middleware/auth.py
- [ ] T012 [P] [US1] [Plan:2.2] Create User model in src/models/user.py
- [ ] T015 [US3] [Plan:3.2] Convert ProductAction to ProductController [Source: src/.../ProductAction.java#list,add]
```

### Step 5: Requirement Mapping

After all phases and tasks are written, append this section to `plan.md`:

```markdown
## Requirement Mapping

| REQ ID | Description | Plan Items | Implementation Evidence |
|--------|-------------|------------|------------------------|
| REQ-001 | [short description] | P2.1, P3.2 | AuthController.java, UserService.java |
| REQ-002 | [short description] | P3.1 | ProductRepository.java |
```

**Rules:**
- Every REQ-XXX from the spec MUST appear in this table
- `Plan Items` lists which plan item IDs address this requirement
- `Implementation Evidence` describes what files/classes will prove completion (fill based on the tasks you just wrote)
- If any requirement has no plan item → ERROR, do not proceed

### Step 6: Report

Report completion with:
- Output artifact paths (relative to cwd)
- Coverage summary: N requirements mapped, N tasks generated
- Any warnings or unresolved items

## Guideline Check

Before generating the plan, check for applicable guidelines:

1. Identify technologies from feature spec and design artifacts.
2. Search `skills/guidelines/` for matching patterns.
3. For each match: extract relevant rules, integrate into plan, document in "Applied Guidelines" section.

## General Rules

- Write all outputs to cwd using relative paths.
- ERROR on gate failures or unresolved clarifications.
- Apply guideline skills when technology patterns match.
- **NEVER proceed with missing requirement coverage.**
- **NEVER produce design artifacts** (data-model.md, contracts/) — consume them from upstream analysis tasks.
- **NEVER stop after plan steps alone** — task breakdown and Requirement Mapping table are part of this skill's deliverable.
- Tasks must be immediately executable by an LLM without additional context.
- Tests are OPTIONAL — only generate if explicitly requested.


## Resources

### Templates
- `templates/plan-template.md` — Implementation plan document template
- `templates/tasks-template.md` — Task list structure template
- `templates/spec-to-plan-checkpoint-template.yaml` — REQ traceability checkpoint template
- `templates/plan-to-tasks-checkpoint-template.yaml` — Plan-to-tasks traceability checkpoint template

### References
- `references/task-format.md` — Task checklist format rules: `[P]`, `[Plan:X.Y]`, `[Source:]` annotations, rewrite mode requirements

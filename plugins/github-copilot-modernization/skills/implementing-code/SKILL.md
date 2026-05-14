---
name: implementing-code
description: |
  Executes a batch of implementation tasks with TDD workflow, source-anchored rewrite for behavioral fidelity, guideline-based code transformation, and full requirement tracing. Returns a structured batch report.
  Triggers: "implement tasks", "execute the batch", "write code for these tasks", "implement with source anchoring", "run the implementation".
  NOT for: task generation (use breaking-down-tasks), implementation planning (use creating-implementation-plan).
---

## User Input

You **MUST** consider the user input before proceeding (if not empty).


## Output

Code files are written into the project tree. The batch report is written under **the provided artifact path**.

```
batch-report.yaml   ← structured result consumed by caller
```

## Workflow

### Step 1: Verify Prerequisites (first batch only)

Confirm required artifacts exist: plan.md (with task list and Requirement Mapping table), feature spec.

### Step 2: Load Context

Read from the provided artifact path and dependency artifacts. Scan the artifact directory to find these categories:

| Category | Required | Purpose | Look for |
|----------|----------|---------|----------|
| Task breakdown | ✅ | Work items with T-IDs to implement | Artifact with task IDs (T001, T002...), may be in `tasks/` subdirectory or main planning artifact |
| Feature spec | ✅ | Requirements (REQ-XXX) and acceptance criteria | Artifact with REQ-XXX identifiers and user scenarios |
| Constitution | ✅ | Project principles and constraints | Usually named `constitution.md` in artifact root |
| Implementation plan | ✅ | Phased plan with architecture decisions | Artifact with phased sections and plan references |
| Architecture design | ✅ | API contracts, layering, package structure | Artifact with design decisions |
| Data model | If exists | Entity definitions, mappings, FK strategy | Artifact with schema/entity details |
| UX/UI spec | If exists | Screen layouts, user flows, components | Artifact with screen specs |
| Knowledge graph | If exists | Module dependencies and class relationships | JSON file with nodes/edges in artifact path |
| Checkpoints | If exists | Upstream traceability | YAML files in `checkpoints/` subdirectory |
| Guidelines | If exists | Migration rules and transformation patterns | Search `guidelines` skill |

### Step 3: Checklist Gate (first batch only)

If `checklists/` directory exists, scan checklist files. If any incomplete items: display table and ask before proceeding.

### Step 4: Project Setup (first batch only)

Create/verify ignore files. See `references/ignore-patterns.md` for patterns by language/tool.

### Step 5: Match Tasks from Breakdown

From the task breakdown artifact, find tasks that match your current assignment:
1. Read the task breakdown (from dependency artifacts)
2. Match tasks by role, module/domain, or phase that align with your task description
3. For each matched task, extract:
   - Task ID, description, acceptance criteria
   - Plan references and REQ-XXX traceability
   - Source file references (rewrite mode)
   - Dependencies and parallel markers

Unmet dependency not in current batch → report as blocked.

### Step 6: Execute

**Ordering:**
- Sequential tasks: in order
- Parallel `[P]` tasks: can run together
- Same-file tasks: must run sequentially

**TDD Flow:**
1. Setup: project structure, dependencies, configuration
2. Tests before code: contract, entity, integration tests
3. Core: models, services, endpoints
4. Integration: DB, middleware, logging, external services
5. Run tests: execute module-level tests (e.g., `mvn test -pl <module> -am`). ALL tests must PASS. Report pass/fail/skip counts in batch report. Test failure = task NOT complete.

**Constitution & Requirement Fidelity:**
- Before each task, re-read traced `REQ-XXX` — implement requirement intent, not just task description.
- Verify decisions align with constitution principles.

**Source-Anchored Rewrite (MANDATORY in rewrite mode):**
For tasks with `[Source:]`, follow `references/source-anchored-rewrite.md`.

**Guideline-Based Transformation:**
For tasks marked `[GUIDELINE:skill-name]`:
1. Load the guideline from `skills/guidelines/`
2. Apply transformation rules, import changes, method mappings
3. Use before/after examples as reference

**Parallelism:** Run independent tasks (`[P]` marked) in parallel as much as possible to maximize throughput.



**Error Handling:**
- Halt on non-parallel task failure
- For `[P]` tasks: continue successful ones, report failures

### Step 7: Write Checkpoint

After ALL tasks in this batch complete, write `checkpoints/tasks-to-impl.yaml` using `templates/tasks-to-impl-checkpoint-template.yaml`. This is REQUIRED — completeness gate reads it to verify traceability.

### Step 8: Report

Generate batch result report per `references/batch-report-format.md` (YAML format).

## Resources

### References
- `references/source-anchored-rewrite.md` — Rewrite-mode behavioral fidelity process
- `references/ignore-patterns.md` — Ignore file patterns by language/tool
- `references/batch-report-format.md` — Required YAML output format

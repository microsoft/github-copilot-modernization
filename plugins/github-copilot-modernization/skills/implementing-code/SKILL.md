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

### Step 5.5: Discover Required API Endpoints (web applications only)

**Before writing any implementation code**, check whether an endpoint contract test script exists in the project root:

```bash
for script in api-test.sh api-check.sh smoke.sh health-check.sh test-api.sh; do
  test -f "./$script" && echo "found: $script" && break
done
```

**If a script is found:**
1. Read its full contents to extract every endpoint it exercises: URL paths, HTTP methods, expected status codes, and expected response shape.
2. Treat every such endpoint as a **mandatory acceptance criterion** for this batch — equivalent to an explicit REQ in the feature spec. Missing even one will cause the post-build evaluation to fail.
3. Cross-check each endpoint against the matched task list. If any script endpoint is absent from the task breakdown, add it as an implicit sub-task in your execution plan (e.g., `T_API_dashboard: Implement GET /api/dashboard`).
4. Record the discovered endpoint list at the top of `batch-report.yaml` under `required_endpoints`:
   ```yaml
   required_endpoints:
     - method: GET
       path: /api/dashboard
       source: api-test.sh
       status: pending   # updated to "implemented" when the endpoint is wired up and verified
     - method: GET
       path: /api/items
       source: api-test.sh
       status: pending
   ```

**If no script is found:**
- Check `clarification.md` (if present) for any explicitly listed required API endpoints.
- Check the feature spec for API contract sections.
- If neither source provides an endpoint list, proceed without this step.

This discovery step ensures that evaluation scripts are treated as first-class requirements from the start of implementation — not discovered only at post-build verification when fixes are costly.

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
1. Load each top-level guideline skill named in the plan
2. Apply transformation rules, import changes, method mappings
3. Use before/after examples as reference

**Parallelism:** Run independent tasks (`[P]` marked) in parallel as much as possible to maximize throughput.



**Error Handling:**
- Halt on non-parallel task failure
- For `[P]` tasks: continue successful ones, report failures

### Step 6.5: JS/TS Scaffolding Validation Gate (JS/TS projects only)

**After any scaffolding step that generates or modifies a `package.json`**, execute this gate before proceeding to the next task. This gate is MANDATORY for all JavaScript and TypeScript projects.

#### 6.5.1 — Verify required npm scripts

Check that `package.json` contains BOTH a `build` script AND a `test` script:

```bash
node -e "
  const pkg = require('./package.json');
  const missing = ['build','test'].filter(s => !pkg.scripts || !pkg.scripts[s]);
  if (missing.length) { console.error('MISSING scripts:', missing.join(', ')); process.exit(1); }
  console.log('scripts OK: build=' + pkg.scripts.build + ', test=' + pkg.scripts.test);
"
```

**If either script is missing**, inject it immediately — do NOT defer:

| Framework | Missing `test` script | Missing `build` script |
|-----------|----------------------|----------------------|
| Angular (`@angular/core` in deps) | `"test": "ng test --watch=false --browsers=ChromeHeadless"` | `"build": "ng build"` |
| React / Vite | `"test": "vitest run"` or `"test": "react-scripts test --watchAll=false"` | `"build": "vite build"` |
| React / CRA | `"test": "react-scripts test --watchAll=false --ci"` | `"build": "react-scripts build"` |
| Vue / Vite | `"test": "vitest run"` | `"build": "vite build"` |
| Next.js | `"test": "jest --ci"` | `"build": "next build"` |
| NestJS / Node | `"test": "jest --ci"` | `"build": "nest build"` |
| Generic TS | `"test": "jest --ci"` | `"build": "tsc"` |

After injecting, confirm the script was written and re-verify with the check above.

#### 6.5.2 — Run the test script

After confirming both scripts exist, execute:

```bash
npm test
```

(or `yarn test` / `pnpm test` if the project uses those package managers)

- **Exit code 0**: gate passes — proceed.
- **Exit code != 0**: enter a remediation loop (max 3 iterations):
  1. Read the failure output to identify the root cause (missing browser binary, missing test files, misconfigured jest config, etc.)
  2. Fix the cause (install missing dev dependency, create a minimal placeholder test, fix config)
  3. Re-run `npm test`
  4. If still failing after 3 iterations, record the failure in `batch-report.yaml` under `warnings` with severity HIGH and continue — do NOT block the entire batch:
     ```yaml
     warnings:
       - severity: HIGH
         message: "npm test failed after 3 remediation attempts — <last error summary>"
     ```

> **Why this gate exists**: Eval harnesses run `npm test` unconditionally. A scaffolded project without a `test` script causes an immediate fatal error (`npm error Missing script: "test"`) that masks all other results. Catching this at scaffolding time costs ~5 seconds; missing it causes total batch failure.

### Step 6.6: API Endpoint Verification (web-application backends only)

For any batch that produces or modifies a web-application backend (Spring Boot, Express, NestJS, FastAPI, Django, ASP.NET Core, Go HTTP servers, and similar), verify endpoints **respond correctly at runtime** before the batch is considered complete. A passing build proves only compilation, not that routes are wired up.

#### 6.6.1 — Run the discovered endpoint contract (if any)

If Step 5.5 found an endpoint contract script (`api-test.sh`, `api-check.sh`, …), start the application if not already running, then execute it:

```bash
bash ./api-test.sh   # or whichever script Step 5.5 recorded
echo "api-test exit code: $?"
```

- **Exit code 0** → all endpoint assertions pass → proceed.
- **Exit code != 0** → enter the fix loop (max 3 iterations):
  1. Read the output to identify which endpoints returned errors (missing route, wrong status code, unexpected body).
  2. Implement or correct the backend endpoint(s): add the missing controller/handler, fix route mapping, return the expected response shape.
  3. Re-run the script. Repeat until exit code is 0 or 3 iterations are exhausted.
  4. If still failing after 3 iterations, record the failure in `batch-report.yaml` under `warnings` with severity HIGH and escalate via `[notify:coordinator]` — do NOT mark the affected endpoints `implemented`.

#### 6.6.2 — Manual probe (no script found)

If no endpoint contract script exists, probe every REST endpoint the batch implemented after starting the application:

```bash
curl -sf -o /dev/null -w "%{http_code}" http://localhost:<PORT><endpoint>
```

Every implemented endpoint MUST return a 2xx status code. A 404 or 500 means the route is not wired correctly — fix before completing the batch. Record probe results in the batch report under `endpoint_probes`:

```yaml
endpoint_probes:
  - method: GET
    path: /api/dashboard
    status: 200
    result: PASS
```

### Step 7: Write Checkpoint

After ALL tasks in this batch complete, write `checkpoints/tasks-to-impl.yaml` using `templates/tasks-to-impl-checkpoint-template.yaml`. This is REQUIRED — completeness gate reads it to verify traceability.

### Step 8: Report

Generate batch result report per `references/batch-report-format.md` (YAML format).

**If `required_endpoints` was populated in Step 5.5**, update each entry's `status` to `"implemented"` once the corresponding endpoint is wired up and verified to respond correctly. Any entry still `"pending"` at report time is a gap — record it under `warnings` with severity HIGH:
```yaml
warnings:
  - severity: HIGH
    message: "Endpoint GET /api/dashboard was required by api-test.sh but not implemented in this batch"
```

## Resources

### References
- `references/source-anchored-rewrite.md` — Rewrite-mode behavioral fidelity process
- `references/ignore-patterns.md` — Ignore file patterns by language/tool
- `references/batch-report-format.md` — Required YAML output format

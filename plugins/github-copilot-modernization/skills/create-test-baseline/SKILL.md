---
name: create-test-baseline
description: Create a test baseline for the project to be modernized. The baseline will be used for later verification of modernization tasks.
---

# Goal

Produce a precise, executable-quality **specification** of the application's externally observable behavior that must be preserved across migration. The output is `test-cases/test-cases.md` plus the `test-cases/testdata/` fixtures it references — **no test code is generated in this phase**. The `verify-test-baseline` skill consumes this spec to generate `*PostMigrationIT` tests against the new implementation.

## User Input

- **migration-scope**: The scope of the migration, e.g. "migrate from AWS S3 to Azure Blob Storage", "upgrade from Java 8 to Java 11" etc.
- **taskid**: Identifier for this baseline run, used to namespace the summary report.
- **modernization-work-folder**: Folder under which the summary report is written.

## Principles

- The spec describes behavior at **external boundaries only** — HTTP endpoints, CLI commands, public API surfaces, published/consumed events, message queues, scheduled tasks, webhooks. No service-specific SDK types, no backend implementation details.
- The spec must be **precise enough to be transformed into test code mechanically**. Vague phrases ("should return a reasonable error", "behaves as expected") are defects, not descriptions.
- All payload data is **externalized** under `test-cases/testdata/` as files. The spec references them by path (relative to `test-cases/`). No inline byte literals, no hand-built JSON strings in the spec.
- `test-cases/test-cases.md` and `test-cases/testdata/` are **FROZEN** after this skill completes — never modified, renamed, moved, or deleted by subsequent phases.
- **No `*BaselineIT` test code is produced.** The migration uses a replace strategy: any code that exercises the old implementation would either import old SDKs (which get deleted) or substitute internal services for the real entry point (which defeats the purpose). All executable tests are produced in the verify phase against the new implementation.
- **The module is the test-case boundary.** In a multi-module project, each module that is in scope produces its own independent `test-cases.md` under that module's test source root. A module's `test-cases.md` MUST contain only test cases whose entry points belong to that module. Never place test cases for one module inside another module's `test-cases.md` (e.g. API-gateway module test cases must not appear in a backend-services module's spec).
- **Skip modules with no migration-relevant resource access.** If a module's code does not directly interact with any resource being migrated (e.g. it never calls Azure/AWS/GCP SDKs, never accesses a database or message broker that is part of the migration scope), do not create `test-cases/` for that module. A module that only serves as a thin HTTP frontend delegating to another module's backend services — without touching any migrated resource itself — does not need test cases.
- **Mock cross-module and non-migration-related dependencies.** When a module's entry point calls a service provided by another module (e.g. a shared service in a sibling module) or an external service unrelated to the migration scope, mark that dependency as **mock** in the infra decision table. The `verify-test-baseline` skill handles the actual mock implementation.
- **Respect existing integration tests.** Scan for existing IT / integration / E2E tests before writing new test cases. Do not duplicate coverage they already provide — reference them and fill gaps only. New test cases MUST follow the same conventions (naming, framework, assertions, fixtures, helpers) observed in existing tests.

## Output Layout

Frozen baseline artifacts live under a dedicated `test-cases/` subdirectory of the project's **test source root** — the standard directory the build tool already uses for tests (e.g. `src/test/` for Maven/Gradle Java modules, `tests/` for Python / Node / Go projects, `<module>/test/` for multi-module repos). In a multi-module repo, place artifacts under each module's own test source root. Do NOT invent a new top-level folder.

The per-run summary report lives under the modernization work folder, not the test source root.

```
<test-source-root>/
└── test-cases/                 # FROZEN — entire folder is the baseline spec bundle
    ├── test-cases.md           # FROZEN — the full behavioral spec
    ├── infra-decision-table.md # FROZEN — mock/real/testcontainer decision per external dependency (Step 2)
    └── testdata/               # FROZEN — fixtures referenced by test-cases.md
        ├── inputs/             # raw input files (images, JSON payloads, CSV, etc.)
        ├── expectations/       # golden outputs at the application boundary
        └── ...                 # other data as needed (configuration, seed data, etc.)

${modernization-work-folder}/${taskid}/
└── baseline-summary.md         # NEW — per-run summary (Step 6)
```

All paths inside `test-cases.md` (e.g. `testdata/inputs/sample.jpg`) are interpreted **relative to `<test-source-root>/test-cases/`**, the folder that contains `test-cases.md`.

## Workflow

### Step 1: Inventory External Boundaries and Orchestration Entry Points

Scan the production source for everything that constitutes an external boundary or orchestration entry point. Record each one with file path, symbol, and **owning module** so it can be cross-checked in Step 2.

**What qualifies as an entry point** (principle, not a closed list):

An entry point is any code location invoked by something **outside the application's own call graph** — the network, the OS, the runtime scheduler, a message broker, an external SDK consumer, etc. If the application does not call it itself, it is an entry point.

Typical examples (use as hints, not as an exhaustive checklist — apply the principle above to whatever the codebase actually uses):

- Network-facing handlers (HTTP / REST / gRPC / GraphQL controllers, routers, webhook receivers)
- Process-level entries (CLI commands, `main` methods, background workers)
- Runtime-invoked callbacks (scheduled / cron jobs, framework-triggered lifecycle hooks)
- Broker-driven consumers (message-queue listeners, streaming / pub-sub subscribers)
- Container-invoked enterprise bean entry points (EJB remote/local business methods, message-driven beans)
- Published library / SDK methods — public methods that are never called from within the same module (i.e. only invoked by external consumers)

Every orchestration entry point in the migration scope MUST be covered by at least one **end-to-end** test case that triggers it with realistic input and verifies the final observable outcome. Test cases that exercise only helpers called *within* an entry point do NOT count toward this requirement.

**Multi-module scoping:** Group entry points by owning module. For each module, determine whether it directly accesses any resource being migrated (databases, message brokers, cloud storage, caches, etc. that are in the migration scope). Modules whose code never directly interacts with a migration-relevant resource are **out of scope** — do not produce test cases for them. Record the per-module decision (in-scope / out-of-scope with reason) so it is auditable in the baseline summary.

### Step 2: Inventory Existing Integration Tests

Scan the project's test source roots for existing IT / integration / E2E tests. Map each existing test to the entry points inventoried in Step 1 and note which coverage categories (happy-path, boundary, special-input, failure) it covers.

Also extract the project's testing conventions: naming patterns, test framework and assertion style, fixture/test-data organization, helper utilities, and infrastructure setup (Testcontainers, embedded servers, mocks, etc.). These conventions are binding — the `verify-test-baseline` skill MUST follow them when generating test code.

Include the existing test inventory and extracted conventions in the baseline summary (Step 7).

### Step 3: Write `test-cases.md`

For each **in-scope module** (as determined in Step 1), produce `<module-test-source-root>/test-cases/test-cases.md` using [test-cases-template.md](test-cases-template.md). Each module gets its own independent spec file containing only test cases for entry points that belong to that module.

**Existing test alignment rules:**
- If an existing test already covers an entry point + category, mark it as `covered-by-existing` in the spec with the test's fully qualified name. Do NOT duplicate it.
- New test cases fill coverage gaps only and MUST follow the conventions extracted in Step 2.

**Module isolation rules:**
- A module's `test-cases.md` MUST NOT contain test cases for entry points defined in other modules.
- When an entry point in module A calls a service in module B, note the cross-module dependency in the test case's `Preconditions` field (e.g. "Service B returns X"). The infra decision table marks it as **mock**; the `verify-test-baseline` skill handles the actual mock implementation.
- External services unrelated to the migration scope (third-party APIs, internal microservices outside the project) are noted as dependencies and marked **mock** in the infra decision table.

For each entry point, cover the **four coverage buckets**:

1. **Happy path** — typical valid input, normal outcome.
2. **Boundary values** — empty, max-size, page boundaries, off-by-one cases.
3. **Special inputs** — unicode, reserved characters, missing referenced resources, idempotency keys.
4. **Failure mapping** — simulated backend / dependency failure → application-level response.

Use **2–5 representative records per entity** (table row, queue message, container object, etc.).

**Every test case MUST have all required fields populated** — see "Required field checklist" below. Missing or vague fields make the spec unverifiable and must be filled in before freezing.

### Step 4: Externalize Test Data

For every payload referenced in `test-cases.md`, create a file under `<test-source-root>/test-cases/testdata/` and reference it from the spec as `testdata/...` (i.e. relative to `<test-source-root>/test-cases/`).

**Requirements:**
- Organize by purpose: `inputs/`, `expectations/`, `configuration/`, `seed-data/`.
- If existing tests already use fixture files, prefer reusing them or following the same directory structure and naming conventions. Copy or reference existing fixtures under `testdata/` rather than inventing a parallel layout.
- No inline byte literals, hardcoded keys, or hand-built JSON strings in `test-cases.md`. Every `Input` and `Expected Output` block either references a file or contains a small structured value (status code, exit code, scalar string) that does not warrant a file.
- File names should be descriptive and stable: `sample.jpg`, `upload-request.json`, `error-not-found.json`.

### Step 5: Build Infra Decision Table (mock vs real vs testcontainer)

With the full set of test cases and their referenced dependencies now visible, decide which external dependencies the post-migration tests will exercise as **real** resources, **testcontainer** resources, or **mock** at the SDK / HTTP boundary. This decision is recorded once here and is reused as-is by `verify-test-baseline` — verification does not re-decide.

**Inputs:**
- The exhaustive list of external dependencies actually touched by the test cases written in Step 3 (cross-checked against the entry-point inventory from Step 1).
- The mock/real/testcontainer decisions already made by existing tests (from Step 2). Prefer consistency with existing tests unless there is a clear reason to diverge.
- The repo-root `infra/` directory (`*.md`, `*.yml`, `*.yaml`) **if it exists**. If the user has scheduled an infrastructure-provisioning task before baseline setup, run it first so that `infra/` reflects the resources that will actually be available at verification time.

**Mandatory user confirmation before drafting rows:**
- Confirm the integration-test environment mode with the user: `real`, `mock`, `testcontainer`, or `mixed` (per dependency). Reuse the answer from the planning questionnaire when available; if missing and an interactive question tool is available, ask explicitly before generating the table.

**Rules:**
- If the confirmed mode is `mock`: mark every dependency **mock** regardless of `infra/` presence.
- If the confirmed mode is `real`: dependency present in `infra/` (provisioned endpoint + credentials) → **real**.
- If the confirmed mode is `real` and a dependency is not present in `infra/`, mark it **mock** at the SDK / HTTP boundary and record that it is not provisioned.
- If the confirmed mode is `testcontainer`: dependency with a supported emulator/containerized dependency strategy → **testcontainer**.
- If the confirmed mode is `testcontainer` and a dependency has no viable emulator/container strategy, mark it **mock** and record `no-testcontainer-emulator` as the reason.
- If the confirmed mode is `mixed`: the mode is per dependency — ask the user for the decision per row, then apply the `real`, `testcontainer`, or `mock` rules above for each dependency individually.
- If `infra/` does not exist at all and mode is not `testcontainer`, mark every external dependency as **mock** and record `infra-missing` as the reason.
- **Cross-module service dependencies** (e.g. module A calling a service API in module B) → always **mock**. Each module's tests are self-contained; inter-module calls are mocked at the service interface boundary.
- **External services unrelated to the migration scope** (third-party APIs, internal services outside the project, legacy systems not being migrated) → always **mock**, regardless of `infra/` presence.

**Confirm with the user before saving.** Draft the full table in chat first, then — if an interactive user-question tool is available in the current environment (e.g. `ask_user`, `vscode_askQuestions`, or any equivalent surfaced by the host) — use it to present the draft and ask the user to confirm or correct each row's `Decision` and `Auth Method`. Apply any corrections, then write the file. If no such tool is available, skip the prompt and proceed to save (do not block the workflow).

**Output:** save to `<test-source-root>/test-cases/infra-decision-table.md` using [infra-decision-table-template.md](infra-decision-table-template.md). One row per dependency, all columns required. The template defines the canonical column set, allowed values, decision rules, and banned phrasings.

This file is part of the frozen baseline bundle (see Step 7) and is consumed as-is by `verify-test-baseline`. Do not proceed to Step 6 until the table is saved.

### Step 6: Validate the Spec (Required Field Checklist)

Before declaring the baseline frozen, validate `test-cases.md` against this checklist. Each test case MUST satisfy every item, or it is not ready to freeze.

| # | Field | Validation rule |
|---|---|---|
| 1 | `ID` | Unique, format `TC-<MODULE>-<NNN>` (e.g. `TC-WEB-001`, `TC-WKR-002`). |
| 2 | `Category` | One of: `happy-path`, `boundary`, `special-input`, `failure`. |
| 3 | `Entry Point Type` | A short, consistent label describing the invocation mechanism (e.g. `HTTP`, `CLI`, `Scheduled`, `Message-queue listener`). The same mechanism must use the same label across all cases. |
| 4 | `Entry Point` | Exact identifier from production code: HTTP method+path, fully qualified method, CLI command, queue/topic name, service interface + method signature. No vague references. |
| 5 | `Trigger` | Concrete, technology-agnostic description of how the entry point is invoked: payload reference, headers, argv, message body. Sufficient for a code generator to construct the call. |
| 6 | `Preconditions` | All required application / resource state before the trigger, with references to `testdata/` for any seed data. Use `none` if truly none. |
| 7 | `Expected Response` | The synchronous return at the entry point: status code + body file reference for HTTP, exit code + stdout/stderr file references for CLI, return value for methods. Use `none (fire-and-forget)` for async listeners with no synchronous response. |
| 8 | `Resource Verification` | At least one bullet, OR explicit `none` with justification. Each bullet names a specific resource (object key, row PK, queue name + message shape) and the observable state. Stated in resource-neutral terms so the same check applies pre- and post-migration. |
| 9 | `Negative Verification` | For failure / skip / no-op cases, list what MUST NOT happen (e.g. "no new row in `image_metadata`"). Mandatory whenever `Category` is `failure` or behavior is "skip". |
| 10 | `Data References` | All file paths under `testdata/` cited in the case actually exist. |

**Banned phrasings** (auto-reject):
- "should return a reasonable error" → must state exact status + body.
- "behaves as expected" / "works correctly" → must state observable outcome.
- "approximately N items" → must state exact count or a precise range with bound semantics.
- "etc." in expected outputs → enumerate completely.
- Hand-waved resource checks ("data is persisted") → must name the resource and the field-level state.

**Entry-point coverage check**: every orchestration entry point cataloged in Step 1 appears as the `Entry Point` of at least one `happy-path` test case AND at least one `failure` test case. An entry point counts as covered if it is covered by an **existing test** (referenced as `covered-by-existing` in Step 3) OR by a **new test case** in `test-cases.md`. Both sources count toward the coverage requirement.

Any validation failure → fix the spec. Do not freeze with defects.

### Step 7: Freeze and Output

1. Declare the entire `<test-source-root>/test-cases/` folder **FROZEN**. Subsequent phases must not modify anything inside it; any required change forces a re-freeze cycle (unfreeze → amend → re-validate → re-freeze).
2. Create `${modernization-work-folder}/${taskid}/baseline-summary.md` summarizing: per-module scoping decisions, entry-point inventory, existing test inventory and extracted conventions (from Step 2), test case counts (existing-covered vs. new) by category per module, `testdata/` file list, the Step 5 infra decision table, and confirmation that the Step 6 checklist passed.
3. Commit the changes.
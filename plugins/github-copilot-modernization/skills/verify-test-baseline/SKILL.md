---
name: verify-test-baseline
description: Generate and run post-migration tests from the frozen baseline specification.
---

# Goal

Generate executable `*PostMigrationIT` tests from the frozen baseline specification and run them against the migrated application. 

The baseline phase produces **no test code** — it produces a precise specification, including the test-cases, infra-decision-table, and testdata. This skill is the sole place where integration test code is generated. 

When the baseline decision table includes `testcontainer` rows, verification MUST run those dependencies against containerized emulators/services (not cloud resources and not mocks).

## User Input

- **taskid** — Identifier for this verification run.
- **modernization-work-folder** — Folder under which the verification summary and decision table are written.

## Terminology

**Event-sourced subscriber** — any entry point invoked by an external event source rather than by a synchronous caller: message-queue listeners, event-bus / event-hub / event-grid handlers, storage-event triggers (e.g. blob-created or object-deleted handlers), DB change-feed / CDC handlers, inbound-email handlers, file-system watchers. Throughout this document, "event-sourced subscriber" refers to this entire family; the only legitimate trigger for such an entry point is a real event produced on the declared source via its SDK or wire protocol.

**Testcontainer dependency** — an external dependency marked `testcontainer` in `infra-decision-table.md`; verification must instantiate and use a containerized emulator/service for that dependency via the project's Testcontainers stack.

## TestContainer References

When any dependency is marked `testcontainer`, read and apply these references before writing tests:

- [azure-auth-strategies.md](../modernization-integration-tests/references/azure-auth-strategies.md)
- [azure-servicebus-testcontainers.md](../modernization-integration-tests/references/azure-servicebus-testcontainers.md)
- [azure-storage-testcontainers.md](../modernization-integration-tests/references/azure-storage-testcontainers.md)

## Principles

- The spec is the source of truth. If a test case cannot be generated from its fields as-written, the defect is in the spec — coordinate a re-freeze (Step 8), do not invent details in the generated test.
- Post-migration tests are **additions**, never replacements.
- **Strict 1:1 mapping.** Exactly one test method per `TC-*` in `test-cases.md`. No extra tests, no missing tests. Test method count == TC count. **Banned extras include:** infrastructure connectivity tests ("can connect to DB", "can create SDK client"), SDK sanity tests ("can send/receive message", "can read secret"), backing-store CRUD tests that have no entry point in the inventory, and authentication/credential validation tests. If it is not a `TC-*`, it must not exist.
- **TC-ID traceability.** Every test method MUST include its `TC-*` ID in the method name itself (e.g. `tcEjb001_collectLocationHappyPath`, `tc_ejb_001_collect_location_happy_path`). A comment or display name alone is insufficient — the method name is the primary index for auditing coverage.
- **Trigger fidelity over convenience.** The trigger is the contract. Any test whose trigger is not the declared `Entry Point` — for example, one that invokes a cloud SDK, a repository, an internal service, or a private helper instead — is invalid and must be regenerated, even if it passes. If the spec declares an application method as the entry point, the test MUST call that method through its public interface — not re-implement the logic inline using lower-level APIs (e.g. direct DB writes, manual computations). If the spec declares a message-queue listener as the entry point, the test MUST send a message to the queue — not call the listener's handler or an internal service directly.
- **Assertion completeness.** A test must assert every bullet under `Expected Response`, `Resource Verification`, and `Negative Verification`. Existence-only or no-throw-only checks (asserting only that a resource exists, that a call did not throw, or that a value is non-null) are insufficient on their own.
- **No production-bug workarounds.** If a test fails because the migrated code is wrong, hand the work back to the migration engineer per Step 7. Do not patch the test to bypass the broken entry point, and do not loosen / rewrite assertions to accept the buggy response. "Documenting the current behavior" by changing expected response codes, status, or payload to match what the broken code returns is a workaround — not a fix.
- **No hardcoded environment topology.** Generated tests must not hardcode environment-specific resource identifiers (account names, namespaces, queue/topic names, hostnames, connection strings, tenant/subscription IDs, database hosts, secrets). Resolve these from test-only configuration wired to `infra/` outputs and environment variables.
- **No Azure resource writes.** This skill MUST NOT create, update, delete, or otherwise modify Azure resources. Any `az` CLI command that performs a write operation (e.g. `az role assignment create`, `az storage account create`, `az keyvault set-policy`, `az group create`, `az resource update`, `az ad app create`) is forbidden. Read-only `az` commands (e.g. `az account show`, `az role assignment list`, `az resource list`) are permitted for diagnostic purposes only. If a missing role assignment, resource, or configuration is identified, hand over to the Infra Expert per Step 7 — do not provision or reconfigure Azure resources from within this skill.

## Layout

Inputs (frozen, produced by the setupBaseline task) live under each in-scope module's **test source root** — the directory the build tool already uses for tests (e.g. `src/test/` for Maven/Gradle Java, `tests/` for Python / Node / Go, `<module>/test/` for multi-module repos). In a multi-module project, each module that was determined to be in-scope during the baseline phase has its own independent `test-cases/` folder. Modules that were marked out-of-scope (no migration-relevant resource access) will not have a `test-cases/` folder — skip them.

```
<test-source-root>/
└── test-cases/                 # FROZEN folder — created in Phase 1
    ├── test-cases.md           # FROZEN — the behavior spec (scoped to this module only)
    ├── infra-decision-table.md # FROZEN — mock/real/testcontainer decision per external dependency
    └── testdata/               # FROZEN — fixtures referenced by test-cases.md
```

Outputs of this skill:

- `${modernization-work-folder}/${taskid}/post-migration-plan.md` — the TC→test planning table written in Step 4 (created/overwritten on each run).
- `*PostMigrationIT` source files — follow the project's existing test layout conventions.
- `${modernization-work-folder}/${taskid}/verification-summary.md` — final report (Step 9).

Reused inputs from the baseline phase:

- `<test-source-root>/test-cases/infra-decision-table.md` — mock/real/testcontainer decision per external dependency, produced by `create-test-baseline`. This skill consumes it as-is.

## Workflow

### Step 1 — Verify Baseline Integrity

For each in-scope module, locate `<module-test-source-root>/test-cases/` and confirm `test-cases.md`, `infra-decision-table.md`, and `testdata/` are byte-identical to the baseline commit. Any drift → request revert. If `test-cases.md` is missing entirely for a module that was marked in-scope, abort: the setupBaseline task was supposed to run first — surface this as a plan-ordering bug, do not proceed. Modules without a `test-cases/` folder were determined out-of-scope during the baseline phase (no migration-relevant resource access) — skip them.

### Step 2 — Load Infra Decision Table from Baseline (mandatory gate)

The mock/real/testcontainer decision for every external dependency is made in the baseline phase, not here. Verification reuses it as-is.

1. Load `<test-source-root>/test-cases/infra-decision-table.md` produced by `create-test-baseline`. If it is missing, abort and surface this as a plan-ordering bug — do not regenerate it here.
2. Sanity-check the table against runtime prerequisites:
  - every row marked **real** must still have a matching provisioned resource in `infra/`.
  - every row marked **testcontainer** must still have a viable emulator/container strategy (image, config, dependency containers, and test framework support) in the repo and test runtime.
  If prerequisites drift (resource removed, endpoint changed, credential type changed, missing emulator config, unsupported testcontainers version), surface the drift → Step 8 (re-freeze cycle); do not silently downgrade decision modes here.
3. Treat the loaded table as the source of truth for all subsequent steps.

Do not proceed until the table is loaded and the sanity check passes.

### Step 3 — Validate Spec Readiness

Before generating code, audit `test-cases.md` against the **Required Field Checklist** defined in Step 5 of the `create-test-baseline` skill.

- Every test case has all required fields populated (ID, Category, Entry Point Type, Entry Point, Trigger, Preconditions, Expected Response, Resource Verification, Negative Verification where required, Data References).
- No banned phrasings remain.
- Every `testdata/...` path referenced exists.
- The Entry-Point Inventory matches what is exercised by the cases.

Any defect → Step 8 (re-freeze cycle). Do not paper over spec defects in generated code.

### Step 4 — Plan Post-Migration Tests

Inputs: `test-cases.md`, the infra decision table loaded in Step 2.

1. **Mirror the spec, exactly once.** For each `TC-*` in `test-cases.md`, plan exactly one test method. No extra tests. No collapsing two TCs into one. No splitting one TC across multiple test methods (sub-steps go inside the single method body).
2. **Map each entry point to its concrete trigger mechanism on the new stack.** The `Trigger` field is technology-agnostic; resolve it to the actual mechanism that exists in the migrated codebase. Always trigger via the same outside-in path the entry point is invoked from in production. Pick the most realistic public driver the test framework offers:
   - HTTP / network handlers → framework's HTTP test client.
   - CLI commands → CLI runner / process invocation.
   - Library APIs → call the published API directly.
  - EJB entry points (remote/local business interfaces) → invoke through the container-managed EJB interface/proxy used by external callers; do not call bean implementation classes directly.
   - **Event-sourced subscribers** (see Terminology) → produce a real event on the declared source via its SDK or wire protocol (publish a message to the queue/topic, upload/delete the blob, insert/update the watched DB row, send an SMTP message, write the watched file). The application is the subscriber; the only realistic trigger is a real event on the source it subscribes to.
   - Scheduled jobs / cron → framework's "run now" hook (e.g. scheduler `triggerJob`, manual invocation of the scheduled-task dispatcher). This is framework-driven, not SDK-driven.

   When in doubt, prefer the mechanism a real external caller or event source would use over a test-only shortcut.
3. **Reject in-spec but infeasible decision-mode cases early.** If a test case requires failure injection on a dependency marked **real** or **testcontainer** (e.g. "storage unavailable", "backend throws IOException", "corrupt object content") and there is no way to trigger that condition from the declared entry point under that mode, do not silently skip and do not silently switch modes — surface the conflict → Step 8 (re-freeze) so the infra-decision-table is amended or the case is reformulated.
4. **Close entry-point coverage gaps.** Scan production code for orchestration entry points. For each one not present in the Entry-Point Inventory of `test-cases.md`, surface the gap → Step 8 (re-freeze) so the spec is updated first. Do not silently add post-migration-only cases.
5. **Produce a planning table (mandatory artifact).** Before writing any code, emit the TC→test mapping table and **save it to `${modernization-work-folder}/${taskid}/post-migration-plan.md`** (create or overwrite). The file MUST contain one row per `TC-*`; rows whose `Trigger Mechanism` is anything other than the declared entry point's outside-in driver, or whose `Fixtures Loaded` is empty while `Data References` is non-empty, must be revised before proceeding. The same table is later linked from the Step 9 verification summary.

   | TC ID | Test Location (class/file → method) | Declared Entry Point | Trigger Mechanism (concrete) | Fixtures Loaded (from `Data References`) | Non-mock Deps Touched (`real`/`testcontainer`) | Config Source | Cleanup Path |
   |---|---|---|---|---|---|---|---|
   | TC-XXX-001 | _e.g._ `FooPostMigrationIT.uploadHappyPath` | _e.g._ `POST /foo/upload` | _e.g._ HTTP test client multipart POST to `/foo/upload` | `testdata/inputs/sample.jpg`, `testdata/expectations/upload-success.json` | _e.g._ Blob (`testcontainer`), Queue (`real`) | _e.g._ `application-integrationtest.yml` + env vars mapped from `infra/` outputs and Testcontainers runtime properties | _e.g._ `POST /foo/delete/{key}` |

   The row above is illustrative; use the test-class / method / driver naming conventions of the migrated project's language and framework.
   `Config Source` is mandatory and must name where each non-mock dependency endpoint/identifier comes from. Any row that implies inline literals in test code must be revised before generation.

#### Forbidden trigger patterns (rejected by the Step 5 pre-generation audit)

- HTTP entry point in spec, but the test calls a cloud / storage / messaging SDK directly as the trigger _(e.g. invoking a blob client's upload method, a queue sender client's send method, an object-store put-object call)_.
- HTTP entry point in spec, but the test calls an internal application service, handler, repository, or sender component directly as the trigger.
- EJB entry point in spec, but the test calls the bean implementation class directly (or reflection-invokes its methods) instead of invoking through the container-managed EJB interface/proxy.
- Event-sourced subscriber entry point in spec (see Terminology), but the test calls the subscriber's internal handler method directly _(e.g. invoking the processing service method that the listener delegates to, or feeding a hand-built mocked message/event context into the handler, including via reflection on a private method)_ instead of producing a real event on the declared source.
- Scheduled job entry point in spec, but the test calls the job's run method directly instead of using the framework's scheduled-task invocation hook.
- Backing store (DB, cache, blob container, search index, etc.) used as the *trigger* of a test when no entry point in the inventory exposes that store. Backing stores are not entry points; they may only appear in **Preconditions / Resource Verification**, never as the trigger.
- Any private helper in the test that re-implements production parsing or key-derivation logic _(e.g. a local copy of an "extract original key from thumbnail key" routine)_ — assert against the spec's declared post-state, not against a re-derived expectation.
- Any test helper that re-implements the entry point's **business logic** _(e.g. manually writing to a DB and computing a classification value inline, instead of calling the application method that does both)_. The test must call the actual entry point and verify its output — not simulate what the entry point would do.
- Any test class that tests SDK/infrastructure capabilities (DB connectivity, message broker send/receive, secret retrieval, credential validation) without mapping to a `TC-*` in the spec. These are not post-migration integration tests.

### Step 5 — Generate Post-Migration Tests

#### Pre-generation trigger audit (mandatory gate)

Before writing any test code, emit a **trigger-line pseudocode table** for every planned test method. For each row, write the single line of code (or pseudocode) that will serve as the trigger, then self-check it against the Forbidden trigger patterns in Step 4. The table format:

| TC ID | Trigger pseudocode | Entry Point Type (from spec) | Violates Step 4 forbidden patterns? |
|---|---|---|---|
| TC-XXX-001 | `serviceBusSender.sendMessage(queue, messageBody)` | Message-queue listener | No — publishes real event to declared source |

Any row whose last column is anything other than `No` MUST be revised until it passes. Do not proceed to code generation with any unresolved row.

#### Trigger rules

- **Trigger only via the declared entry point.** The constraint applies to the **trigger** of the test, not to setup/teardown. See the Forbidden trigger patterns in Step 4 for the concrete anti-patterns that must be rejected.
- **Seeding preconditions and resource verification may use SDKs directly.** When a test case's `Preconditions` or `Resource Verification` requires state on a real or testcontainer-backed resource (object in a container, row in a table, message on a queue) and the application exposes no public entry point to create or read that state, the test setup / verification step MAY call the resource's SDK directly. Seed data comes from `testdata/`. This is setup/observation, not the trigger.
- **Async event-sourced tests** must wait on the **observable post-condition** using the language/framework's idiomatic async-wait helper that polls until the condition holds or a timeout elapses _(e.g. an `Awaitility`-style polling helper in JVM languages, `WaitFor` / polling loops in .NET, `pytest`-style retry helpers in Python)_. Never use a fixed-duration sleep, and never assert immediately after emitting the event.

#### Assertion rules

- **Every bullet in the spec is an assertion.** Walk `Expected Response`, `Resource Verification`, and `Negative Verification` bullet-by-bullet. Each bullet maps to at least one assertion in the test body. Missing any bullet → regenerate.
- **Load every fixture in `Data References`.** Each path under `Data References` must be loaded by the test through the language's normal resource-loading mechanism _(e.g. classpath resource stream in JVM, embedded resource / file read in .NET, file open in Python/Node/Go)_ and used either as input or as the expected value for an assertion. Unused fixtures are a planning bug — either the test under-asserts, or the spec lists a fixture it doesn't need (→ Step 8).
- **No existence-only / no-throw-only tests.** Assertions that only check resource existence, only check that a call did not throw, or only check non-null do not satisfy `Resource Verification`. Assert content, fields, sizes, statuses, redirect targets, message bodies, and DB column values exactly as the spec states.
- **Negative verification is mandatory where the spec lists it.** For every bullet under `Negative Verification` _(e.g. "no new row inserted", "no message published", "no thumbnail created")_, the test must perform the observation that proves the negative — not just skip it.

#### Test isolation rules

- **One TC = one independent test method.** No shared mutable state across test methods in the same class/module. No ordered-execution chains where one method's success is required for the next _(e.g. JUnit `@Order`, NUnit `[Order]`, xUnit `IClassFixture` for ordering, pytest fixture ordering tricks)_. No skip-when-previous-test-passed coupling _(e.g. `Assumptions.assumeTrue(previousState != null)`, `Skip.If(...)`)_. Every test sets up its own preconditions and tears them down.
- **Random keys per test run.** Use a fresh unique suffix (GUID / random string / timestamp+nonce) for every created entity; never deterministic names, since real resources are shared across parallel runs and re-runs.

#### Stack & dependency rules

- **Boot the full application stack** — no sliced/partial test contexts when any dependency is "real" or `testcontainer`.
- **Real dependencies stay real.** Do not stub, fake, or mock anything marked "real" in the decision table at any layer.
- **Testcontainer dependencies stay testcontainer-backed.** Do not replace `testcontainer` rows with mocks or cloud resources; instantiate and wire the required emulator/service containers.
- **Mocked dependencies** (only those marked "mock"): mock at SDK / HTTP boundary, seed from `testdata/`, assert on outbound requests as well as return values.
- **Cross-module service dependencies** (marked "mock" in the decision table): mock at the service interface boundary so each module's tests are self-contained. The test verifies the module's own behavior given controlled responses from the mocked cross-module dependency. Do not let cross-module calls fall through to a real sibling module.
- **Non-migration-scope external services** (marked "mock" in the decision table): mock at the SDK / HTTP boundary. These include third-party APIs, internal services outside the project, and legacy systems not being migrated.
- **Test-only configuration** points to:
  - real endpoints from `infra/` for `real` rows, and
  - dynamic container endpoints/connection strings for `testcontainer` rows,
  via the project's standard mechanism (Spring profile, `.env`, `appsettings.IntegrationTest.json`, env vars). Activated for these tests only; do not modify production config.

#### Auth rules

- **Auth requirements depend on the infra decision table.**
  - `real` rows: cloud credentials are required.
  - `testcontainer` rows: cloud credentials are NOT required; use emulator/container credentials or anonymous/local auth.
  - `mock` rows: no cloud credentials required.
- **Pre-flight auth check** in test setup, applied per real dependency the test touches.
  - **Local runs (non-Azure host).** Managed Identity is unavailable — the test MUST authenticate as the developer's `az login` principal (e.g. via `DefaultAzureCredential` / `AzureCliCredential`). Do not fabricate a managed-identity client ID, do not point at IMDS, and do not require a service-principal secret for local runs.
  - **CI / Azure-hosted runs.** Use the configured Managed Identity when available, otherwise the CI service-principal env vars (`AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_CLIENT_SECRET` or federated credentials).
  - **The pre-flight check is a fail-fast gate, not a silent-skip.** If credentials for a real dependency are missing or insufficient, the test MUST fail loudly (assertion failure / explicit error) so Step 7 picks it up as an **Infra issue** and escalates. Do NOT implement "gracefully abort / mark as skipped / return early" patterns _(e.g. `Assumptions.assumeTrue(credentialsAvailable)`, `Skip.If(...)`, JUnit `@EnabledIfEnvironmentVariable`, early `return` in `@BeforeAll`, try/catch that swallows the auth exception)_ — those let the verification phase complete with zero real assertions executed against the migrated stack.
  - **All-mock and all-testcontainer tests do not skip on missing cloud credentials.** If a test's dependencies include no `real` rows, it must run unconditionally; a missing `az login` is not a valid reason to skip.

#### Cleanup rules

- **Cleanup via entry points first.** Prefer the application's own delete entry point for cleanup so test credentials need no extra data-plane permissions. Fall back to SDK cleanup only when no delete entry point exists. Run cleanup in `finally` / teardown; ignore "not found". Never use SDK cleanup as a workaround for a broken application delete path — if the application's delete entry point fails, that is a production bug (Step 7), not a cleanup-strategy choice. For mocked dependencies, cleanup is reset of in-memory state — still required so tests stay independent.

### Step 6 — Validate and Run

Before running, run the **pre-run validation checklist** against generated code. Any `No` → regenerate (Step 5) or escalate to Step 8. Do not proceed to execution with a failing checklist.

**Coverage & mapping**

- [ ] Test method count equals `TC-*` count in `test-cases.md` (no extras, no missing). **Zero test classes may exist that are not mapped to at least one TC-*.** Infrastructure-only, SDK-sanity, or connectivity test classes are forbidden.
- [ ] Every `TC-*` is referenced by exactly one test method whose **method name contains the TC-ID** (e.g. `tcEjb001_...`). A comment or `@DisplayName` alone is insufficient.
- [ ] No test class / module exists for an entry point absent from the Entry-Point Inventory (no DB-only / cache-only / SDK-only test class when those are backing stores rather than entry points).
- [ ] `${modernization-work-folder}/${taskid}/post-migration-plan.md` exists and has one row per `TC-*`.

**Trigger correctness (per test)**

- [ ] The line that invokes the system under test matches the declared `Entry Point` and does not match any pattern in Step 4 "Forbidden trigger patterns".
- [ ] For event-sourced subscriber entry points (see Terminology): the trigger produces a real event on the declared source via its SDK or wire protocol; an async-wait helper polls for the post-condition; no direct call to the subscriber's handler method (including via reflection) and no hand-fabricated message/event context.

**Assertion completeness (per test)**

- [ ] Every bullet under `Expected Response` is asserted.
- [ ] Every bullet under `Resource Verification` is asserted.
- [ ] Every bullet under `Negative Verification` is asserted (where the spec lists it).
- [ ] Every path in `Data References` is loaded by the test.
- [ ] No test relies solely on existence / non-null / no-throw assertions.

**Isolation**

- [ ] No shared mutable state across test methods.
- [ ] No ordered-execution chains where later tests depend on earlier tests succeeding.
- [ ] All created entities use random suffixes.

**Infra alignment**

- [ ] No mocks/stubs/fakes for any "real" or `testcontainer` dependency.
- [ ] Full application stack boots when any dependency is "real" or `testcontainer`.
- [ ] Test-only configuration exists and points at real endpoints in `infra/` for `real` rows and container endpoints for `testcontainer` rows.
- [ ] No hardcoded environment-specific topology in generated test source; all dependency identifiers/endpoints are supplied via test-only config and/or env vars.
- [ ] No generated "global cleanup" or "queue drain" step that alters shared resources beyond the TC-scoped setup/cleanup required by the spec.
- [ ] No test case requires failure injection (e.g. "storage unavailable", "backend throws IOException") on a dependency marked **real** or `testcontainer` without the ability to trigger that condition from the declared entry point. Any such case should have been surfaced in Step 4.3 and sent to Step 8 (re-freeze).

Run all `*PostMigrationIT` tests. Required: **100% pass**, and the run MUST be a real execution that reached the application. For each TC, dependencies must follow the decision table exactly: `real` rows hit real provisioned resources, `testcontainer` rows hit instantiated containers/emulators, and `mock` rows are served by configured test doubles.

**Execution is mandatory — compile/unit-test success is not verification.**

- Invoke the project's integration-test phase explicitly _(e.g. Maven `mvn verify` / `mvn failsafe:integration-test`, Gradle `./gradlew integrationTest`, `dotnet test` against the IT project, `pytest tests/integration`, `go test -tags=integration ./...`)_. Confirm from the runner's output that each `*PostMigrationIT` method was actually executed (e.g. Failsafe `Tests run: N` ≥ TC count, not `Tests run: 0`). A green build that ran 0 IT methods is **not** a pass.
- The following do **not** count as runtime verification and MUST NOT be used as justification to mark the task `success`:
  - `mvn compile` / `mvn test-compile` / type-check only.
  - The unit-test phase (`mvn test`, `dotnet test` without the IT project, `pytest` without the integration marker) — by convention `*IT` / integration tests are excluded from this phase.
  - Static review of the generated test files ("no `@MockBean` present", "assertions look right") without running them.
- **Blocker routing depends on dependency mode.**
  - Real-dependency blockers (no credentials, no network reachability, missing role assignment, infra not provisioned) are Infra issues per Step 7 and go to the Infra Expert.
  - Testcontainer blockers (Docker unavailable, image pull denied, emulator dependency container missing, unsupported testcontainers version) are test setup issues, must be reported as runtime errors, and do **not** go to the Infra Expert.
  These blockers are **not** a valid reason to skip TCs whose dependencies are all **mock**: those tests must still execute and pass before the task can be `success`.
- **Accidental-real-call guard for mock TCs.** A test whose decision-table row is `mock` but which silently falls back to a real network call (because the mock wasn't wired, or because the SDK uses default credentials when no stub is present) is a **test bug**, not a pass — fix the mock wiring; do not declare success on the strength of an unintended real call.
- **Accidental-mode-mismatch guard for testcontainer TCs.** A test whose decision-table row is `testcontainer` but which silently falls back to a real cloud call or a mock is a **test bug**, not a pass — fix container wiring.

**Task status outcome (mandatory mapping).** Pick exactly one based on the actual runtime result — never on "compile passed" or "unit tests passed". Runtime coverage checks apply to TCs whose decision-table rows are **real** and/or **testcontainer**:

| Situation | Status |
|---|---|
| Every `*PostMigrationIT` ran AND 100% pass; real-dep TCs hit real resources, testcontainer-dep TCs hit configured containers/emulators, and mock-dep TCs were served by the configured doubles | `success` |
| Verification is paused waiting on a hand-off (Infra agent, migration developer for production bug, re-freeze cycle); will resume | `pending` (with summary of who/what is blocking) |
| `*PostMigrationIT` executed and at least one failed, AND the cause is a production bug or a test bug that cannot be reconciled with the spec, AND no further hand-off is in progress | `failed` |
| Real-dep TCs could not be started or completed and the blocker cannot be resolved (Infra Expert unavailable/declined, or infra drift cannot be fixed in this run), OR testcontainer-dep TCs could not be started or completed and required container runtime/emulator setup cannot be restored in this run | `failed` |
| Mock-dep TCs were not executed for any reason, OR verification produced no real execution evidence at all (zero `*PostMigrationIT` methods executed, runner reported `Tests run: 0`, or only compile/unit phases ran) | `failed` |

The status `success` is permitted only when the Runtime Execution Evidence required by Step 9 can be filled in with real numbers for every TC. If you would have to write "integration tests were not executed because..." for any TC in the summary, the status is **not** `success` — it is `pending` (real-dep infra handoff active, or testcontainer setup still unresolved) or `failed` (handoff exhausted, mock-dep TCs unrun, or no path forward).

### Step 7 — Classify and Route Failures

This section is the single reference point for failure classification. Steps 5 and 6 route here when a runtime or generation-time failure occurs.

The spec is the source of truth. Before deciding it is a test bug, prove the test contradicts the spec. The default classification of any disagreement between spec and runtime behavior is **production bug**.

- **Test bug** (the generated test does not faithfully implement what the spec says) → fix the test. Examples: wrong fixture loaded, wrong assertion value relative to the spec, wrong trigger mechanism, missing async wait. The signal: the spec says X, the test asserts Y, the runtime returns X.
- **Production bug** (the runtime contradicts the spec) → **stop, do not patch the test.** Hand back to the migration developer (see handover protocol below).
- **Spec gap** (case requires failure injection that real infra cannot produce, fixture missing, entry point unlisted) → Step 8 (re-freeze). Do not silently downgrade a "real" dependency to a mock to make a test pass.
- **Infra issue (real dependencies only)** — auth/configuration/network/endpoint problem on a real resource (e.g. missing role assignment, endpoint unreachable, infra not provisioned) → hand over to the Infra Expert (see handover protocol below). Do not attempt infra changes from inside the test skill.
- **Testcontainer setup issue** — container-runtime/emulator problem for a `testcontainer` dependency (e.g. Docker daemon unavailable, image pull failure, emulator config missing, unsupported testcontainers version) → report as an error, fix in this skill; if unresolved, use `ask_user`. Do not route these to the Infra Expert.

**Handover protocol (production bug / infra issue):**

Hand over per the teams SOP. The hand-back message must include:

| Classification | Recipient | Message must include |
|---|---|---|
| Production bug | Migration developer | Which `TC-*` failed, the declared expected behavior from the spec, the observed behavior from the run, and the suspected production cause |
| Infra issue (real dependencies only) | Infra Expert | Which `*PostMigrationIT` could not run, the exact error or missing prerequisite, and the real resource(s) involved (resource group/account/namespace/server names) |

**Prohibited responses (both):** do not patch the test to work around the problem — no trigger rewrites, no loosened assertions, no auth-setup changes beyond Step 5. Do not loop indefinitely or flip to `success`.

**Exhausted hand-off:** if the recipient is unavailable or does not exist in `teams-roles.json`, fall back to `ask_user`. If `ask_user` is also unavailable or the user declines to act → close the task as `failed` per the status mapping in Step 6.

### Step 8 — Re-Freeze Cycle for Spec Defects

Whenever any of the following occurs — the Step 3 audit fails; Step 4 finds an uncovered entry point, an infeasible-as-real failure-injection case, or a planning gap that cannot be expressed against the current spec; Step 6 finds a generated test cannot be reconciled with the spec; or any new fixture / scenario is needed — **coordinate a baseline re-freeze**: unfreeze the contents of `test-cases/` → amend (`test-cases.md`, `testdata/`, and/or `infra-decision-table.md`) → re-run the create-test-baseline freeze gate → re-freeze. There is no side channel for adding fixtures or cases in Phase 3.

### Step 9 — Report

Create `${modernization-work-folder}/${taskid}/verification-summary.md` summarizing decisions, results, and gaps. This is the only **report** artifact — do not emit additional report / status markdown files. (The planning table from Step 4 and the `*PostMigrationIT` source files from Step 5 are separate required outputs and continue to exist.)

The summary MUST include a **Runtime Execution Evidence** section with:

- The exact command(s) used to run the integration tests (e.g. `mvn -pl web,worker verify`).
- The runner's tests-run / failures / errors / skipped counts per module, copied from the actual output.
- A one-line confirmation that the count of executed `*PostMigrationIT` methods equals the count of `TC-*` planned in Step 4.
- A per-TC breakdown of **real vs testcontainer vs mock dependencies actually used** at runtime, matched against the Step 2 decision table. For real-dep TCs: the authentication mode used (`az login` principal name, MI client ID, or CI SP) and the target resource identifiers (resource group + account/namespace/server) that were actually contacted. For testcontainer-dep TCs: container image(s), mapped endpoints, and emulator auth strategy used. For mock-dep TCs: the test-double mechanism used (e.g. `@MockBean`, WireMock stub, in-memory fake) so it is auditable that no accidental real call occurred.

If this section cannot be populated with real execution data for every TC (real-dep TCs with real-resource evidence, testcontainer-dep TCs with container runtime evidence, mock-dep TCs with mock-wiring evidence), the task is not eligible to be marked `success` — go back to Step 6 and resolve the real-dependency Infra issue or the testcontainer setup issue (per Step 7), or fix the missing execution first.

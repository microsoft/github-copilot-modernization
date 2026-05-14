---
name: runtime-validation
description: |
  Runtime validation for migrated applications — covers testing strategy (planning phase) 
  and test execution (validation phase): startup verification, integration testing, 
  and end-to-end flow validation.
  
  Use when:
  (1) designing test strategy during planning phase (teamlead reads Part 1)
  (2) verifying a migrated app starts and runs correctly
  (3) writing or executing integration / E2E tests (tester reads Part 2)
  (4) choosing test tooling and environment setup
  (5) producing structured test evidence and verdicts
  
  Triggers: "runtime validation", "testing strategy", "test strategy", "test design", "verify the app", 
  "integration test", "e2e test", "end-to-end test", "smoke test", 
  "startup check", "write tests", "run tests", "test the migration",
  "playwright", "testcontainers", "test strategy", "test plan",
  "runtime gate", "testing phase", "validation phase"
---

# Runtime Validation

This skill serves two phases of the pipeline:
- **Design phase** (Part 1) — planning roles read this to produce a testing strategy before implementation begins
- **Validation phase** (Part 2) — tester reads this to execute startup verification + write and run tests

---

## Part 1: Testing Strategy

> **Audience:** planning roles producing the pre-implementation plan. Tester reads the resulting testing strategy during validation and executes it.
> **Output:** a "Testing Strategy" section in the planning artifact, produced before writing test code.

### 1.1 Test Tiers

Not every project needs every tier. Pick the tiers that match the app's architecture:

| Tier | Config | DB | Security | Speed | When to use |
|------|--------|----|----------|-------|-------------|
| Unit | Mocked deps | None | None | 1ms | Always — implementer writes & runs. Test infrastructure is designed here (see §1.4 item 10) |
| Slice | Partial app context | In-memory | Mocked | 100ms | Framework-supported isolation (e.g., @WebMvcTest, partial DI) |
| Integration | Full app context + Docker-based infra | Real DB | Real | 3s | **Default for most apps** — catches 80% of bugs |
| E2E (API) | Running app (random port or external) | Real | Real | 5s | API-only apps, or API layer of mixed apps |
| E2E (Browser) | Playwright against running app | Real | Real | 10s | **Any app with rendered HTML** — only tool that sees what users see |

**Key insight:** Integration tier (full app context + Docker-based real infrastructure) is the sweet spot for most migrations. Don't skip it by jumping straight to browser E2E.

### 1.2 Tool Selection

| App Type | Primary Tool | Reference |
|---|---|---|
| Server-rendered Java (JSP, Thymeleaf) with minimal JS | Playwright (if Node available) + framework integration tests + Docker-based infra | [playwright.md](references/playwright.md) |
| REST API only (no browser UI) | Framework integration tests + Docker-based infra | [rest-assured.md](references/rest-assured.md) |
| Client-side SPA (React, Angular, Vue) | Playwright (TypeScript) | [playwright.md](references/playwright.md) |
| Server-rendered with significant client-side JS | Playwright + framework integration tests for API layer | Both |
| Messaging (Kafka / Service Bus) | Docker-based infra (Testcontainers for Java, docker-compose for others) + framework test runner | [testcontainers.md](references/testcontainers.md) |
| Mixed (API + SPA browser UI) | Playwright for UI + framework integration tests for API | Both |
| .NET (ASP.NET Core) | `WebApplicationFactory<T>` + HttpClient | (built-in) |
| .NET (WinForms/WPF — no web UI) | xUnit + in-process testing | (no browser E2E needed) |

**Non-Java frameworks — equivalent tools:**

| Framework | Integration Tool (like MockMvc) | Browser E2E | Startup Check |
|-----------|-------------------------------|-------------|---------------|
| .NET (ASP.NET Core) | `WebApplicationFactory<T>` + `TestServer` | Playwright | `dotnet run` + health check |
| Node.js (Express/Nest) | supertest (calls app instance directly) | Playwright | `npm start` + health check |
| Python (Django) | `django.test.Client` | Playwright | `manage.py runserver` |
| Python (FastAPI) | `TestClient` (httpx-based) | Playwright | `uvicorn` + health check |
| Go | `httptest.NewServer` + `http.Client` | Playwright | compile + run + health check |
| Ruby (Rails) | `ActionDispatch::IntegrationTest` | Playwright | `rails server` |

The pattern is universal: each framework has a built-in "test the handler without a real HTTP server" tool for the integration tier, and Playwright covers the browser tier across all of them.

**When is Playwright REQUIRED vs RECOMMENDED?**
- **REQUIRED**: SPAs with client-side routing/state (React, Angular, Vue) — no other tool exercises the full client-side stack
- **STRONGLY RECOMMENDED**: Server-rendered HTML apps (JSP, Thymeleaf, Razor) — Playwright catches view rendering bugs invisible to MockMvc/TestRestTemplate
- **FALLBACK (no Node.js)**: `@SpringBootTest` + `@AutoConfigureMockMvc` covers 80% of flows (cross-controller, forward/redirect, security). Gap: cannot verify actual view rendering. Document this gap but do not skip testing.

**Spring MVC apps with HTML views: use MockMvc, not TestRestTemplate.** `@SpringBootTest` + `@AutoConfigureMockMvc` loads all controllers + security + exception handlers and can assert view names, model attributes, and forwarded URLs. `TestRestTemplate` cannot inspect these — a `@ControllerAdvice` that catches exceptions and returns 200 + error view will make TestRestTemplate see all requests as "successful". **For apps with HTML views, always prefer MockMvc.**

**Spring REST API apps (JSON only): TestRestTemplate is fine.** API responses use HTTP status codes directly (200/4xx/5xx), no view resolution to inspect. TestRestTemplate handles cookies/sessions/redirects naturally and is simpler to use.

### 1.3 Environment Decision Tree

> **⚠️ MANDATORY: Verify tool availability before selecting a branch.**
> Do NOT assume answers — run the following commands in the terminal and use the actual output to choose the correct branch:
> ```bash
> # Unix/macOS — verify CLI exists AND daemon/runtime is functional
> which docker && docker info > /dev/null 2>&1 && echo "Docker: available" || echo "Docker: NOT available"
> which node && node --version && echo "Node.js: available" || echo "Node.js: NOT available"
> ```
> ```powershell
> # Windows (PowerShell)
> Get-Command docker -ErrorAction SilentlyContinue | ForEach-Object { docker info >$null 2>&1; if ($?) { "Docker: available" } else { "Docker: NOT available (daemon not responding)" } }
> Get-Command node -ErrorAction SilentlyContinue | ForEach-Object { node --version; if ($?) { "Node.js: available" } else { "Node.js: NOT available" } }
> ```
> If a command succeeds, take the YES branch. If it fails (`command not found` or daemon not responding), take the NO branch.
> ⚠️ `docker --version` is NOT sufficient — it succeeds even when the daemon is stopped. Use `docker info` instead.
> Skipping this verification and defaulting to a fallback branch is a defect.

⚠️ **The two trees below are INDEPENDENT capability axes. Evaluate BOTH and combine the results.**
Docker availability determines the **infrastructure tier** (Docker-based real infra vs embedded/in-memory alternatives).
Node.js availability determines the **browser-E2E tier** (Playwright vs framework-native HTTP testing).
Losing one capability does NOT affect the other axis.

```
Has Docker?
├── YES
│   ├── Java/Spring → Testcontainers (DB, MQ, caches)
│   ├── .NET / Node.js / Python / Go / Ruby → docker-compose or docker run (DB, MQ, caches)
│   ├── Full stack with docker-compose? → docker-compose up + test against it
│   └── Otherwise → start app + Docker-managed deps
│
└── NO
    ├── Java/Spring → H2 in-memory DB + embedded alternatives for other infra (e.g., embedded Kafka, local mock services) — see §A.1 for H2 SQL compatibility risks
    ├── .NET → SQLite in-memory
    └── Node.js / Python / Go / Ruby → SQLite/in-memory store + mock services

Has Node.js?
├── YES + App renders HTML (JSP, Thymeleaf, Razor, templates, SPA)
│   ├── `npx playwright install --with-deps chromium` succeeds?
│   │   └── YES → Playwright for browser E2E (catches view-layer bugs invisible to framework-native HTTP testing)
│   │   └── NO → Framework-native HTTP testing fallback (document gap: browser rendering unverified; record exact install error)
├── YES + API-only (no HTML)
│   └── Framework-native HTTP client (no Playwright needed)
└── NO
    ├── Java with HTML views → framework integration test (e.g., MockMvc — covers cross-controller flows, forward/redirect, security; only gap is actual view rendering)
    ├── API-only (any language) → framework-native HTTP testing
    └── No Node.js + non-Java with HTML views → document gap, prioritize getting Node.js
```

#### Capability Prerequisites

Beyond Docker and Node.js, verify these additional prerequisites when they apply:

| Capability | Prerequisite | Verify Command | If Missing |
|-----------|-------------|----------------|------------|
| Docker-based infra | Docker daemon **functional** | `docker info > /dev/null 2>&1` | Embedded/in-memory alternatives (H2/SQLite for DB, embedded broker for MQ, local mocks) |
| Playwright | Node.js + browser binaries | `npx playwright install --with-deps chromium` | MockMvc / TestRestTemplate |
| Build tools | Maven or Gradle on PATH | `mvn --version` or `gradle --version` | Cannot proceed — escalate |
| Headless browser | Playwright headless mode | Set `headless: true` in Playwright config | Always use headless in CI |
| Network (external) | Outbound HTTPS for image pulls / browser downloads | `curl -s --max-time 5 https://registry.npmjs.org` | Use pre-cached binaries or mock external services |

> These are secondary checks — run them after the Docker/Node.js primary axes. If any fails, document it as a constraint that may force fallback on that specific axis.

### 1.3.2 Legacy Test Asset Inventory

Before finalising the testing strategy, check whether legacy E2E or integration tests are available. They may come from two sources — check both:

**Source 1 — User-provided tests**
The user may directly supply test files or paste test code in their request. These take priority over anything discovered on disk. Accept them as-is and skip the file-scan for the journeys they already cover.

**Source 2 — Tests discovered in the source project**
Scan the source project for existing test files. This is the fallback when the user provides nothing.

**Inventory procedure:**

1. If the user explicitly provided test files or code, record them as `legacyTestAssets` with source `user-provided` and skip to step 3
2. Otherwise, locate existing test files in the source project (e.g., `src/test/`, `e2e/`, `cypress/`, `tests/`)
3. Classify each test suite by framework:

| Framework / Pattern | Classification | Migration Target |
|---|---|---|
| AssertJ + Selenium / HtmlUnit | Legacy Java browser E2E | Rewrite to Playwright |
| RestAssured / MockMvc (`@SpringBootTest`) | Java integration / API tests | Keep as-is if stack unchanged; rewrite if REST contract changes |
| Cypress | JS/TS browser E2E | Evaluate rewrite to Playwright (see §1.3.3) |
| Playwright (existing) | Modern browser E2E | Reuse with minimal edits (see §1.3.3) |
| JUnit / pytest / xUnit (unit tests only) | Unit tests | Out of scope — implementer's job |

3. Record findings in the Testing Strategy deliverable under `legacyTestAssets`, including source (`user-provided` or `discovered`)

**Output rule:** If legacy E2E tests are found, the Testing Strategy MUST specify one of:
- **rewrite** — test framework incompatible with target stack (e.g., Selenium → Angular SPA)
- **reuse-with-edits** — test framework compatible; only failing selectors / URLs need updating (e.g., existing Playwright suite)
- **discard** — tests are so tightly coupled to old UI structure that rewriting from scratch is faster; document why

### 1.3.3 Legacy Test Migration Strategy

Apply the appropriate strategy based on test classification:

**Case A — Rewrite (e.g., AssertJ/Selenium → Playwright)**

When the tech stack changes significantly (e.g., server-rendered JSP → Angular SPA), legacy Java browser tests cannot be run against the new frontend. They must be rewritten:

1. Map each existing test class / method to a Playwright test by the user journey it covers (not line-by-line)
2. Preserve the semantic intent of each test — same journey, same pass/fail criteria
3. Generate new `*.spec.ts` Playwright tests in the target project's `e2e/` or `tests/` directory
4. Document in the Testing Strategy: `legacyTestMappingTable` — old class → new spec file, journey parity confirmed

**Case B — Reuse with minimal edits (existing Playwright suite)**

When the source already has Playwright tests and the same journeys are still valid after migration:

1. **Copy the existing test files into the new project first** — do not rewrite from scratch
2. Run the suite against the migrated app and collect failures
3. Apply the **minimum-diff principle**: only change what breaks — selectors, URLs, data-ids, auth sequences. Do NOT restructure passing tests.
4. Track all changes in a diff table in the test execution report: `| test file | reason changed | lines changed |`
5. If more than 50% of a test file requires changes, flag it as a candidate for rewrite instead (document reasoning)

**Recording in Testing Strategy:**

```markdown
### Legacy Test Assets
- legacyTestAssets: [e.g., "AssertJ/Selenium suite — 12 test classes in src/test/java/e2e/"]
- source: user-provided | discovered
- migrationDecision: rewrite | reuse-with-edits | discard
- migrationRationale: [reason]
- legacyTestMappingTable: [old class → new spec, or N/A if discard]
```

### 1.4 Testing Strategy Deliverable

The implementation plan MUST include a "Testing Strategy" section containing:

1. **appType** — API-only / server-rendered HTML / SPA / mixed / messaging / desktop
2. **Critical user journeys** (3-5 minimum) — identified from feature inventory
3. **primaryValidationStack** — the full stack to execute when all capabilities are available
4. **fallbackMatrix** — for EACH independent capability axis, the fallback when that axis's prerequisite is unavailable:
   - `infra-tier`: primary tool (e.g., Testcontainers for Java, docker-compose for others) → fallback (e.g., H2, SQLite, embedded broker, local mock). Prerequisite: Docker
   - `browser-tier`: primary tool (e.g., Playwright) → fallback (e.g., framework-native HTTP testing). Prerequisite: Node.js + `npx playwright install`
5. **Environment requirements** — Docker? Node? What containers? What browser tooling? (list per-capability)
6. **knownGaps** — per-axis coverage loss when each fallback is activated
7. **Test data strategy** — how to seed, isolate (UUID), and clean up test data
8. **Acceptance criteria** — what constitutes PASS for each journey
9. **Validation review expectations** — what the final reviewer should confirm about test process and evidence
10. **Unit/integration test infrastructure** — the scaffold that enables implementers to run tests during the execute phase. The testing strategy MUST specify:
    - **External dependency strategy**: for each external dependency (DB, message broker, cache, other services, third-party APIs, file systems, frontend-backend API contracts, etc.), specify whether to use a real instance (via containers / Dev Services / in-memory) or a mock/stub, and how to configure it. For cross-boundary dependencies that exchange data via protocols (REST, gRPC, GraphQL, WebSocket, etc.), define the contract testing or mock server approach so each side can be tested independently. Each module must be testable without requiring manual setup
    - **Test base classes**: shared setup (container lifecycle, test data seeding, auth helpers)
    - **Per-module test skeletons**: startup-verification tests for each service module — created during scaffold, filled by implementers
    - **Test execution rule**: every implementation task MUST run module-level tests and report pass/fail/skip counts. Test failure = task not complete. No deferral to validation phase.

### Default Decision Policy by Project Type

| Project Type | Primary Validation Stack |
|-------------|--------------------------|
| Server-rendered web app (any language) | Playwright + framework integration tests + Docker-based infra |
| SPA (React/Angular/Vue) | Playwright |
| Pure REST API (any language) | Framework integration tests + Docker-based infra |
| Mixed app (API + browser UI) | Playwright + framework integration tests |
| Messaging / event-driven | Docker-based infra + framework test runner |

### Per-Capability Fallback Matrix

⚠️ **Fallbacks are per-capability axis, NOT per-stack.** Docker and Node.js are independent axes. Losing one capability does NOT affect the other. Apply each row independently based on which specific capability is actually unavailable.

| Capability Unavailable | What Changes | What Stays Unchanged | Gap Introduced |
|----------------------|--------------|----------------------|----------------|
| **Docker only** (Node.js available) | Docker-based infra → embedded/in-memory alternatives (H2/SQLite for DB, embedded broker for MQ, local mock for services) | **Playwright stays** — start app with embedded infra, run Playwright against it | Infrastructure fidelity loss (see §1.3.2 for DB-specific risks) |
| **Node.js only** (Docker available) | Playwright → framework-native HTTP testing | **Docker-based infra stays** — real DB/MQ/caches via Docker | Cannot verify browser rendering, static assets, browser behavior |
| **Node.js available but Playwright install fails** | Playwright → framework-native HTTP testing | **Docker-based infra stays** | Same as above; record exact `npx playwright install` error |
| **Docker + Node.js both unavailable** | Docker-based infra → embedded/in-memory, Playwright → framework-native HTTP testing | Framework HTTP tests + embedded infra (maximum degradation) | Both infrastructure fidelity and browser rendering gaps |

**Key insight:** Playwright requires Node.js + a running HTTP server. It does NOT require Docker. The server can run with embedded/in-memory infrastructure (H2, embedded brokers, etc.) when Docker is unavailable. Therefore **"no Docker" NEVER justifies dropping Playwright.**

**Execution rules — per-capability independence:**

1. **Attempt each capability independently** — the tester MUST attempt to install/configure each tier in the primary stack separately (e.g., `npx playwright install --with-deps chromium` for browser E2E, set up Docker-based infra for the infra tier). Skipping Playwright because Docker is unavailable, or skipping Docker-based infra because Node.js is unavailable, is NOT acceptable — these are independent axes.
2. **Fallback only on documented failure of THAT specific capability** — a fallback may be used ONLY when the specific capability fails with a reproducible technical error (e.g., `docker info` fails → embedded/in-memory alternatives for infra, but does NOT justify dropping Playwright). The tester MUST record per-axis: (a) the exact command attempted, (b) the exact error output, (c) why it cannot be resolved within the task, (d) which specific capability axis is being downgraded.
3. **Escalate, don't swallow** — if any primary capability cannot be used, the tester MUST escalate via `[notify:coordinator]` with the per-capability blocker evidence. The coordinator decides whether to accept the fallback or remediate.
4. **Gap recording is mandatory** — any fallback use MUST record the `knownGaps` for that specific capability axis in the verdict block and final report.
5. **Severity at conformance gate** — dropping a capability whose prerequisite IS available (e.g., dropping Playwright when Node.js works, because Docker is down) is rated **CRITICAL** at the completeness gate. This means the conformance gate will FAIL.

Example:

```markdown
## Testing Strategy

### Critical Journeys
1. [Primary user flow — e.g., login → access protected resource → verify]
2. [Core business operation — e.g., create entity → persist → retrieve → verify]
3. [Administrative flow — e.g., manage resources → CRUD operations]
4. [Auth failure path — e.g., invalid credentials → expected error response]
5. [Data integrity — e.g., create → update → delete → verify gone]

### Tooling
- Infra tier: real infrastructure via Testcontainers (prerequisite: Docker); fallback: embedded/in-memory alternatives (gap: fidelity loss, see §1.3.2 for DB-specific risks)
- HTTP/API tier: framework-native integration test client (e.g., MockMvc for Spring, supertest for Node.js, WebApplicationFactory for .NET)
- Browser tier: Playwright (prerequisite: Node.js + `npx playwright install`); fallback: framework-native HTTP testing (gap: actual view rendering, static assets, browser behavior)
- ⚠️ Infra tier and Browser tier are INDEPENDENT — losing Docker does NOT affect Playwright; losing Node.js does NOT affect Testcontainers

### Test Data
- Seed in test setup (before each test) with unique identifiers (UUID) to avoid interference
- Use auto-rollback or cleanup in teardown
- Do NOT assume pre-existing data
```

---

## Part 2: Test Execution

> **Audience:** tester agent during the validation phase.
> **Input:** testing strategy from implementation plan (Part 1 output).
> **Output:** test code + evidence + verdict.

### 2.1 Step 1: Start the Application

Before any test runs, verify the project compiles and the application starts.

#### Auto-detect start command

| Indicator | Tech Stack | Default Start Command |
|-----------|------------|-----------------------|
| `pom.xml` with spring-boot plugin | Spring Boot (Maven) | `mvn spring-boot:run` |
| `build.gradle` with spring-boot plugin | Spring Boot (Gradle) | `gradle bootRun` |
| `package.json` with `start` script | Node.js | `npm start` |
| `*.csproj` with ASP.NET | .NET | `dotnet run --project <web-project>` |

If a `runtime-validation-config.yaml` exists in the project root, use it to override auto-detection:
```yaml
startup:
  command: "mvn spring-boot:run -Dspring-boot.run.profiles=test"
  readinessUrl: "http://localhost:8080/actuator/health"
  timeoutSeconds: 120
```

#### Detect readiness signal (check in order, use first match)

1. **Health endpoint** — search config for `/actuator/health`, `/health`, `/healthz`. Poll until 2xx.
2. **Stdout pattern** — watch for `Started`, `Listening on port`, `Application is running`.
3. **Process alive** — verify process still running after grace period.

#### Execute

1. Start application in background
2. Wait for readiness signal
3. Timeout: 60s default (configurable)
4. **PASS** → proceed to Step 2
5. **FAIL** → capture last 200 lines of logs, analyze root cause, attempt fix (max 3 iterations). If still failing → escalate via `[notify:coordinator]`

**Fail-fast:** If startup fails, skip all subsequent steps.

### 2.2 Step 2: Write and Run Tests

**⚠️ MANDATORY: You MUST produce new runnable test code.** Running existing `mvn test` and curling endpoints is NOT sufficient.

**Design authority:** The planning-phase testing strategy is the source of truth and is a binding contract, not guidance.

- Tester MUST follow the chosen `primaryValidationStack`. Do NOT substitute a simpler tool because it "already works" (e.g., using H2 when Testcontainers PostgreSQL was specified).
- Tester MUST attempt to install/configure every tier specified in the strategy independently (e.g., if Playwright E2E was planned and Node.js is available, run `npx playwright install` and write E2E tests — even if Docker is unavailable for the DB tier).
- Only use a `fallbackMatrix` entry for a given capability when **that specific capability's prerequisite** is actually unavailable after a real attempt — not because another capability failed, and not because setup seems complex.
- If falling back on any capability axis, record the per-axis `knownGaps` AND escalate via `[notify:coordinator]` with the exact error that blocked that specific capability.
- If the design is missing or contradictory, escalate instead of improvising a new default strategy.
- **Failing to attempt any capability whose prerequisite is available is a conformance violation that will cause the completeness gate to FAIL.**

#### Handle legacy test assets first

Before writing new tests, check the testing strategy for `legacyTestAssets` and `migrationDecision`. Legacy tests may have been **user-provided** (supplied directly in the request) or **discovered** on disk — handle them the same way regardless of source.

**Case A — `migrationDecision: rewrite` (e.g., AssertJ/Selenium → Playwright)**

1. Read the legacy test classes to extract the user journeys they cover (not to copy code)
2. For each legacy test class, produce a corresponding `*.spec.ts` Playwright test that covers the same journey
3. Do NOT translate line-by-line — map semantic intent (what the user does and what outcome is verified)
4. New Playwright tests go in the target project's `e2e/` or `tests/` directory
5. Record the mapping table in the test execution report:
   ```
   | Legacy class | New Playwright spec | Journey covered |
   ```

**Case B — `migrationDecision: reuse-with-edits` (existing Playwright suite)**

1. Copy the existing Playwright test files into the migrated project without modifications
2. Run the suite: `npx playwright test`
3. For each failing test, apply the **minimum-diff principle**:
   - Fix broken selectors, changed URLs, updated data-ids, or modified auth sequences
   - Do NOT restructure or rewrite tests that still pass
4. Record every change in the test execution report:
   ```
   | Test file | Change reason | Lines changed |
   ```
5. If a single test file requires >50% changes, flag it for rewrite and document why
6. Reused + minimally-edited tests count toward the required test coverage — you do not need to write additional tests for journeys already covered by them

**Case C — No legacy tests / `migrationDecision: discard`**

Proceed directly to writing new tests from the testing strategy's critical journeys.

#### What you must deliver

1. **Read the testing strategy** from the implementation plan (dependency artifact from teamlead)
2. **Write at least 3 runnable test files** covering distinct user journeys from the testing strategy
3. **Each test must be a multi-step flow**, not a single endpoint probe:
   - Setup → Action → Verification → Cleanup
4. **Each test must cover at minimum:**
   - Happy path (full flow succeeds)
   - Authentication failure (invalid/missing credentials)
   - Data persistence verification (write → read-back → assert)

#### Test data management

- Create seed data in `@BeforeEach` or test setup
- Use unique identifiers (UUID) to avoid test interference
- Clean up in `@AfterEach` or use `@Transactional` rollback
- Do NOT assume pre-existing data in the database

#### What is NOT an acceptable test

- Running existing `mvn test` + curling endpoints → this checks existing tests, not new validation
- Tests that mock dependencies → integration/unit, not runtime validation
- Tests that import components directly (jsdom) → component test, not E2E
- Single endpoint probes without multi-step flow → too shallow
- File-presence checks → proves nothing about behavior

### 2.3 Step 3: Fix Loop (on failure)

When tests fail:

1. Capture test output + application logs
2. Correlate errors to identify root cause
3. **If source code bug** → escalate to responsible role via `[notify:role]`. Do NOT modify production code.
4. **If test code issue** → fix and retry
5. Max 3 fix iterations → escalate remaining via `[notify:coordinator]`

### 2.4 Step 4: Evidence & Verdict

Every test run MUST end with this verdict block:

```
environment:
  docker: AVAILABLE|UNAVAILABLE — <`docker info` output or error>
  node: AVAILABLE|UNAVAILABLE — <`node --version` output or error>
  playwright: AVAILABLE|UNAVAILABLE — <`npx playwright install` output or error>
  infra-tier: PRIMARY(Docker-based)|FALLBACK(embedded/in-memory) — <reason if fallback>
  browser-tier: PRIMARY(Playwright)|FALLBACK(MockMvc)|SKIPPED — <reason if not primary>
startup: PASS|FAIL — <start command>, <readiness signal>, <startup time>
integration: PASS|FAIL|UNVERIFIED — <scope>, <gaps>
e2e: PASS|FAIL|PARTIAL|UNVERIFIED — <flows tested>, <boundaries exercised>, <gaps>
overall: PASS|FAIL|NEEDS_SIGNOFF — <reason>
```

Also produce `runtime-validation-report.md`:

```markdown
# Runtime Validation Report

**Generated**: [ISO 8601 timestamp]
**Target**: [project path]

## Summary
| Step | Status | Details |
|------|--------|---------|
| Startup | ✓ PASS | Started in 8.3s, /actuator/health → 200 |
| Integration Tests | ✓ PASS | 3 test files, 12 tests, all green |
| E2E Tests | N/A | No browser UI — skipped per testing strategy |

**Overall**: PASS

## Legacy Test Migration (if applicable)
| Decision | Source | Details |
|---|---|---|
| rewrite / reuse-with-edits / discard | [legacy framework] | [summary] |

### Test Mapping Table (Case A — rewrite)
| Legacy class | New Playwright spec | Journey covered |
|---|---|---|

### Change Log (Case B — reuse-with-edits)
| Test file | Change reason | Lines changed |
|---|---|---|

## Test Evidence
- Surefire reports: target/surefire-reports/*.xml
- [or] Playwright report: playwright-report/index.html

## Issues Found (if any)
| # | Severity | Description | Escalated To |
|---|----------|-------------|--------------|
```

---

### 2.5 Test-Design Conformance Review

After runtime validation completes, the final planning/quality reviewer must verify **per-capability** conformance between the executed test process and the approved testing strategy:

1. **Per-capability stack verification** — for EACH capability axis in the approved testing strategy:
   - Was the primary tool used? If yes, verify evidence (test files, reports, logs).
   - If a fallback was used: is there a documented, reproducible technical failure for **THAT SPECIFIC capability's prerequisite**? (e.g., `docker info` failed → H2 acceptable for DB tier, but does NOT justify dropping Playwright if Node.js was available)
   - Was a capability dropped because a DIFFERENT capability was unavailable? This is a **CRITICAL** conformance violation.
2. **Journey coverage** — the critical journeys covered vs the journeys required by the design
3. **Per-axis gap recording** — are gaps recorded per-capability axis, not as a single blanket statement?
4. **Evidence completeness** — the environment requirements and evidence promised by the design vs what was actually produced
5. **Deviation reporting** — any deviations, skips, or unverified areas called out clearly in the final report

A runtime-validation result is not complete if tests ran but the evidence does not show per-capability conformance to the approved testing strategy.

## Operating Constraints

- **Fail-fast**: If startup fails, skip test steps
- **Log-driven debugging**: On any failure, capture and analyze application logs
- **Never modify production source code** — tester creates test files only
- **Read testing strategy first** — don't invent test strategy, follow the plan from design phase
- **Primary stack is mandatory** — you MUST attempt every capability tier in the approved primaryValidationStack independently. Skipping a tier without a documented, reproducible technical failure of **that tier's specific prerequisite** is a conformance violation that will FAIL the completeness gate. "Docker is down so I skipped Playwright too" or "It was complex to set up" are NOT valid reasons to skip.

---

## Appendix

### A.1 H2 Compatibility Limitations *(Java/Spring only)*

When H2 replaces PostgreSQL/MySQL as a fallback (Docker unavailable), document these risks in `knownGaps`:
- **Unsupported types**: `jsonb`, `hstore`, `inet`, `cidr`, native `uuid`, array types (`text[]`, `int[]`)
- **Unsupported syntax**: `ON CONFLICT ... DO UPDATE` (upsert), `RETURNING` clause
- **Aggregate differences**: `string_agg`, `array_agg`, `FILTER` clause may differ or be absent
- **Missing features**: Lateral joins (partial), PostgreSQL-specific index types (GIN, GiST, BRIN)
- **Extensions unavailable**: `pgcrypto`, `pg_trgm`, `ltree`, `uuid-ossp`
- **Schema semantics**: search path behavior differs

**Mitigation during planning (Part 1):** Scan `src/main/resources/**/*.sql` and repository interfaces for PostgreSQL-specific syntax. If found, mark Docker as **REQUIRED** (not just preferred) for the DB tier. If not found, H2 fallback is acceptable.

**Mitigation during execution (Part 2):** If H2 is used and the app starts successfully, proceed with testing — the tests still have value even if DB fidelity is reduced. If H2 startup fails due to unsupported SQL, document the specific incompatibility and escalate as a Docker-required blocker.

# Layer 2: Smoke Tests

**Goal:** "Does the whole application start and stay alive?"

Verify the complete application boots successfully, reaches a healthy state, and produces no crash-level errors. Layer 2 does **NOT** test individual features, APIs, or business logic — that is Layer 1's responsibility.

## What Layer 2 Is and Is Not

| Layer 2 IS | Layer 2 IS NOT |
|------------|----------------|
| Verifying the process starts without crashing | Testing specific API endpoints or features |
| Checking a single health/readiness probe | Hitting every REST route or gRPC method |
| Scanning startup logs for fatal errors | Asserting on response payloads or data |
| Detecting missing configuration or broken DI | Exercising SDK integrations or components |
| Provisioning ALL infrastructure the app needs | Only setting up migrated-component containers |

## No Test Classes Required

Layer 2 does **NOT** generate test classes. The runner script (`run-layer2-tests.sh` / `run-layer2-tests.ps1`) **is** the test — it provisions infrastructure, starts the app, runs health checks via `curl` and shell built-ins, and reports pass/fail. No JUnit test code.

**Layer 2 is independent of Layer 1.** Layer 1 tests only migrated components; Layer 2 must provision ALL application dependencies.

## Prerequisites

- Application builds successfully
- Docker installed and running

## Azure Authentication for Smoke Tests

Migrated applications typically use **Managed Identity** (`DefaultAzureCredential`) which only works on Azure infrastructure. For local smoke testing, you must modify the application to connect to local emulators instead.

**See [azure-auth-strategies.md](./azure-auth-strategies.md) for:**
- How to classify Azure dependencies (Emulatable, Lazy, Non-emulatable)
- Emulator images and configuration
- Authentication modification strategies (config-driven vs code-driven apps)
- Emulator connection string values
- Decision flow for handling each dependency type

**Summary:** For each Azure dependency, determine if it's emulatable (use local emulator), lazy (skip), or startup-required non-emulatable (disable via config or recommend Layer 3).

## Workflow

> **CRITICAL — Commit order matters.** Follow Steps 1–8 in exact order. The artifacts commit (Step 3) MUST come before the auth commit (Step 4). Do not combine them. Do not reorder them.

The workflow produces **a multi-commit sequence** (exactly 3 commits):

| # | Commit | Contains |
|---|--------|----------|
| 1 | `[layer-2] Add smoke test artifacts` | docker-compose.smoke.yml, runner scripts, AND any source code fixes needed for smoke tests to pass. **All fixes (infrastructure, runner scripts, source code) must be amended to this commit.** |
| 2 | `[smoke-test] Replace Managed Identity with emulator connection strings` | Config file changes (e.g., `application.properties`) with explicit emulator connection strings, and any necessary auth-related code changes. **Auth-related fixes must be amended to this commit.** |
| 3 | `[smoke-test] Restore Managed Identity auth` | Reverts **only commit 2** by SHA — restores original Managed Identity config |

**CRITICAL — Amend strategy:**
- Fixes to docker-compose.smoke.yml → amend commit 1
- Fixes to runner scripts → amend commit 1
- Source code bugs discovered during testing (DI wiring, null refs, etc.) → **amend commit 1**
- Fixes to auth config files → amend commit 2
- Fixes to auth-related code → amend commit 2

This ensures when users checkout commit 2 (auth) to run smoke tests locally, they have ALL fixes: commit 1 contains working artifacts AND all source code fixes, commit 2 contains working auth config.

The agent executes the smoke test runner script (Step 7) after creating commit 2, and may need to amend commits 1 or 2 during retries.

**Retry on failure:** If the runner script fails, the agent analyzes the output and attempts a fix:
- **Smoke-artifact failure** (wrong port in compose, bad docker-compose config, bad runner script) → **amend commit 1** with fixes and re-run Step 7
- **Source-code failure** (broken DI wiring, null reference in initializer, missing config guard, startup crash from migrated code) → **amend commit 1** with fixes and re-run Step 7. Apply the **Handling Test Failures** guidance from the main skill file.
- **Auth-config failure** (wrong connection string in config file, missing config property, auth-related code issue) → **amend commit 2** with fixes and re-run Step 7

Max **3 retries** total (across all failure types). If the agent cannot diagnose the root cause or the fix would require architectural changes, stop and report.

### Step 1: Analyze ALL Application Dependencies

Scan the **entire** application to identify every external dependency required for startup:

- Build files: `pom.xml`, `build.gradle`, `*.csproj`, `package.json`
- Config: `application.yml`, `application.properties`, `appsettings.json`, `.env`
- Source code: client initializations, `@Autowired`/`@Inject` services
- Existing Docker/compose files

**For each Azure dependency, classify it** using the decision flow from [azure-auth-strategies.md](./azure-auth-strategies.md):
- **Emulatable** → Add emulator to docker-compose, will modify auth in Step 4
- **Lazy** → Skip (doesn't block startup)
- **Non-emulatable** → Disable via config in Step 4, or recommend Layer 3

**For non-Azure dependencies:**

| Category | Example | Action |
|----------|---------|--------|
| Standard databases | PostgreSQL, MySQL, MongoDB, Redis | Add to `docker-compose.smoke.yml` with standard image |
| Azure wire-compatible | Azure DB for PostgreSQL/MySQL, Azure Cache for Redis, Azure SQL | Use open-source image (`postgres:16`, `redis:7`, `mcr.microsoft.com/mssql/server`) |

**Rules:** Include anything that crashes the app on startup. Skip lazy/on-demand dependencies. Reuse Docker images and ports from Layer 1 where applicable. If an existing `docker-compose.yml` already defines all needed services, prefer reusing it.

### Step 2: Generate Docker Compose

Create `docker-compose.smoke.yml` in the test resources directory. The file provisions ALL required dependencies. Every service must have a healthcheck. Include proper ports and volume mounts.

**File location:** `src/test/resources/docker-compose.smoke.yml`

### Step 3: Generate Runner Scripts and Commit Artifacts

Generate `run-layer2-tests.sh` and `run-layer2-tests.ps1` (see Runner Script Template below).

**File locations:**
- `{modernization-work-folder}/integration-tests/run-layer2-tests.sh`
- `{modernization-work-folder}/integration-tests/run-layer2-tests.ps1`

Then commit all generated artifacts:

```
git add -A
git commit -m "[layer-2] Add smoke test artifacts"
```

This commit initially contains only generated files (docker-compose.smoke.yml, runner scripts). No source code changes yet. Files in `.github/` may be excluded if the project's `.gitignore` blocks them — this is acceptable.

**CRITICAL:** If smoke tests fail during Step 7, amend this commit with ALL fixes:
```
# After fixing docker-compose.smoke.yml, runner scripts, OR source code
git add -A
git commit --amend --no-edit
```

This includes source code bugs discovered during smoke testing. The commit message says "Add smoke test artifacts" but the commit will contain test infrastructure (docker-compose, runner scripts) AND source code fixes needed for tests to pass. This ensures users who checkout the auth commit (Step 4) will have all fixes via this commit in git history.

### Step 4: Commit Auth Changes

**CRITICAL:** This step is MANDATORY. You must ALWAYS create an auth commit that modifies config files.

Modify the application configuration files (NOT environment variables) to use explicit emulator connection strings. See [azure-auth-strategies.md](./azure-auth-strategies.md) for:
- Which config files to modify (`application.properties`, `appsettings.json`, etc.)
- Emulator connection string formats
- Code modification patterns if needed

Create the auth commit:

```bash
git add -A
git commit -m "[smoke-test] Replace Managed Identity with emulator connection strings"
```

Record the commit SHA for Step 8.

### Step 5: Verify Config File Changes

**Do NOT modify runner scripts with environment variables.** The config files from Step 4 contain all necessary connection strings.

Verify that the auth commit includes:
- All modified config files with explicit connection string values
- Any code changes if the app was hardcoded/plain application
- No environment variable exports or overrides

The runner scripts will start the application as-is, and the app will read connection strings from the config files you just modified.

### Step 6: Auto-Detect Application Type

Analyze the project to determine how it starts and how to verify liveness:

| Indicator | App Type | Start Command | Liveness Check |
|-----------|----------|---------------|----------------|
| Spring Boot, `@SpringBootApplication` | Java Web/API | `./mvnw spring-boot:run` or `java -jar` | HTTP health probe |
| `@Scheduled`, background jobs | Worker/Background | `./mvnw spring-boot:run` | Process stays alive for N seconds |
| `main()` with no server | CLI/Batch | `java -jar` | Process exits with code 0 |

### Step 7: Execute Smoke Tests via Runner Script

After creating the auth commit (Step 4) and detecting the application type (Step 6), execute the smoke test runner script:

```bash
bash {modernization-work-folder}/integration-tests/run-layer2-tests.sh
# OR on Windows:
powershell {modernization-work-folder}/integration-tests/run-layer2-tests.ps1
```

**The script will:**
1. Verify Docker is running
2. Start infrastructure (`docker compose up`)
3. Build the application
4. Start the application in background
5. Run three health checks:
   - **Check 1:** Process is alive after stability wait (5s)
   - **Check 2:** Health probe returns non-5xx HTTP response (web/API apps only)
   - **Check 3:** No fatal error patterns in startup logs (FATAL, panic, OutOfMemory, etc.)
6. Report pass/fail and exit with appropriate code
7. Clean up (kill app, docker down)

**If the script exits with code 0:**
- ✅ Tests passed
- Proceed to Step 8 (create restore commit)

**If the script exits with non-zero:**
- ❌ Tests failed (likely auth-config issues)
- Analyze the script's output to determine root cause
- **Amend the auth commit (Step 5)** with fixes
- Re-run the script (max 3 retries total)

**Important:** At this point, all source code fixes should already be done (Step 4). Failures here are typically auth configuration issues (wrong connection strings, missing config properties).

**CRITICAL — Do NOT Create Test Classes:**
- Layer 2 does NOT use JUnit test classes
- The runner script IS the test - it uses shell commands (curl, grep, etc.)
- Do NOT create any `.java` test files for Layer 2
- If you need to improve smoke testing, modify the runner scripts, not create test classes

### Step 8: Create Restore Commit

After smoke tests pass, create the restore commit to restore Managed Identity auth:

```bash
git revert --no-edit <auth-commit-sha>
git commit --amend -m "[smoke-test] Restore Managed Identity auth"
```

This keeps the auth commit in history (visible in `git log`) while restoring the codebase to use Managed Identity.

**CRITICAL:** All smoke test artifacts (docker-compose.smoke.yml, runner scripts) and source code fixes are in commit 1. Users can checkout the auth commit (commit 2) to run smoke tests locally and will have all necessary fixes via commit 1 in git history.

## Handling Failures

**CRITICAL:** All fixes must be amended to either commit 1 (smoke artifacts + source code) or commit 2 (auth config). Never create separate fix commits.

Testing happens in Step 7 (after both commits 1 and 2 are created). When failures occur:

| Failure | Likely Cause | Action |
|---------|-------------|--------|
| Infrastructure won't start | Port conflict, Docker issue, bad docker-compose config | **Amend commit 1** (fix docker-compose.smoke.yml) and re-run Step 7 |
| Build fails | Compile error in source code, missing dependencies | **Amend commit 1** (fix source code) and re-run Step 7. Apply Handling Test Failures guidance. |
| Process crashes immediately | Broken DI wiring, null ref, missing config guard, startup crash, OR wrong auth config | **Analyze stack trace** → amend commit 1 (source code bugs) or commit 2 (auth issues) and re-run Step 7 |
| Runner script fails | Wrong app start command, incorrect paths, bad classpath | **Amend commit 1** (fix runner scripts) and re-run Step 7 |
| Health probe times out | Wrong port in config, slow startup | **Amend commit 1** (fix runner script health check) and re-run Step 7 |
| Health probe returns 5xx | Internal error from missing config or code bug | **Analyze** → amend commit 1 (code) or commit 2 (auth) and re-run Step 7 |
| Fatal log patterns | Unhandled exceptions at startup | **Analyze stack trace** → amend commit 1 (source code) or commit 2 (auth config) if root cause is identifiable; otherwise report |
| Fatal log patterns | Unhandled exceptions at startup | **Analyze stack trace → fix** if root cause is identifiable; otherwise report |

**Key principles:**
- Layer 2 fixes **both** its own generated artifacts **and** source-code issues it discovers. The goal is a passing smoke test, not just a report.
- Use the **Handling Test Failures** guidance from the main skill file to decide what to fix and how.
- Keep source-code fixes **minimal and targeted** — fix the specific startup blocker (e.g., null guard, missing config binding, broken DI registration). Do not refactor or change architecture.
- Max **3 retries** total. If the root cause is unclear, the fix would require architectural changes, or the app genuinely needs a real Azure service with no workaround, stop and report.

## Standardized Runner Scripts

Generate `run-layer2-tests.sh` and `run-layer2-tests.ps1` in `{modernization-work-folder}/integration-tests/`. These are test runners that start infrastructure, build the app, run smoke tests, and report results.

**See [layer2-runner-script-templates.md](./layer2-runner-script-templates.md) for:**
- Complete bash and PowerShell script templates
- Placeholder replacement guide
- Script behavior and exit codes
- Environment variable overrides

Users run:
- Unix: `bash {modernization-work-folder}/integration-tests/run-layer2-tests.sh`
- Windows: `powershell {modernization-work-folder}/integration-tests/run-layer2-tests.ps1`

## Pass Criteria

- All infrastructure containers reach healthy state
- Application builds and starts without crashing
- Health probe returns non-5xx (web/API apps)
- No fatal-level errors in startup logs
- Clean shutdown of app and infrastructure

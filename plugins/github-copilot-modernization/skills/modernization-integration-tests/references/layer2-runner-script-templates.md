# Layer 2 Runner Script Templates

## Script Role

The runner script is a **test runner only**. It starts infrastructure, builds the app, runs smoke tests, and reports results. It does NOT manage git commits or handle test failures — that is the agent's responsibility.

## When to Use

- **Agent execution (during Layer 2 generation):** After creating the auth commit (Step 4), the agent executes this script to run smoke tests. If tests fail, the agent analyzes errors, applies fixes, and re-runs the script.
- **User execution (manual re-runs):** Users must checkout the auth commit first, then run the script to verify smoke tests still pass.

## Placeholders to Replace

When generating the scripts, replace these placeholders with project-specific values:

- `<project-specific-build-command>`: The build command for the detected project type
  - Maven: `mvn package -DskipTests`
  - Gradle: `./gradlew build -x test`
  - .NET: `dotnet build`
  - npm: `npm run build`

- `<project-specific-start-command>`: The command to start the application
  - Maven (Spring Boot): `mvn spring-boot:run` or `java -jar target/*.jar`
  - Gradle (Spring Boot): `./gradlew bootRun` or `java -jar build/libs/*.jar`
  - .NET: `dotnet run` or `dotnet MyApp.dll`
  - npm: `npm start`

## Bash Template (run-layer2-tests.sh)

**NOTE:** This script should be placed in `{modernization-work-folder}/integration-tests/`. The script navigates to the project root to execute commands.

```bash
#!/bin/bash
set -e

# --- Auto-generated Layer 2 smoke test runner ---
# Project: {ProjectName} ({Language}, {Framework})
# Starts infrastructure, builds and runs the app, verifies it stays alive
# and responds to HTTP requests without fatal errors.
#
# Usage:
#   bash {modernization-work-folder}/integration-tests/run-layer2-tests.sh
#
# Environment variable overrides (optional):
#   APP_PORT     - Application port (default: 8080)
#   HEALTH_PATH  - Health endpoint (default: /)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"  # Navigate to project root
COMPOSE_FILE="$PROJECT_ROOT/src/test/resources/docker-compose.smoke.yml"
APP_LOG="/tmp/app-smoke-$$.log"

APP_PORT="${APP_PORT:-8080}"
APP_URL="http://localhost:$APP_PORT"
HEALTH_PATH="${HEALTH_PATH:-/health}"   # Adjust to detected health endpoint
STARTUP_TIMEOUT=60
STABILITY_WAIT=5
CHECKS_PASSED=0
CHECKS_FAILED=0
APP_PID=""

pass() { echo "  ✅ $1"; CHECKS_PASSED=$((CHECKS_PASSED + 1)); }
fail() { echo "  ❌ $1"; CHECKS_FAILED=$((CHECKS_FAILED + 1)); }

cleanup() {
    [ -n "$APP_PID" ] && kill $APP_PID 2>/dev/null || true
    [ -n "$APP_PID" ] && wait $APP_PID 2>/dev/null || true
    docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
    rm -f "$APP_LOG"
}
trap cleanup EXIT

cd "$PROJECT_ROOT"

# --- Step 1: Verify Docker ---
docker info > /dev/null 2>&1 || { echo "ERROR: Docker is not running."; exit 1; }

# --- Step 2: Start infrastructure ---
echo "Starting infrastructure..."
docker compose -f "$COMPOSE_FILE" up -d --wait

# --- Step 3: Build ---
echo "Building application..."
<project-specific-build-command>

# --- Step 4: Start application ---
echo "Starting application..."
<project-specific-start-command> > "$APP_LOG" 2>&1 &
APP_PID=$!

# --- Step 5: Check — Process alive ---
sleep $STABILITY_WAIT
if kill -0 $APP_PID 2>/dev/null; then
    pass "Process is alive (PID $APP_PID)"
else
    fail "Process crashed on startup"
    tail -20 "$APP_LOG" 2>/dev/null || true
    exit 1
fi

# --- Step 6: Check — Health probe ---
HEALTH_STATUS="000"
for i in $(seq 1 $STARTUP_TIMEOUT); do
    HEALTH_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "${APP_URL}${HEALTH_PATH}" 2>/dev/null || echo "000")
    [ "$HEALTH_STATUS" != "000" ] && break
    kill -0 $APP_PID 2>/dev/null || { fail "Process died during health probe"; break; }
    sleep 1
done
[[ "$HEALTH_STATUS" =~ ^[1234] ]] && pass "Health probe (HTTP $HEALTH_STATUS)" \
    || fail "Health probe failed (HTTP $HEALTH_STATUS)"

# --- Step 7: Check — Clean startup logs ---
if grep -qiE "FATAL|panic|unhandled.exception|OutOfMemory|StackOverflow|segfault" "$APP_LOG" 2>/dev/null; then
    fail "Fatal error patterns in startup logs"
else
    pass "No fatal errors in startup logs"
fi

# --- Summary ---
echo ""
echo "========================================"
echo "Results: $CHECKS_PASSED passed, $CHECKS_FAILED failed"
if [ $CHECKS_FAILED -gt 0 ]; then
    echo "❌ Layer 2 smoke tests FAILED"
    exit 1
fi
echo "✅ Layer 2 smoke tests PASSED"
echo "========================================"
```

## PowerShell Template (run-layer2-tests.ps1)

**NOTE:** This script should be placed in `{modernization-work-folder}/integration-tests/`. The script navigates to the project root to execute commands.

```powershell
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

# --- Auto-generated Layer 2 smoke test runner ---
# Project: {ProjectName} ({Language}, {Framework})
# Starts infrastructure, builds and runs the app, verifies it stays alive
# and responds to HTTP requests without fatal errors.
#
# Usage:
#   powershell {modernization-work-folder}/integration-tests/run-layer2-tests.ps1
#
# Environment variable overrides (optional):
#   APP_PORT     - Application port (default: 8080)
#   HEALTH_PATH  - Health endpoint (default: /)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..\..")  # Navigate to project root
$ComposeFile = Join-Path $ProjectRoot "src\test\resources\docker-compose.smoke.yml"
$AppLog = Join-Path $env:TEMP "app-smoke-$PID.log"

$AppPort = if ($env:APP_PORT) { $env:APP_PORT } else { 8080 }
$AppUrl = "http://localhost:$AppPort"
$HealthPath = if ($env:HEALTH_PATH) { $env:HEALTH_PATH } else { "/health" }
$StartupTimeout = 60
$StabilityWait = 5
$ChecksPassed = 0
$ChecksFailed = 0
$AppProcess = $null

function Pass($message) {
    Write-Host "  ✅ $message" -ForegroundColor Green
    $script:ChecksPassed++
}

function Fail($message) {
    Write-Host "  ❌ $message" -ForegroundColor Red
    $script:ChecksFailed++
}

function Cleanup {
    if ($AppProcess -and !$AppProcess.HasExited) {
        Stop-Process -Id $AppProcess.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $AppProcess.Id -ErrorAction SilentlyContinue
    }
    docker compose -f $ComposeFile down -v 2>$null
    if (Test-Path $AppLog) { Remove-Item $AppLog -Force }
}

# Register cleanup
try {
    Set-Location $ProjectRoot

    # --- Step 1: Verify Docker ---
    docker info >$null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker is not running." -ForegroundColor Red
        exit 1
    }

    # --- Step 2: Start infrastructure ---
    Write-Host "Starting infrastructure..."
    docker compose -f $ComposeFile up -d --wait

    # --- Step 3: Build ---
    Write-Host "Building application..."
    <project-specific-build-command>

    # --- Step 4: Start application ---
    Write-Host "Starting application..."
    $AppProcess = Start-Process -FilePath <project-specific-start-command> -RedirectStandardOutput $AppLog -RedirectStandardError $AppLog -PassThru -NoNewWindow

    # --- Step 5: Check — Process alive ---
    Start-Sleep -Seconds $StabilityWait
    if (!$AppProcess.HasExited) {
        Pass "Process is alive (PID $($AppProcess.Id))"
    } else {
        Fail "Process crashed on startup"
        if (Test-Path $AppLog) { Get-Content $AppLog -Tail 20 }
        exit 1
    }

    # --- Step 6: Check — Health probe ---
    $HealthStatus = "000"
    for ($i = 1; $i -le $StartupTimeout; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "$AppUrl$HealthPath" -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
            $HealthStatus = $response.StatusCode
            break
        } catch {
            $HealthStatus = "000"
        }
        if ($AppProcess.HasExited) {
            Fail "Process died during health probe"
            break
        }
        Start-Sleep -Seconds 1
    }
    if ($HealthStatus -match "^[1234]") {
        Pass "Health probe (HTTP $HealthStatus)"
    } else {
        Fail "Health probe failed (HTTP $HealthStatus)"
    }

    # --- Step 7: Check — Clean startup logs ---
    if (Test-Path $AppLog) {
        $logContent = Get-Content $AppLog -Raw
        if ($logContent -match "(?i)(FATAL|panic|unhandled.?exception|OutOfMemory|StackOverflow|segfault)") {
            Fail "Fatal error patterns in startup logs"
        } else {
            Pass "No fatal errors in startup logs"
        }
    }

    # --- Summary ---
    Write-Host ""
    Write-Host "========================================"
    Write-Host "Results: $ChecksPassed passed, $ChecksFailed failed"
    if ($ChecksFailed -gt 0) {
        Write-Host "❌ Layer 2 smoke tests FAILED" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Layer 2 smoke tests PASSED" -ForegroundColor Green
    Write-Host "========================================"
} finally {
    Cleanup
}
```

## Script Behavior

### What the Script Does

1. **Verify Docker** — Check if Docker is running
2. **Start infrastructure** — `docker compose up` with all dependencies
3. **Build application** — Run project-specific build command
4. **Start application** — Run in background, log to temp file
5. **Check: Process alive** — Verify process didn't crash (5s stability wait)
6. **Check: Health probe** — HTTP health check (60s timeout, any non-5xx = pass)
7. **Check: Clean logs** — Scan for fatal error patterns (FATAL, panic, OOM, etc.)
8. **Report results** — Print pass/fail summary
9. **Cleanup** — Kill app, docker down, remove temp log

### Exit Codes

- `0` — All checks passed
- `1` — One or more checks failed

### Environment Variables (Optional)

Users can override defaults:
- `APP_PORT` — Application port (default: 8080)
- `HEALTH_PATH` — Health endpoint path (default: /health)

# Forwards the hook payload from stdin to the telemetrySender CLI.
# Env vars APPMOD_NODE, APPMOD_TELEMETRY_SENDER, ELECTRON_RUN_AS_NODE
# are set by initHookEnvironment() in extension.ts at activation.
# Never exits non-zero — hook failure must not abort the agent.
param(
    [string]$AgentName
)

$ErrorActionPreference = 'SilentlyContinue'

# --- Resolve node runtime ---
$node = $null
if ($env:APPMOD_NODE -and (Test-Path $env:APPMOD_NODE)) { $node = $env:APPMOD_NODE }
elseif (Get-Command node -ErrorAction SilentlyContinue) { $node = (Get-Command node).Source }
if (-not $node) { exit 0 }

# --- Resolve telemetrySender.js ---
$sender = $null
if ($env:APPMOD_TELEMETRY_SENDER -and (Test-Path $env:APPMOD_TELEMETRY_SENDER)) { $sender = $env:APPMOD_TELEMETRY_SENDER }
if (-not $sender) { exit 0 }

$agent = if ($AgentName) { $AgentName } elseif ($env:APPMOD_AGENT) { $env:APPMOD_AGENT } else { 'migration' }

try {
    if ($env:DEBUGTELEMETRY) {
        [Console]::In.ReadToEnd() | & "$node" "$sender" --agent $agent --stdio
    } else {
        [Console]::In.ReadToEnd() | & "$node" "$sender" --agent $agent 2>$null | Out-Null
    }
} catch { }
exit 0

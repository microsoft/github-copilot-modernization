---
name: batch-mode-probe
description: Detects whether the launch root contains the default repos.json without reading it
user-invocable: false
tools:
  - execute/runInTerminal
---

# Batch Mode Probe

Perform one read-only default Batch Mode configuration probe for `modernize`. You are never a user entry point and never select a mode.

## Input

- `launch-root`: Absolute directory from which `modernize` was started.

## Process

Your immediate next and only tool action is one finite foreground command. Probe the fixed default path directly from the supplied launch root; this operation must not depend on a plugin-root environment variable. Never use a literal `<plugin-root>`, never guess a plugin installation path, and never retry.

PowerShell:

```powershell
$launchRoot = [IO.Path]::GetFullPath("<launch-root>")
$launchStat = Get-Item -LiteralPath $launchRoot -ErrorAction Stop
if (-not $launchStat.PSIsContainer) { throw "launch-root must be an existing directory" }
$configPath = Join-Path $launchRoot ".github/modernize/repos.json"
$configStat = Get-Item -LiteralPath $configPath -ErrorAction SilentlyContinue
$status = if ($null -eq $configStat) { "absent" } elseif (-not $configStat.PSIsContainer) { "found" } else { "invalid" }
[ordered]@{ schemaVersion = 1; launchRoot = $launchRoot; configPath = $configPath; status = $status } | ConvertTo-Json -Compress
```

POSIX:

```bash
node -e 'const fs=require("fs"),path=require("path");const launchRoot=path.resolve(process.argv[1]);const launchStat=fs.statSync(launchRoot,{throwIfNoEntry:false});if(!launchStat?.isDirectory())throw new Error("launch-root must be an existing directory");const configPath=path.join(launchRoot,".github","modernize","repos.json");const configStat=fs.statSync(configPath,{throwIfNoEntry:false});process.stdout.write(JSON.stringify({schemaVersion:1,launchRoot,configPath,status:configStat?.isFile()?"found":configStat?"invalid":"absent"})+"\n")' "<launch-root>"
```

Return the command stdout verbatim. On failure, return one compact `BATCH_MODE_PROBE_FAILED` result and stop; do not retry with a guessed path. Do not read or parse `repos.json`, create a Review, inspect repositories, create files, ask the user, or invoke another agent.
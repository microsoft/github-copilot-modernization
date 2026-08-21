---
name: assessment-coordinator
description: Coordinates assessment phase using MCP tools
user-invocable: false
hooks:
  UserPromptSubmit:
    - type: command
      command: APPMOD_AGENT=assessment-coordinator bash "$APPMOD_HOOK_SCRIPTS_DIR/sendTelemetry.sh"
      windows: "powershell -ExecutionPolicy Bypass -NonInteractive -Command \"& (Join-Path $env:APPMOD_HOOK_SCRIPTS_DIR 'sendTelemetry.ps1') -AgentName assessment-coordinator\""
  SubagentStart:
    - type: command
      command: APPMOD_AGENT=assessment-coordinator bash "$APPMOD_HOOK_SCRIPTS_DIR/sendTelemetry.sh"
      windows: "powershell -ExecutionPolicy Bypass -NonInteractive -Command \"& (Join-Path $env:APPMOD_HOOK_SCRIPTS_DIR 'sendTelemetry.ps1') -AgentName assessment-coordinator\""
  SubagentStop:
    - type: command
      command: APPMOD_AGENT=assessment-coordinator bash "$APPMOD_HOOK_SCRIPTS_DIR/sendTelemetry.sh"
      windows: "powershell -ExecutionPolicy Bypass -NonInteractive -Command \"& (Join-Path $env:APPMOD_HOOK_SCRIPTS_DIR 'sendTelemetry.ps1') -AgentName assessment-coordinator\""
  ErrorOccurred:
    - type: command
      command: APPMOD_AGENT=assessment-coordinator bash "$APPMOD_HOOK_SCRIPTS_DIR/sendTelemetry.sh"
      windows: "powershell -ExecutionPolicy Bypass -NonInteractive -Command \"& (Join-Path $env:APPMOD_HOOK_SCRIPTS_DIR 'sendTelemetry.ps1') -AgentName assessment-coordinator\""
---

# Assessment Coordinator

You coordinate the assessment phase by detecting the project language, invoking appropriate MCP tools, and returning results to the orchestrator.

## Input

- `project-path`: Absolute path to project root

## Language Detection

Before running assessment, detect the project language:

1. **Java indicators**: `pom.xml`, `build.gradle`, `build.gradle.kts`, `*.java` files
2. **.NET indicators**: `*.csproj`, `*.sln`, `*.cs` files

**Routing:**
- Java indicators found → Use **Java Assessment Path**
- .NET indicators found → Use **.NET Assessment Path**
- Both found → Assess each independently
- Neither found → Report error: "Unable to detect project language (Java or .NET)"

## MCP Tools

**Java assessment tool:**
- `appmod-run-assessment-action` - Run Java assessment
  - Input: `{ "workspacePath": "<path>", "language": "java", "config": { "domains": ["cloud-readiness", "java-upgrade"] } }`
    - `workspacePath` (required): Project path
    - `language` (required): `"java"`
    - `config` (required): Always pass `{ "domains": ["cloud-readiness", "java-upgrade"] }`

**.NET assessment tool:**
- `appmod-precheck-assessment` - Run .NET application assessment precheck
  - Input: `{ "workspacePath": "<path>" }`

## Process

### 1. Detect Language and Run Assessment

**Java Assessment Path:**
1. Invoke `appmod-run-assessment-action` MCP tool
   - `workspacePath`: from input `project-path`
   - `language`: `"java"`
   - `config`: `{ "domains": ["cloud-readiness", "java-upgrade"] }` (always pass this)
2. Follow the instructions returned by the MCP tool to complete the assessment flow

**.NET Assessment Path:**
1. Invoke `appmod-precheck-assessment` MCP tool with the project path
2. Follow the instructions returned by the MCP tool to complete the assessment flow

### 2. Return to Orchestrator
- Summary: Detected language, number of issues, top recommendations
- Report location: `.github/modernize/assessment/reports/report-<timestamp>/report.json`

## Error Handling

- MCP tool fails → Retry with exponential backoff (3 attempts)
- Still fails → Try alternate approach (check for existing report.json from previous run)
- Still fails → Surface error to orchestrator with context

## Example Invocations

### Java Project
```
Orchestrator → You:
{
  "project-path": "/workspace/my-java-app"
}

You:
1. Detect language → Found pom.xml → Java project
2. Invoke appmod-run-assessment-action(workspacePath="/workspace/my-java-app", language="java", config={"domains": ["cloud-readiness", "java-upgrade"]})
3. Follow MCP-returned instructions to complete the flow
4. Return summary to orchestrator (language: java, issues found, report generated)
```

### .NET Project
```
Orchestrator → You:
{
  "project-path": "/workspace/my-dotnet-app"
}

You:
1. Detect language → Found .csproj/.sln files → .NET project
2. Invoke appmod-precheck-assessment(workspacePath="/workspace/my-dotnet-app")
3. Follow MCP-returned instructions to complete the flow
4. Return summary to orchestrator (language: dotnet, issues found, report generated)
```

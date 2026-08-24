# User Guide

## Introduction

GitHub Copilot modernization provides an autonomous workflow for modernizing applications. This guide covers everything you need to know to use the plugin effectively.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Understanding the Workflow](#understanding-the-workflow)
3. [Batch Assessment Private Preview](#batch-assessment-private-preview)
4. [Troubleshooting](#troubleshooting)

## Getting Started

### Installation

Install the plugin:

```bash
/plugin marketplace add microsoft/github-copilot-modernization
/plugin install github-copilot-modernization@github-copilot-modernization
```

Verify installation:

```bash
/plugin list
# Should show: github-copilot-modernization
```

### Updating the Plugin

Update to the latest version:

```bash
/plugin update github-copilot-modernization
```

### Your First Modernization

1. Navigate to your project:
   ```bash
   cd /path/to/your-java-app
   ```

2. Invoke the modernization agent:
   ```bash
   copilot --agent=github-copilot-modernization:modernize
   ```

   **Important:** Only `modernize` is user-invocable. All other agents are internal and automatically invoked by the orchestrator:
   - `assessment-coordinator` - Internal coordinator for assessment phase
   - `planning-coordinator` - Internal coordinator for planning phase
   - `execution-coordinator` - Internal coordinator for execution phase
   - `modernize-java-upgrade` - Internal agent for Java version upgrades
   - `modernize-azure-java` - Internal agent for Azure migrations

3. The orchestrator will automatically:
   - Assess your application
   - Generate a migration plan
   - Execute the plan using multi-agent orchestration

## Understanding the Workflow

### Phase 1: Assessment

The assessment phase:
- Uses a plugin-owned local catalog and does not call MCP tools
- Supports Java, .NET, and JavaScript/TypeScript discovery and analysis; downstream automated planning/execution supports Java and .NET
- Uses the bundled Node 18+ runtime for AppCAT, npm-check-updates, normalized findings, and report generation
- Full coverage runs six fact documents; security runs one CVE task plus six CWE category tasks
- Executes those as separate batches, with a maximum of seven concurrent assessment subagents
- Writes a versioned HTML report under `.github/modernize/reports/`
- Writes a compatibility report for planning to `.github/modernize/assessment/reports/report-<timestamp>/report.json`

### Phase 2: Planning

The planning phase:
- Loads assessment results
- Generates an executable task plan using MCP tools
- Validates the plan against JSON schema
- Saves the plan to `.github/modernize/<app-name>/plan.md`
- Creates `tasks.json` with task definitions

### Phase 3: Execution

The execution phase:
- Delegates to `execution-coordinator` which routes tasks to specialized agents:
  - **Java upgrade tasks** → `modernize-java-upgrade` (Java 8→11→17→21, Spring Boot upgrades, deprecated API migrations)
  - **Azure migration tasks** → `modernize-azure-java` (Service Bus, Azure SQL, Redis, etc.)
- Each specialized agent queries MCP knowledge base for migration patterns
- Monitors progress and handles errors with automatic retry
- Validates completion with built-in verification

### Project Structure

After running the plugin, you'll see:

```
.github/modernize/
└── your-app/
    ├── assessment/        # Phase 1 results (report.json)
    ├── plan.md      # Phase 2 plan
    └── tasks.json         # Task definitions
```

## Common Usage Patterns

### Java Version Upgrade

```bash
copilot --agent=github-copilot-modernization:modernize
copilot> upgrade this app to Java 21
```

### Azure Migration

```bash
copilot --agent=github-copilot-modernization:modernize
copilot> migrate this Spring Boot app to Azure
```

### Full Modernization

```bash
copilot --agent=github-copilot-modernization:modernize
copilot> modernize my application
```

The orchestrator will assess your app, identify all modernization opportunities, generate a comprehensive plan, and execute it.

## Batch Assessment Private Preview

Batch Assessment can assess several local repositories through the normal `modernize` entry point. Create `.github/modernize/repos.json` under a launch directory:

```json
{
   "repos": [
      {
         "name": "orders",
         "path": "C:\\source\\orders"
      },
      {
         "name": "billing",
         "path": "C:\\source\\billing"
      }
   ]
}
```

Start `modernize` from the launch directory and make your normal request. Whenever the default file exists, the orchestrator's first question asks whether to process its repositories or only the current repository, even if the request already mentions Batch or the current repository:

```text
Assess for cloud readiness using issue-only coverage.
```

Choose **Process repositories from repos.json** to enter Batch mode, or **Only process the current repository** to continue the classic Single workflow. The mode choice does not approve execution. Batch mode next presents a read-only Review; approve that separately through **Start batch**, or choose **Cancel** to stop without execution.

Repositories run sequentially, each in a fresh internal Assessment invocation. Repository reports retain the standard Single Assessment locations. After all repositories reach a terminal state, Batch mode atomically publishes the user-facing result using the same outer layout as the Modernization CLI:

```text
.github/modernize/assessment/reports-<timestamp>/
├── index.html
├── aggregate-report.json
└── repos/
   └── <repository-identity>/
      ├── report.json
      ├── report.html
      └── facts/
```

The final TUI response shows the `index.html` path as the primary result. Plugin-private audit artifacts remain under `.github/modernize/batches/<batch-id>/`; users do not need to navigate that directory to find their report. The copied repository reports are byte-for-byte snapshots of validated canonical artifacts. Classic Single Planning continues to consume the canonical repository-local `report.json` files.

The private preview has these hard limits:

- Only `modernize` is user-invocable; all probe, review, coordinator, phase, and specialist agents are internal.
- Assessment only; Batch Planning, Execution, upgrade, migration, and remediation are unavailable.
- Whole repositories only. Configurations using `include_paths` fail before batch state is created.
- Local execution only; no cloud delegation.
- No retry, cross-session resume, pause, or scheduling after lease takeover. Single Assessment also starts a new run rather than resuming an interrupted Assessment.
- A stale batch is retained only for diagnostics. Start a new Batch Assessment when another run is required.
- Completion comes only from request-bound validated report artifacts, not agent prose.

## Troubleshooting

### Common Issues

**Issue: "MCP server failed health check"**

Solution:
- Ensure `@microsoft/github-copilot-app-modernization-mcp-server` is installed
- Check MCP server logs in `.github/modernize/logs/`
- Restart the plugin

**Issue: "Assessment failed: No Java application found"**

Solution:
- Verify `pom.xml` or `build.gradle` exists in the specified path
- Check that the path points to a Java project root
- Try specifying the app path explicitly

**Issue: "Execution failed: Task timed out"**

Solution:
- The plugin uses intelligent retry with multiple approaches
- Ask the orchestrator to continue or retry specific tasks

### Logs

Check logs for detailed error information:

```
.github/modernize/
└── logs/
    ├── assessment.log
    ├── planning.log
    └── execution.log
```

### Getting Help

- Review [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) for technical details
- Check the plugin's GitHub issues for known problems

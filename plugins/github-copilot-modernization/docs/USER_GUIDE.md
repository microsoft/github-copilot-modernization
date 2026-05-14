# User Guide

## Introduction

GitHub Copilot modernization provides an autonomous workflow for modernizing applications. This guide covers everything you need to know to use the plugin effectively.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Understanding the Workflow](#understanding-the-workflow)
3. [Troubleshooting](#troubleshooting)

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
- Discovers Java applications in the specified path
- Analyzes dependencies, frameworks, and Java version
- Identifies migration opportunities and risks
- Saves results to `.github/modernize/assessment/` (report.json)

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

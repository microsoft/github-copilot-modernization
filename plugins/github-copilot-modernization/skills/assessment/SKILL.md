---
name: assessment
description: Run application assessment for a single repository
---

# Application Assessment

This skill performs application assessment for a single repository using AppCAT tools.

## When to Use This Skill

Use this skill when you need to:

- Assess a Java or .NET application for cloud readiness and migration issues
- Generate detailed assessment reports with issue analysis and recommendations
- Understand application dependencies, frameworks, and potential migration blockers

## What This Skill Does

This skill performs a simplified assessment workflow:

1. **Check Project Type and Prerequisites**:
   - **For Java projects**: Verify that MCP tools are available ('appmod-precheck-assessment' and 'appmod-run-assessment')
     - If these MCP tools are not configured, return immediately with setup instructions
   - **For .NET projects**: Check if .NET SDK is available
     - No MCP tools required for .NET assessment

2. **Clean Previous Assessment Data**:
   - Remove files in `.github/modernize/assessment` folder to prevent interference with the new assessment
   - This ensures a clean state before running the assessment

3. **Run Assessment**:
   - **For Java projects**: Trigger AppCAT analysis via Assessment MCP server
     - Uses 'appmod-precheck-assessment' and 'appmod-run-assessment' MCP tools
     - **Must specify domain**: Pass `domain` parameter as "Java Upgrade" or "Migrate to Azure" or both
       - Example: `appmod-run-assessment --domain "Java Upgrade" --projectPath /path/to/project`
       - Example: `appmod-run-assessment --domain "Migrate to Azure" --projectPath /path/to/project`
     - Auto-detects project configuration
   - **For .NET projects**: Install and run AppCAT directly
     - Install: `dotnet tool update dotnet-appcat`
     - Find all .csproj files in the workspace
     - Join project paths with semicolons: `projectPaths="project1.csproj;project2.csproj"`
     - Run: `dotnet-appcat analyze $projectPaths --source Solution --target Any --serializer APPMODJSON --code --privacyMode Restricted --non-interactive --report {workspace-path}\.github\modernize\assessment\report.json`
   - Analyzes code for cloud migration issues
   - Generates structured assessment data
   - Report is stored under `.github/modernize/assessment/` directory

4. **Consolidate Report** (Java projects only):
   - Search for `report.json` under `.github/modernize/assessment/` subdirectories
   - Common locations: `.github/modernize/assessment/result/report.json`
   - Copy the latest report to `.github/modernize/assessment/report.json`
   - For .NET projects, the report is already generated at `.github/modernize/assessment/report.json`
   - This consolidated report should be included in the pull request

## Input Parameters

- `workspace-path` (required): Path to the project to assess
- `domain` (required for Java projects): Assessment domain(s)
  - For Java projects: Must specify one or both of:
    - `"Java Upgrade"` - For Java version and framework upgrade assessment
    - `"Migrate to Azure"` - For Azure migration readiness assessment
    - Both domains can be specified: `["Java Upgrade", "Migrate to Azure"]`
  - For .NET projects: This parameter is not used (automatically handles all assessment types)

## How to Use

### Prerequisites

**For Java projects**:
- MCP tools must be available: 'appmod-precheck-assessment' and 'appmod-run-assessment'
- If tools are not configured, the skill will return instructions for setup

**For .NET projects**:
- .NET SDK must be installed
- No MCP tools required - appcat will be installed and run directly via .NET CLI
- The assessment will automatically install `dotnet-appcat` tool if not already present

### Triggering Assessment

Simply express the intent to assess the application. Example prompts:

- "Assess the application"
- "Run assessment for this project"

The assessment process automatically:
- Detects project language and framework
- **For Java**: 
  - Uses MCP tools to install and run AppCAT
  - **Requires domain specification**: You must specify which assessment domain(s) to run:
    - `"Java Upgrade"` - Analyzes Java version upgrade paths, Spring Boot versions, deprecated APIs
    - `"Migrate to Azure"` - Analyzes Azure migration readiness, service recommendations
    - Both domains can be run sequentially by specifying both
  - Example: `appmod-run-assessment` with domain parameter set to `"Java Upgrade"` or `"Migrate to Azure"`
- **For .NET**: Installs dotnet-appcat tool and runs analysis directly
- Executes comprehensive analysis
- Generates report at `.github/modernize/assessment/report.json`

### Report Consolidation


**For Java projects**:
1. Search for `report.json` files under `.github/modernize/assessment/` subdirectories
2. If multiple reports exist, identify the most recently modified one
3. Copy the latest report to `.github/modernize/assessment/report.json`
4. Include this consolidated report in the pull request

**For .NET projects**:
1. Report is directly generated at `.github/modernize/assessment/report.json`
2. Include this report in the pull request

## Report Output Location

Report location depends on project type:

**For Java projects** (via MCP server):
- Initially stored under `.github/modernize/assessment/` subdirectories
- Common locations: `.github/modernize/assessment/result/report.json`
- Consolidated to: `.github/modernize/assessment/report.json`

**For .NET projects** (direct execution):
- Directly generated at: `.github/modernize/assessment/report.json`

Final report location (include this in pull request):
- `.github/modernize/assessment/report.json`
## Success Criteria

Assessment is complete when:
- ✅ **For Java**: MCP server is available (or clear instructions provided if not)
- ✅ **For .NET**: .NET SDK is available and dotnet-appcat tool is installed
- ✅ AppCAT analysis executes without errors
- ✅ Report generated at `.github/modernize/assessment/report.json`
- ✅ Report metadata includes assessment tool version, timestamp, and configuration

## Troubleshooting

**Prerequisites Not Met**:
- **For Java**: Verify MCP tools are available ('appmod-precheck-assessment' and 'appmod-run-assessment')
  - Return immediately with setup instructions if tools are not available
  - Do not attempt to run assessment without MCP
- **For .NET**: Verify .NET SDK is installed
  - Check with `dotnet --version` command
  - Provide installation instructions if .NET SDK is missing

**Assessment Failures**:
- Unsupported project type (only Java and .NET supported)
- **For Java**: MCP server communication errors
- **For .NET**: 
  - dotnet-appcat tool installation failure
  - dotnet-appcat command execution errors
- Invalid project structure or build configuration

**Report Generation Issues**:
- **For Java**: No report.json found under `.github/modernize/assessment/` subdirectories after MCP execution
- **For .NET**: Report not generated at `.github/modernize/assessment/report.json`
- Report file is corrupted or invalid JSON

For any failure, provide clear error messages and troubleshooting steps.

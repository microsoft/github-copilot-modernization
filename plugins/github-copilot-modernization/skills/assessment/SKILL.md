---
name: assessment
description: Run application assessment for a single repository
---

# Application Assessment

This skill performs application assessment for a single repository. It supports Java, .NET, and JavaScript/TypeScript projects.

## Input Parameters

- `workspace-path` (optional): Path to the project to assess. Defaults to the current directory (repository root) when not specified. All assessment outputs are written relative to this path (e.g. `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json`). For a repository with multiple sub-projects, pass the sub-project directory path so that each sub-project's outputs are isolated.

## When to Use This Skill

Use this skill when you need to:

- Assess a Java or .NET application for cloud readiness and migration issues
- Assess a JavaScript/TypeScript project for outdated dependencies and available updates
- Generate detailed assessment reports with issue analysis and recommendations
- Understand application dependencies, frameworks, and potential migration blockers

## What This Skill Does

This skill performs a simplified assessment workflow:

1. **Check Project Type and Prerequisites**:
   - **For Java projects**: Check MCP tool availability in this order:
     1. **Primary**: Check if 'appmod-run-assessment-action' MCP tool is available
        - If available, use ONLY this tool. It handles everything (prerequisite checks, installation, and assessment execution) in a single call.
        - Do NOT call any other assessment MCP tools when this tool is available.
     2. **Fallback**: If 'appmod-run-assessment-action' is NOT available, check if 'appmod-precheck-assessment' MCP tool is available
        - If available, use the legacy workflow: call 'appmod-precheck-assessment' first, then follow its guidance for 'appmod-install-appcat' and 'appmod-run-assessment'.
     3. If neither tool is configured, return immediately with setup instructions.
   - **For .NET projects**: Check if .NET SDK is available
     - No MCP tools required for .NET assessment
   - **For JavaScript/TypeScript projects**: Check if Node.js and npm are available
     - No MCP tools required for JS/TS assessment

2. **Run Assessment**:
   - **For Java projects**: Trigger AppCAT analysis via Assessment MCP server
     - **If 'appmod-run-assessment-action' is available (primary path)**:
       - Call 'appmod-run-assessment-action' MCP tool only
       - The MCP tool automatically saves the report to the versioned directory
     - **If falling back to 'appmod-precheck-assessment' (legacy path)**:
       - Call 'appmod-precheck-assessment' to check prerequisites
       - Call 'appmod-install-appcat' to install AppCAT if needed
       - Call 'appmod-run-assessment' to run the assessment
   - **For .NET projects**: Install and run AppCAT directly
     - Install: `dotnet tool update dotnet-appcat`
     - Find all .csproj files under `{workspace-path}`
     - Join project paths with semicolons: `projectPaths="project1.csproj;project2.csproj"`
     - Run: `appcat analyze $projectPaths --source Solution --target Any --serializer APPMODJSON --code --privacyMode Restricted --non-interactive --report {workspace-path}\.github\modernize\appcat\result\report.json`
   - **For JavaScript/TypeScript projects**: Install and run npm-check-updates
     - Install: `npm install -g npm-check-updates@19.6.3 --prefix {tool-install-dir}`
     - Run: `ncu --format group --packageFile {workspace-path}/package.json`
     - Generate the `reportId` as a UTC timestamp formatted as `yyyyMMddHHmmss` (e.g. `2024-06-15T14:30:52Z` becomes `20240615143052`)
     - Create the versioned directory: `mkdir -p {workspace-path}/.github/modernize/assessment/reports/report-{reportId}`
     - Save the output to `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/js-assessment-report.md`
     - Do NOT save a copy to the top-level assessment directory
   - Analyzes code for cloud migration issues or dependency updates
   - Generates structured assessment data

3. **Save Report to Versioned Directory (All languages)**:
   - **For Java projects (primary path — 'appmod-run-assessment-action')**: The MCP tool automatically saves the report to `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json` — no manual saving needed
   - **For Java projects (legacy fallback path — 'appmod-precheck-assessment')**:
     1. Find `report.json` under `{workspace-path}/.github/modernize/appcat/result/`
     2. Read the report and extract `metadata.analysisStartTime`
     3. Format the timestamp as `yyyyMMddHHmmss` to produce the `reportId` (e.g. `2024-06-15T14:30:52Z` becomes `20240615143052`)
     4. Create the versioned directory: `mkdir -p {workspace-path}/.github/modernize/assessment/reports/report-{reportId}`
     5. Move the report to `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json`
   - **For .NET projects**:
     1. Find `report.json` at `{workspace-path}/.github/modernize/appcat/result/report.json`
     2. Read the report and extract `metadata.analysisStartTime`
     3. Format the timestamp as `yyyyMMddHHmmss` to produce the `reportId` (e.g. `2024-06-15T14:30:52Z` becomes `20240615143052`)
     4. Create the versioned directory: `mkdir -p {workspace-path}/.github/modernize/assessment/reports/report-{reportId}`
     5. Move the report to `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json`
   - This versioned report should be included in the pull request

## How to Use

### Prerequisites

**For Java projects**:
- **Primary**: MCP tool 'appmod-run-assessment-action' — preferred, handles everything in one call
- **Fallback**: If primary tool is not available, use 'appmod-precheck-assessment' → 'appmod-install-appcat' → 'appmod-run-assessment' workflow
- If neither tool is configured, the skill will return instructions for setup

**For .NET projects**:
- .NET SDK must be installed
- No MCP tools required - appcat will be installed and run directly via .NET CLI
- The assessment will automatically install `dotnet-appcat` tool if not already present

**For JavaScript/TypeScript projects**:
- Node.js and npm must be installed
- No MCP tools required - npm-check-updates will be installed and run directly via npm
- The assessment will automatically install `npm-check-updates` if not already present

### Triggering Assessment

Simply express the intent to assess the application. Example prompts:

- "Assess the application"
- "Run assessment for this project"

The assessment process automatically:
- Detects project language and framework within `{workspace-path}`
- **For Java**: Uses MCP tool to run AppCAT and automatically save report to versioned directory
- **For .NET**: Installs dotnet-appcat tool and runs analysis directly
- **For JavaScript/TypeScript**: Installs npm-check-updates and runs dependency analysis
- Executes comprehensive analysis
- **For Java (primary)**: Report is automatically saved to `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json`
- **For Java (legacy fallback)**: Generates report at `{workspace-path}/.github/modernize/appcat/result/`, then moved to versioned directory
- **For .NET**: Generates report at `{workspace-path}/.github/modernize/appcat/result/report.json`
- **For JavaScript/TypeScript**: Generates report at `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/js-assessment-report.md`

### Report Saving

**For Java projects**:
1. **If using 'appmod-run-assessment-action' (primary path)**: The MCP tool automatically saves the report to `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json` — no manual report moving is needed
2. **If using legacy fallback path ('appmod-precheck-assessment')**:
   - Find `report.json` under `{workspace-path}/.github/modernize/appcat/result/`
   - Read the report and extract `metadata.analysisStartTime`, format as `yyyyMMddHHmmss` to get `reportId`
   - Move the report to `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json`
3. Include this versioned report in the pull request

**For .NET projects**:
1. Report is initially generated at `{workspace-path}/.github/modernize/appcat/result/report.json`
2. Read the report and extract `metadata.analysisStartTime`, format as `yyyyMMddHHmmss` to get `reportId`
3. Move the report to `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json`
4. Include this versioned report in the pull request

**For JavaScript/TypeScript projects**:
1. Generate the `reportId` as a UTC timestamp formatted as `yyyyMMddHHmmss` (e.g. `2024-06-15T14:30:52Z` becomes `20240615143052`)
2. Create the versioned directory: `mkdir -p {workspace-path}/.github/modernize/assessment/reports/report-{reportId}`
3. Save the ncu output to `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/js-assessment-report.md`
4. Include this versioned report in the pull request

## Report Output Location

Report location depends on project type:

**For Java projects** (via MCP server):
- **Primary path ('appmod-run-assessment-action')**: Automatically saved to: `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json`
- **Legacy fallback path ('appmod-precheck-assessment')**: Initially stored under `{workspace-path}/.github/modernize/appcat/result/`, then moved to versioned directory: `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json`

**For .NET projects** (direct execution):
- Initially generated at: `{workspace-path}/.github/modernize/appcat/result/report.json`
- Moved to versioned directory: `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json`

**For JavaScript/TypeScript projects** (direct execution):
- Saved to versioned directory: `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/js-assessment-report.md`

## Success Criteria

Assessment is complete when:
- ✅ **For Java**: MCP server is available (or clear instructions provided if not)
- ✅ **For .NET**: .NET SDK is available and dotnet-appcat tool is installed
- ✅ **For JavaScript/TypeScript**: Node.js and npm are available and npm-check-updates is installed
- ✅ AppCAT analysis executes without errors (Java/.NET) or ncu analysis executes without errors (JS/TS)
- ✅ **For Java and .NET**: Report generated at `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/report.json`
- ✅ **For JavaScript/TypeScript**: Report generated at `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/js-assessment-report.md`
- ✅ Report metadata includes assessment tool version, timestamp, and configuration

## Troubleshooting

**Prerequisites Not Met**:
- **For Java**: First check for 'appmod-run-assessment-action', then fall back to 'appmod-precheck-assessment'
  - Return immediately with setup instructions if neither tool is available
  - Do not attempt to run assessment without MCP
- **For .NET**: Verify .NET SDK is installed
  - Check with `dotnet --version` command
  - Provide installation instructions if .NET SDK is missing
- **For JavaScript/TypeScript**: Verify Node.js and npm are installed
  - Check with `npm --version` command
  - Provide installation instructions if npm is missing

**Assessment Failures**:
- Unsupported project type (only Java, .NET, and JavaScript/TypeScript supported)
- **For Java**: MCP server communication errors
- **For .NET**:
  - dotnet-appcat tool installation failure
  - appcat command execution errors
- **For JavaScript/TypeScript**:
  - npm-check-updates installation failure
  - ncu command execution errors
  - No package.json found at `{workspace-path}/package.json`
- Invalid project structure or build configuration

**Report Generation Issues**:
- **For Java (primary)**: No report.json found under `{workspace-path}/.github/modernize/assessment/reports/report-*/report.json` after MCP execution
- **For Java (legacy fallback)**: No report.json found under `{workspace-path}/.github/modernize/appcat/result/` after MCP execution
- **For .NET**: Report not generated at `{workspace-path}/.github/modernize/appcat/result/report.json`, or `metadata.analysisStartTime` missing from report
- **For JavaScript/TypeScript**: Report not generated at `{workspace-path}/.github/modernize/assessment/reports/report-{reportId}/js-assessment-report.md`
- Report file is corrupted or invalid JSON (Java/.NET only)

For any failure, provide clear error messages and troubleshooting steps.

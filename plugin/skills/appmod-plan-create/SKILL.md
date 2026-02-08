---
name: appmod-create-plan
description: Create a modernization plan based on a user prompt for Java or .NET projects
allowed-tools: Bash(appmod:*)
---

# AppMod Create Plan

Create a modernization plan for your Java or .NET project based on your specific goals and requirements.

## Instructions

When the user invokes this command, follow these steps:

### 1. Parameter Collection

The modernization prompt is the only required parameter. Collect it first, then offer optional customizations.

**Required Parameters:**

- `prompt`: The modernization goal to achieve. Must not be empty or whitespace-only.
  - Prompt: "What modernization goal would you like to achieve? (e.g., 'migrate to Azure', 'upgrade to .NET Core 10', 'containerize the application')"

**Optional Parameters:**

- `--project`: Project directory to analyze. Default: current directory (`.`)
- `--plan-name`: Name for this plan. Default: `modernization-plan`
- `--language`: Project language (`java` or `dotnet`). Default: auto-detect
- `--issue-url`: GitHub issue URL to link to this plan

**Example interaction:**
```
I'll help you create a modernization plan for your project.

What modernization goal would you like to achieve?
Examples:
- "migrate to Azure"
- "upgrade to .NET Core 10"
- "containerize the application"
- "modernize legacy dependencies"

User: upgrade to .NET Core 10 and add container support
Got it! I'll create a plan for upgrading to .NET Core 10 with container support.

Would you like to customize any of these options?
- Project directory (default: current directory)
- Plan name (default: modernization-plan)
- Language (default: auto-detect)
- Link to a GitHub issue

Or I can proceed with defaults - just say "go" or "continue".
```

### 2. Validation

Before executing, validate:

- **`prompt`**: Must not be empty or whitespace-only. If empty, ask the user to provide a modernization goal.
- **`--language`**: If provided, must be either `java` or `dotnet` (case-insensitive)
- **`--issue-url`**: If provided, must be a valid GitHub issue URL matching pattern `https://github.com/<owner>/<repo>/issues/<number>`
- **`--project`**: If provided, verify the directory exists

If validation fails, explain the issue clearly and ask the user to provide a corrected value.

### 3. Execution

Run the following command (always include `--no-tty` for plain text output):

```bash
appmod plan create "<prompt>" [--project <path>] [--plan-name <name>] [--language <lang>] [--issue-url <url>] --no-tty
```

**Important:** Properly escape the user-provided prompt when constructing the shell command to prevent injection.

### 4. Results

After execution:

1. Read and present the generated plan from `.appmod/plans/<plan-name>/plan.md`
2. Provide a summary of the plan's key phases and tasks
3. Offer to explain any part of the plan in detail
4. Suggest running `/appmod-run-plan` as a next step to execute the plan

## Error Handling

If the command fails:
1. Parse the error output to identify the root cause
2. Explain the error in user-friendly terms
3. Suggest corrective actions
4. Offer to retry with modified parameters

## Examples

**Create a plan for Azure migration:**
```
User: /appmod-create-plan
Claude: What modernization goal would you like to achieve?
User: migrate my app to Azure App Service
Claude: [Executes: appmod plan create "migrate my app to Azure App Service" --no-tty]
```

**Create a named plan with custom directory:**
```
User: /appmod-create-plan
User: upgrade to .NET 8, call it dotnet8-upgrade, project is in ./src/MyApp
Claude: [Executes: appmod plan create "upgrade to .NET 8" --plan-name dotnet8-upgrade --project ./src/MyApp --no-tty]
```

**Create a plan linked to an issue:**
```
User: /appmod-create-plan
User: containerize the app, link to https://github.com/myorg/myrepo/issues/15
Claude: [Executes: appmod plan create "containerize the app" --issue-url https://github.com/myorg/myrepo/issues/15 --no-tty]
```

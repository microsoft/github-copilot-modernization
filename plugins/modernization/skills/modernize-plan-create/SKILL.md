---
name: modernize-plan-create
description: "Create a modernization plan based on a user prompt for Java or .NET projects. USE FOR: create plan, make migration plan, plan modernization, plan upgrade, modernize plan create, design migration strategy, plan .NET upgrade, plan Java migration, containerization plan, Azure migration plan. DO NOT USE FOR: running assessments (use modernize-assess), executing existing plans (use modernize-plan-execute)."
---

# Modernize Create Plan

> ⛔ **MANDATORY**: Follow [global-rules](../_shared/global-rules.md) for all operations.
>
> **PREREQUISITE**: Consider running **modernize-assess** first to identify modernization opportunities before creating a plan.

Create a modernization plan for your Java or .NET project based on your specific goals and requirements.

## Instructions

When the user invokes this command, follow these steps:

## Rule 0: Ensure the modernize CLI is Installed

⛔ **ALWAYS** verify the `modernize` CLI is available before running any `modernize` command.

Run the following check:

- **Linux/macOS (bash)**:
  ```bash
  export PATH="$PATH:$HOME/.local/bin" && command -v modernize
  ```
- **Windows (PowerShell)**:
  ```powershell
  $env:PATH += ";$env:LOCALAPPDATA\Programs\modernize"; Get-Command modernize -ErrorAction SilentlyContinue
  ```

If `modernize` is **not found**, install it by running the appropriate installer for the platform:

- **Linux/macOS (bash)**:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/microsoft/modernize-cli/main/scripts/install.sh | sh
  ```
- **Windows (PowerShell)**:
  ```powershell
  irm https://raw.githubusercontent.com/microsoft/modernize-cli/main/scripts/install.ps1 | iex
  ```

After installation, the install script will print the exact PATH entry to add. Use that output to ensure the binary is on PATH for subsequent commands. If the script did not print a path, fall back to the default:

- **Linux/macOS (bash)**:
  ```bash
  export PATH="$PATH:$HOME/.local/bin"
  ```
- **Windows (PowerShell)**:
  ```powershell
  $env:PATH += ";$env:LOCALAPPDATA\Programs\modernize"
  ```

If the installation fails, explain the error and link the user to https://github.com/microsoft/modernize-cli for manual installation instructions.

### 1. Parameter Collection

The modernization prompt is the only required parameter. Collect it first, then offer optional customizations.

**Required Parameters:**

- `prompt`: The modernization goal to achieve. Must not be empty or whitespace-only.
  - Prompt: "What modernization goal would you like to achieve? (e.g., 'migrate to Azure', 'upgrade to .NET Core 10', 'containerize the application')"

**Optional Parameters:**

- `--source`: Path to root of repository (relative or absolute local path). Default: current directory (`.`)
- `--plan-name`: Name for this plan. Generate a name based on the prompt (e.g., "azure-migration-plan") if not provided. The name should not duplicate existing plans in `.github/modernize/`.
- `--overwrite`: Pass this flag to replace an existing plan that has the same `--plan-name`. Before passing it, **always ask the user to confirm** (per global-rules Rule 1), e.g., "A plan named `<name>` already exists. Overwrite it?". Do not pass `--overwrite` silently.
- `--language`: Project language (`java` or `dotnet`). Default empty to auto detect based on source code analysis. If provided, must be either `java` or `dotnet`.

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
- Source path (default: current directory)
- Plan name (default: modernization-plan)
- Language (default: auto-detect)
- Override existing plan if it exists (default: no)

Or I can proceed with defaults - just say "go" or "continue".
```

### 2. Validation

Before executing, validate:

- **`prompt`**: Must not be empty or whitespace-only. If empty, ask the user to provide a modernization goal.
- **`--language`**: If provided, must be either `java` or `dotnet` (case-insensitive)
- **`--source`**: If provided, verify the directory exists
- **`--plan-name`**: If provided, check if a plan with the same name already exists in `.github/modernize/`. If it does, ask the user to confirm overwriting (per global-rules Rule 1).
- **`--overwrite`**: If provided, allows overwriting an existing plan. Always ask the user to confirm before proceeding.


If validation fails, explain the issue clearly and ask the user to provide a corrected value.

### 3. Execution

Run the following command (always include `--no-tty` for plain text output):

```bash
modernize plan create "<prompt>" [--source <path>] [--plan-name <name>] [--language <lang>] [--overwrite] --no-tty
```

**Important:** Properly escape the user-provided prompt when constructing the shell command to prevent injection.

### 4. Results

After execution:

1. Read and present the generated plan from `.github/modernize/plans/<plan-name>/plan.md` and `.github/modernize/plans/<plan-name>/tasks.json`
2. Provide a summary of the plan's key phases and tasks
3. Offer to explain any part of the plan in detail
4. Suggest running `/modernize-plan-execute` as a next step to execute the plan

## Error Handling

If the command fails:
1. Parse the error output to identify the root cause
2. Explain the error in user-friendly terms
3. Suggest corrective actions
4. Offer to retry with modified parameters

## Examples

**Create a plan for Azure migration:**
```
User: /modernize-plan-create
Claude: What modernization goal would you like to achieve?
User: migrate my app to Azure App Service
Claude: [Executes: modernize plan create "migrate my app to Azure App Service" --no-tty]
```

**Create a named plan with custom directory:**
```
User: /modernize-plan-create
User: upgrade to .NET 8, call it dotnet8-upgrade, project is in ./src/MyApp
Claude: [Executes: modernize plan create "upgrade to .NET 8" --plan-name dotnet8-upgrade --source ./src/MyApp --no-tty]
```

**Create a plan linked to an issue:**
```
User: /modernize-plan-create
User: containerize the app, link to https://github.com/myorg/myrepo/issues/15
Claude: [Executes: modernize plan create "containerize the app" --issue-url https://github.com/myorg/myrepo/issues/15 --no-tty]
```

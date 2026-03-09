---
name: modernize-plan-execute
description: "Execute an existing modernization plan for Java or .NET projects. USE FOR: run plan, execute plan, apply changes, modernize plan execute, start migration, run modernization, apply upgrade, implement plan, carry out migration. DO NOT USE FOR: running assessments (use modernize-assess), creating new plans (use modernize-create-plan)."
---

# Modernize Run Plan

> ⛔ **MANDATORY**: Follow [global-rules](../_shared/global-rules.md) for all operations.
>
> **NOTE**: A modernization plan must exist before executing. Plans can be created with **modernize-create-plan** or provided externally.

Execute an existing modernization plan to apply the planned changes to your Java or .NET project.

## Instructions

When the user invokes this command, follow these steps:

### 1. Ensure the modernize CLI is installed

Before doing anything else, check if the `modernize` CLI is available:

```bash
export PATH="$PATH:$HOME/.modernize/bin" && command -v modernize
```

If `modernize` is **not found**, install it:
- **Linux/macOS**: `curl -fsSL https://raw.githubusercontent.com/microsoft/modernize-cli/main/scripts/install.sh | sh`
- **Windows (PowerShell)**: `irm https://raw.githubusercontent.com/microsoft/modernize-cli/main/scripts/install.ps1 | iex`

After installation, ensure the binary is on PATH: `export PATH="$PATH:$HOME/.modernize/bin"`

If the installation fails, explain the error and link the user to https://github.com/microsoft/modernize-cli for manual installation.

### 2. Pre-Execution Check

Before collecting parameters, verify that a plan exists:

1. Check for the plan at `.github/modernize/<plan-name>/plan.md` (default: `.github/modernize/modernization-plan/plan.md`)
2. If no plan exists, inform the user and suggest running `/modernize-create-plan` first
3. If a plan exists, show a brief summary and ask for confirmation before proceeding

**Example when no plan exists:**
```
I couldn't find a modernization plan at `.github/modernize/modernization-plan/plan.md`.

Would you like me to:
1. Create a new plan first using /modernize-create-plan
2. Specify a different plan name if you have an existing plan elsewhere
```

### 3. Parameter Collection

All parameters are optional with sensible defaults.

**Optional Parameters:**

- `prompt`: Specific instructions for executing the plan. Default: `execute the plan`
  - Prompt: "Any specific instructions for executing the plan? (Default: 'execute the plan')"
- `--plan-name <plan-name>`: The name of the modernization plan. Default: `modernization-plan`
- `--source <source>`: Path to source project (relative or absolute local path). Default: `.`
- `--language <java|dotnet>`: The programming language for the modernization plan. Default: auto-detect

**Example interaction:**
```
I found the modernization plan at `.github/modernize/modernization-plan/plan.md`.

Plan Summary:
- Phase 1: Update dependencies
- Phase 2: Migrate configuration
- Phase 3: Update deployment

Would you like to customize the execution?
- Specific instructions (default: "execute the plan")

Or I can proceed with defaults - just say "go" or "continue".
```

### 4. Validation

Before executing, validate:

- **`prompt`**: If provided, must not be empty
- **`--language`**: If provided, must be either `java` or `dotnet` (case-insensitive)
- **Plan exists**: Verify `.github/modernize/<plan-name>/plan.md` exists before attempting execution

If validation fails, explain the issue clearly and ask the user to provide a corrected value.

### 5. Execution

Run the following command (always include `--no-tty` for plain text output):

```bash
modernize plan execute "<prompt>" [--plan-name <plan-name>] [--source <source>] [--language <java|dotnet>] --no-tty
```

**Important:** Properly escape the user-provided prompt when constructing the shell command to prevent injection.

### 6. Results

After execution:

1. Report the execution status (success, partial success, or failure)
2. Summarize what changes were made
3. List completed tasks vs remaining tasks
4. Report execution progress
5. Suggest next steps based on results:
   - If all tasks completed: Suggest reviewing changes and running tests
   - If some tasks remain: Offer to continue execution or investigate issues
   - If failures occurred: Help diagnose and suggest remediation

## Error Handling

If the command fails:
1. Parse the error output to identify the root cause
2. Explain the error in user-friendly terms
3. Suggest corrective actions
4. Offer to retry with modified parameters or help investigate the issue

## Examples

**Execute with defaults:**
```
User: /modernize-run-plan
Claude: [Checks for plan, shows summary]
Claude: Ready to execute. Proceed?
User: go
Claude: [Executes: modernize plan execute "execute the plan" --no-tty]
```

**Execute a specific plan:**
```
User: /modernize-run-plan
User: run the dotnet8-upgrade plan
Claude: [Executes: modernize plan execute "execute the plan" --plan-name dotnet8-upgrade --no-tty]
```

**Execute with custom instructions:**
```
User: /modernize-run-plan
User: focus on the dependency updates first
Claude: [Executes: modernize plan execute "focus on the dependency updates first" --no-tty]
```

**When no plan exists:**
```
User: /modernize-run-plan
Claude: I couldn't find a plan at `.github/modernize/modernization-plan/plan.md`.
        Would you like to create one first with /modernize-create-plan?
```

---
name: appmod-run-plan
description: Execute an existing modernization plan for Java or .NET projects
allowed-tools: Bash(appmod:*)
---

# AppMod Run Plan

Execute an existing modernization plan to apply the planned changes to your Java or .NET project.

## Instructions

When the user invokes this command, follow these steps:

### 1. Pre-Execution Check

Before collecting parameters, verify that a plan exists:

1. Check for the plan at `.appmod/plans/<plan-name>/plan.md` (default: `.appmod/plans/modernization-plan/plan.md`)
2. If no plan exists, inform the user and suggest running `/appmod-create-plan` first
3. If a plan exists, show a brief summary and ask for confirmation before proceeding

**Example when no plan exists:**
```
I couldn't find a modernization plan at `.appmod/plans/modernization-plan/plan.md`.

Would you like me to:
1. Create a new plan first using /appmod-create-plan
2. Specify a different plan name if you have an existing plan elsewhere
```

### 2. Parameter Collection

All parameters are optional with sensible defaults.

**Optional Parameters:**

- `prompt`: Specific instructions for executing the plan. Default: `execute the plan`
  - Prompt: "Any specific instructions for executing the plan? (Default: 'execute the plan')"
- `--plan-name`: Which plan to execute. Default: `modernization-plan`
- `--project`: Project directory. Default: current directory (`.`)
- `--language`: Project language (`java` or `dotnet`). Default: auto-detect
- `--issue-url`: GitHub issue URL to link execution progress to

**Example interaction:**
```
I found the modernization plan at `.appmod/plans/modernization-plan/plan.md`.

Plan Summary:
- Phase 1: Update dependencies
- Phase 2: Migrate configuration
- Phase 3: Update deployment

Would you like to customize the execution?
- Specific instructions (default: "execute the plan")
- Link progress to a GitHub issue

Or I can proceed with defaults - just say "go" or "continue".
```

### 3. Validation

Before executing, validate:

- **`prompt`**: If provided, must not be empty
- **`--language`**: If provided, must be either `java` or `dotnet` (case-insensitive)
- **`--issue-url`**: If provided, must be a valid GitHub issue URL matching pattern `https://github.com/<owner>/<repo>/issues/<number>`
- **Plan exists**: Verify `.appmod/plans/<plan-name>/plan.md` exists before attempting execution

If validation fails, explain the issue clearly and ask the user to provide a corrected value.

### 4. Execution

Run the following command (always include `--no-tty` for plain text output):

```bash
appmod plan execute "<prompt>" [--plan-name <name>] [--project <path>] [--language <lang>] [--issue-url <url>] --no-tty
```

**Important:** Properly escape the user-provided prompt when constructing the shell command to prevent injection.

### 5. Results

After execution:

1. Report the execution status (success, partial success, or failure)
2. Summarize what changes were made
3. List completed tasks vs remaining tasks
4. If `--issue-url` was provided, confirm progress was posted
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
User: /appmod-run-plan
Claude: [Checks for plan, shows summary]
Claude: Ready to execute. Proceed?
User: go
Claude: [Executes: appmod plan execute "execute the plan" --no-tty]
```

**Execute a specific plan:**
```
User: /appmod-run-plan
User: run the dotnet8-upgrade plan
Claude: [Executes: appmod plan execute "execute the plan" --plan-name dotnet8-upgrade --no-tty]
```

**Execute with custom instructions and issue tracking:**
```
User: /appmod-run-plan
User: focus on the dependency updates first, track at https://github.com/myorg/myrepo/issues/15
Claude: [Executes: appmod plan execute "focus on the dependency updates first" --issue-url https://github.com/myorg/myrepo/issues/15 --no-tty]
```

**When no plan exists:**
```
User: /appmod-run-plan
Claude: I couldn't find a plan at `.appmod/plans/modernization-plan/plan.md`.
        Would you like to create one first with /appmod-create-plan?
```

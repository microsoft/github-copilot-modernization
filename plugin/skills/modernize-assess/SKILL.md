---
name: modernize-assess
description: "Run assessment and generate summary report for Java or .NET projects. USE FOR: assess project, analyze codebase, modernization assessment, identify migration issues, modernize assess, scan for upgrade problems, evaluate .NET project, evaluate Java project, find legacy dependencies, generate assessment report. DO NOT USE FOR: creating modernization plans (use modernize-create-plan), executing plans (use modernize-run-plan)."
---

# Modernize Assess

> ⛔ **MANDATORY**: Follow [global-rules](../_shared/global-rules.md) for all operations.

Run an assessment on your Java or .NET project to identify modernization opportunities and generate a summary report.

## Instructions

When the user invokes this command, follow these steps:

### 1. Parameter Collection

Present the user with a streamlined overview and offer to customize options. Use smart defaults to minimize back-and-forth.

**Optional Parameters:**

- `--source`: Path to source project (relative or absolute local path). Default: current directory (`.`)
- `--output-path`: Path to the folder for report output. Default: `modernize/.appcat`
- `--multi-repo`: Enable multi-repo assess. Scan first-level subdirectories for multiple repositories. Default: false
- `--issue-url`: GitHub issue URL to post the summary to (e.g., `https://github.com/owner/repo/issues/123`)
- `--verbose`: Enable verbose output for assessment. Default: false


**Example interaction:**
```
I'll help you assess your project.

I'll auto-detect the project type. The results will be saved to
`modernize/.appcat` by default.

Before I run the assessment, would you like to customize any of these options?
- Source path (default: current directory)
- Output path (default: modernize/.appcat)
- Post summary to a GitHub issue (provide URL)
- Enable multi-repo scanning
- Enable verbose output

Or I can proceed with defaults - just say "go" or "continue".
```

### 2. Validation

Before executing, validate:

- **`--issue-url`**: If provided, must be a valid GitHub issue URL matching pattern `https://github.com/<owner>/<repo>/issues/<number>`
- **`--source`**: If provided, verify the directory or file path exists

If validation fails, explain the issue clearly and ask the user to provide a corrected value.

### 3. Execution

Run the following command (always include `--no-tty` for plain text output):

```bash
modernize assess [--source <path>] [--output-path <path>] [--issue-url <url>] [--multi-repo] [--verbose] --no-tty
```

Only include optional parameters if they were explicitly set or differ from defaults.

### 4. Results

After execution:

1. Read and summarize the contents of `<output-path>/summary.md` (default: `modernize/.appcat/summary.md`)
2. Report any errors from the command output
3. If `--issue-url` was provided, confirm the comment was posted successfully
4. Highlight key findings and suggest next steps (e.g., running `/modernize-create-plan` to create a modernization plan)

## Error Handling

If the command fails:
1. Parse the error output to identify the root cause
2. Explain the error in user-friendly terms
3. Suggest corrective actions (e.g., "The project path doesn't exist. Please verify the path and try again.")
4. Offer to retry with modified parameters

## Examples

**Basic assessment with defaults:**
```
User: /modernize-assess
Claude: I'll run an assessment with default settings...
[Executes: modernize assess --no-tty]
```

**Assessment with GitHub issue posting:**
```
User: /modernize-assess
Claude: Would you like to customize any options?
User: post to https://github.com/myorg/myrepo/issues/42
Claude: [Executes: modernize assess --issue-url https://github.com/myorg/myrepo/issues/42 --no-tty]
```

**Assessment with custom output path and verbose:**
```
User: /modernize-assess
User: save to ./reports and enable verbose
Claude: [Executes: modernize assess --output-path ./reports --verbose --no-tty]
```

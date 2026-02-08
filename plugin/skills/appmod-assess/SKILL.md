---
name: appmod-assess
description: Run assessment and generate summary report for Java or .NET projects
allowed-tools: Bash(appmod:*)
---

# AppMod Assess

Run an assessment on your Java or .NET project to identify modernization opportunities and generate a summary report.

## Instructions

When the user invokes this command, follow these steps:

### 1. Parameter Collection

Present the user with a streamlined overview and offer to customize options. Use smart defaults to minimize back-and-forth.

**Optional Parameters:**

- `--projects`: Path(s) to projects to assess. For .NET: `.csproj`, `.sln`, or `.slnx` files. For Java: workspace root. Default: auto-detect from current directory.
- `--output-path`: Where to save assessment output. Default: `.appmod/.appcat`
- `--issue-url`: GitHub issue URL to post the summary to (e.g., `https://github.com/owner/repo/issues/123`)
- `--verbose`: Enable verbose output. Default: false

**Example interaction:**
```
I'll help you assess your project.

I'll auto-detect the project type. The results will be saved to
`.appmod/.appcat` by default.

Before I run the assessment, would you like to customize any of these options?
- Output path (default: .appmod/.appcat)
- Post summary to a GitHub issue (provide URL)
- Enable verbose output

Or I can proceed with defaults - just say "go" or "continue".
```

### 2. Validation

Before executing, validate:

- **`--issue-url`**: If provided, must be a valid GitHub issue URL matching pattern `https://github.com/<owner>/<repo>/issues/<number>`
- **`--projects`**: If provided for .NET, must be valid `.csproj`, `.sln`, or `.slnx` file paths that exist

If validation fails, explain the issue clearly and ask the user to provide a corrected value.

### 3. Execution

Run the following command (always include `--no-tty` for plain text output):

```bash
appmod assess [--projects <path>] [--output-path <path>] [--issue-url <url>] [--verbose] --no-tty
```

Build the command by including only the parameters that were explicitly set or differ from defaults.

### 4. Results

After execution:

1. Read and summarize the contents of `<output-path>/summary.md` (default: `.appmod/.appcat/summary.md`)
2. Report any errors from the command output
3. If `--issue-url` was provided, confirm the comment was posted successfully
4. Highlight key findings and suggest next steps (e.g., running `/appmod-create-plan` to create a modernization plan)

## Error Handling

If the command fails:
1. Parse the error output to identify the root cause
2. Explain the error in user-friendly terms
3. Suggest corrective actions (e.g., "The project path doesn't exist. Please verify the path and try again.")
4. Offer to retry with modified parameters

## Examples

**Basic assessment with defaults:**
```
User: /appmod-assess
Claude: I'll run an assessment with default settings...
[Executes: appmod assess --no-tty]
```

**Assessment with GitHub issue posting:**
```
User: /appmod-assess
Claude: Would you like to customize any options?
User: post to https://github.com/myorg/myrepo/issues/42
Claude: [Executes: appmod assess --issue-url https://github.com/myorg/myrepo/issues/42 --no-tty]
```

**Assessment with custom output path and verbose:**
```
User: /appmod-assess
User: save to ./reports and enable verbose
Claude: [Executes: appmod assess --output-path ./reports --verbose --no-tty]
```

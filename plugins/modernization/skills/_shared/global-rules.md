# Global Rules

> **MANDATORY** — These rules apply to ALL skills. Violations are unacceptable.

## Rule 0: Ensure the modernize CLI is Installed

⛔ **ALWAYS** verify the `modernize` CLI is available before running any `modernize` command.

Run the following check:

```bash
export PATH="$PATH:$HOME/.modernize/bin" && command -v modernize
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

After installation, ensure the binary is on PATH for subsequent commands:

```bash
export PATH="$PATH:$HOME/.modernize/bin"
```

If the installation fails, explain the error and link the user to https://github.com/microsoft/modernize-cli for manual installation instructions.

## Rule 1: Destructive Actions Require User Confirmation

⛔ **ALWAYS use `ask_user`** before ANY destructive action.

### What is Destructive?

| Category | Examples |
|----------|----------|
| **Delete** | Removing files, deleting project artifacts, clearing output directories |
| **Overwrite** | Replacing existing plans, overwriting assessment results, resetting configuration |
| **Irreversible** | Executing migrations that modify source code, applying breaking changes |

### How to Confirm

```
ask_user(
  question: "This will overwrite the existing modernization plan 'my-plan'. Continue?",
  choices: ["Yes, overwrite it", "No, cancel"]
)
```

### No Exceptions

- Do NOT assume user wants to overwrite existing plans or assessments
- Do NOT batch destructive actions without individual confirmation
- Do NOT proceed with code modifications without confirming the scope

## Rule 2: Always Include `--no-tty`

⛔ **ALWAYS** include `--no-tty` when running `modernize` commands to ensure plain text output suitable for AI processing.

## Rule 3: Validate Before Executing

⛔ **ALWAYS** validate parameters before running commands:
- Verify project paths exist
- Verify GitHub issue URLs match `https://github.com/<owner>/<repo>/issues/<number>`
- Verify language is `java` or `dotnet` if explicitly provided

---
name: list-plans
description: |
  Discovers valid migration plans in the workspace and returns the selected plan path.
  A valid plan is a subdirectory of .github/modernize/ that contains plan.md AND tasks.json (tasks.json may be in the plan folder or in a .metadata subfolder).
    Handles 0, 1, or multiple plans and returns structured NEEDS_INPUT when a choice is needed.
  Triggers: "list plans", "find plans", "select plan", "list-and-select-plan", "discover plans".
---

# List and Select Plan

## Step 1 — Discover valid plans

**You MUST run this in a terminal — do NOT use file tools (list_dir, file_search, grep_search) to discover plans.**

Detect the OS and run the matching script in the terminal. **Replace `<workspace-root>` with the absolute path to the workspace root before running.**

**Windows (PowerShell) — run in terminal:**
```powershell
Set-Location "<workspace-root>"
$modernizeDir = ".github/modernize"
$plans = @()

if (Test-Path $modernizeDir) {
    Get-ChildItem -Path $modernizeDir -Directory | ForEach-Object {
        $hasPlan  = Test-Path (Join-Path $_.FullName "plan.md")
        $hasTasks = (Test-Path (Join-Path $_.FullName "tasks.json")) -or (Test-Path (Join-Path $_.FullName ".metadata/tasks.json"))
        if ($hasPlan -and $hasTasks) {
            $plans += @{ folder = $_.Name; planPath = "$modernizeDir/$($_.Name)/plan.md" }
        }
    }
}

$plans | ConvertTo-Json -Depth 2
```

**macOS / Linux (bash) — run in terminal:**
```bash
cd "<workspace-root>"
modernize_dir=".github/modernize"
entries="[]"

if [ -d "$modernize_dir" ]; then
    for folder in "$modernize_dir"/*/; do
        [ -d "$folder" ] || continue
        name=$(basename "$folder")
        if [ -f "$folder/plan.md" ] && ([ -f "$folder/tasks.json" ] || [ -f "$folder/.metadata/tasks.json" ]); then
            entry="{\"folder\":\"$name\",\"planPath\":\"$modernize_dir/$name/plan.md\"}"
            if [ "$entries" = "[]" ]; then
                entries="[$entry]"
            else
                entries="${entries%]},$entry]"
            fi
        fi
    done
fi

echo "$entries"
```

Parse the JSON output from the terminal as the list of valid plans for the next step.

## Step 2 — Route based on count

### No plans found

Return `no-plans-found` to the caller. Do not prompt the user.

### Exactly 1 plan found

Return its path immediately — no user prompt needed:

```
.github/modernize/<folder>/plan.md
```

### Multiple plans found

1. For each plan, read `.github/modernize/<folder>/plan.md`, extract the first heading, strip the leading `# ` and any prefix of the form `<Word> Plan: ` (e.g. `Modernization Plan: `, `Migration Plan: `), and use the remainder as the title.
2. Do not invoke a question tool. Return exactly these two lines to `planning-coordinator`, with compact JSON on the second line and no surrounding prose or Markdown fence:

```text
NEEDS_INPUT
{"schemaVersion":1,"coordinator":"planning-coordinator","requestType":"plan-selection","questions":[{"header":"plan-selection","question":"Which plan would you like to execute?","allowFreeformInput":false,"options":[{"label":"<folder>","description":"<plan title>"}]}],"resumeContext":{"plans":[{"label":"<folder>","planPath":".github/modernize/<folder>/plan.md"}]}}
```

Include one option and one matching `resumeContext.plans` entry per discovered plan, preserving discovery order. The option label is the folder name and its description is the title from step 1. Never select the first plan by default.

## Step 3 — Return

After `planning-coordinator` receives the top-level structured answer, it resolves the selected label through `resumeContext.plans` and returns that path:

```
.github/modernize/<selected-folder>/plan.md
```

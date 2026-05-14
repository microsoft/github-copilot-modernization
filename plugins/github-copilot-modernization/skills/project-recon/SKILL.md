---
name: project-recon
description: |
  Zero-dependency shell recon for any code repository — detect languages, count LOC, and report project scale. Pure POSIX find/wc or PowerShell, no Python or third-party tools required.
  Triggers: "how big is this project", "what languages", "project sizing", "repo recon", "LOC count", "scope check".
---

# Project Recon: Zero-Dependency Repo Sizing

## What this skill does

Quickly answers: **how big is this repo and what's in it.** Shell-only (POSIX `find` + `wc` or PowerShell), runs anywhere, no install needed.

## Output Format

Emit exactly this JSON structure — no additional fields:

```json
{
  "total_loc": <int>,
  "languages": { "<lang>": <loc>, ... },
  "top_level_dirs": <int>,
  "primary_language": "<lang with highest LOC>"
}
```

- `total_loc`: sum of non-blank lines across all detected source files
- `languages`: per-language LOC breakdown (only languages actually found)
- `top_level_dirs`: count of immediate subdirectories under repo root (excluding hidden dirs)
- `primary_language`: the language key with the highest LOC

Do NOT add fields beyond this schema. No descriptions, no module lists, no domain analysis.

## Files

| File | Purpose |
|------|---------|
| `references/language-extensions.yaml` | Language → file extension mapping + generated-file suffixes to skip |
| `references/exclude-patterns.yaml` | Directory exclude rules (global + per-language) |
| `references/loc-shell.md` | bash + PowerShell counting templates |

## Workflow

1. **Detect languages.** Scan for manifest files (pom.xml, *.csproj, package.json, go.mod, etc.) or dominant extensions. Look up `language-extensions.yaml` for the canonical extension list.
2. **Resolve excludes.** Union `exclude-patterns.yaml::global.dirs` with `per_language.<lang>.dirs` for each detected language.
3. **Count.** Use the template from `references/loc-shell.md`. Run once per detected language, sum for total.
4. **Emit JSON.** Output the schema above. Nothing else.

## Semantics

- Counts non-blank lines (`wc -l`), comment-inclusive. This is intentional — speed and simplicity over precision.
- Expect 5–15% upward bias vs comment-stripping counters on verbose languages (Java, C#). Acceptable for sizing.

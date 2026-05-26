# appmod.git.snapshot

Create an initial commit before execution begins, capturing the pre-execution state of the project.

## Behavior

1. Check `project.git` in project-profile.yaml — if `false`, skip
2. Stage all current changes: `git add -A`
3. Commit: `git commit -m "pre-execution snapshot" --allow-empty`

## When

`before_all` only. This preserves the baseline so that execution commits show a clean diff of what each phase actually changed.

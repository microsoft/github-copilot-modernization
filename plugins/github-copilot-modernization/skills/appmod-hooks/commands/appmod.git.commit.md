# appmod.git.commit

Stage and commit all changes at the current point in the lifecycle.

## Behavior

1. Check if there are uncommitted changes: `git status --porcelain`
2. If no changes, skip silently (no empty commits)
3. Stage all changes: `git add -A`
4. Commit with a context-aware message based on the hook point:
   - `before_all`: `"pre-execution snapshot"`
   - `after_phase`: `"phase {phase_number}: {phase_label} completed"`
   - `after_all`: `"project complete"`
5. Capture the short SHA: `git rev-parse --short HEAD`
6. Return the SHA as `commit_sha` for downstream actions (e.g. `appmod.board.commit-pin`)

## Commit Message Format

```
phase {N}: {phase_label} completed
```

Examples:
- `phase 0: Plan & Constitution completed`
- `phase 1: Analysis & Inventory completed`
- `phase 3: Implementation completed`

## Skip Conditions

- `project.git` is `false` in project-profile.yaml → skip entirely
- No uncommitted changes → skip silently

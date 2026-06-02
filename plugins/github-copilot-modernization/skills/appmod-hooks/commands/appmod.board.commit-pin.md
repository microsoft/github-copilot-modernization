# appmod.board.commit-pin

Pin a commit SHA to the phase heading in board.md after a phase-level commit.

## Behavior

1. Requires `commit_sha` from a preceding `appmod.git.commit` action in the same hook point
2. If no commit was made (skipped due to no changes), skip this action
3. Append `📌 {commit_sha}` to the phase heading line in board.md

## Format

```markdown
## Phase 1: Implementation 📌 a1b2c3d
- ✅ t3 [backend] Migrate controllers (02:45Z→03:01Z, 16m)
- ✅ t4 [backend] Migrate services (03:01Z→03:16Z, 15m)
```

The pin is on the phase heading, not on individual task lines — commits are phase-level.

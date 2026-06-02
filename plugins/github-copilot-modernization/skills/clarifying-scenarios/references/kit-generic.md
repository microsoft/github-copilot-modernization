# Generic Clarification Kit — v1

Applied to **all** brownfield and greenfield tasks regardless of scope (frontend / backend / fullstack).

---

## Field Definitions

### success.definition
- **Importance**: required
- **Label**: Definition of "done" — what does success look like?
- **Accepted evidence**: user-facing outcome statement (e.g., "all existing user flows work identically in the new stack", "feature parity verified by QA sign-off", "zero regressions in smoke test suite")
- **Default if skipped**: `"feature parity with the current system; all existing user-facing behaviors preserved"`
- **Why it matters**: anchors the spec's Success Criteria section; without it the GatekeepAgent cannot validate that requirements are complete

---

### out_of_scope
- **Importance**: recommended
- **Label**: Explicit out-of-scope boundaries
- **Accepted evidence**: list of components, pages, services, or behaviors that must NOT be touched (e.g., "do not change the payment gateway integration", "legacy admin panel is out of scope", "mobile app is separate")
- **Default if skipped**: `"no explicit exclusions; agent will infer from project structure"`
- **Why it matters**: prevents scope creep and ensures the ImplementationAgent doesn't accidentally modify untouched modules; critical for safe brownfield work

---

### existing_tests.posture
- **Importance**: recommended
- **Label**: Existing test suite — must-pass policy
- **Accepted evidence**: explicit policy — one of:
  - `"must pass"` — all existing tests must pass after migration (zero regressions)
  - `"can rewrite"` — existing tests may be replaced with equivalent coverage in new framework
  - `"ignore"` — test suite is outdated/broken; new tests will be written from scratch
  - `"partial: <list>"` — specific test suites must pass (e.g., "E2E must pass, unit tests can be rewritten")
- **Default if skipped**: `"must pass"` (safe default; ImplementationAgent classifies failures as migration-caused vs pre-existing)
- **Why it matters**: determines the BUILD GATE criteria in Phase 5 and whether failing tests block batch completion

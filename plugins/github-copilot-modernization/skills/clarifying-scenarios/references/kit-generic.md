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

---

### target.output_location
- **Importance**: required — but **only when `assessment.change_type` is `rewrite` or `extract`**; omit the field entirely for `upgrade` (in-place is inherent). Same conditional-inclusion mechanism as `visual.screenshots`.
- **Label**: Rewrite output location — where should the rewritten code go?
- **Accepted evidence**: explicit output directory in the prompt (e.g., "Output all generated code into a new top-level folder named `petclinic-new`"), `"in-place"`, or an explicit relative/absolute target path
- **Default if skipped**: `"new sibling directory: <project-name>-new"`
- **Why it matters**: decides the scaffold target directory and the working directory for all build/test/validation commands, and guarantees the original source tree stays untouched during a rewrite. Collected here so the coordinator never has to interrupt the run with a separate interactive question.
- **Question generation note**: render as `single_select` with concrete option values — `<project-name>-new` sibling directory (pre-select), `in-place` — plus the automatic free-text row for a custom path.

---

### constraints.additional
- **Importance**: optional — but the question itself is **always included** in the question set (fixed G5), regardless of scope or evidence.
- **Label**: Additional Constraints — requirements, exclusions, dependencies, compliance rules, or operational constraints not covered above
- **Accepted evidence**: none — this field is never scored and never counts toward the clarity gate; it exists purely to catch constraints the catalog has no field for.
- **Default if skipped**: `"None beyond the decisions listed in this specification."`
- **Why it matters**: gives the user one guaranteed free-text outlet for compliance rules, hard dependencies, or exclusions that would otherwise surface late as blocking review feedback.
- **Question generation note**: render as `text`, prefilled with the default so the user can accept it unchanged or overwrite it with their own constraints.

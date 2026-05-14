# Gate: completeness — Final Validation

**Load**: constitution, feature spec, plan.md, implementation files, all 3 checkpoints (spec-to-plan.yaml, plan-to-tasks.yaml, tasks-to-impl.yaml)

## Checklist

- [ ] All plan items have corresponding implementation files → *CRITICAL if missing*
- [ ] Build succeeds, tests pass → *CRITICAL if failure*
- [ ] Constitution followed in implementation → *CRITICAL if violated*
- [ ] All P1 requirements fulfilled → *CRITICAL if unmet*
- [ ] Every implementation task artifact includes `## Test Results` with pass/fail/skip counts and test command → *CRITICAL if missing or failed > 0*
- [ ] Testing strategy executed as planned: primary validation stack used; fallback only with documented blocker evidence → *CRITICAL if primary stack skipped without documented failure evidence (exact command + exact error output + explanation why it cannot be resolved). "H2 already worked" or "setup was complex" are not valid blockers. Partial strategy execution (e.g., integration but no E2E when E2E was planned) is also CRITICAL unless a documented, reproducible technical blocker prevented execution.*
- [ ] Functional equivalence verified *(brownfield only: migration and rewrite)* → *CRITICAL if unverified*

## Constitution Hardstop Rule

**Constitution violations are always CRITICAL.** Any MUST NOT rule violated in code automatically fails this gate. Cannot be downgraded to non-blocking regardless of prior review outcomes.

## Process

1. Load all 3 checkpoints and verify each has `validation.passed == true`:
   - `checkpoints/spec-to-plan.yaml`
   - `checkpoints/plan-to-tasks.yaml`
   - `checkpoints/tasks-to-impl.yaml`
2. Check plan.md Requirement Mapping table Implementation Evidence column
3. Verify all referenced implementation files exist
4. Run build and tests
5. Verify constitution compliance in code
6. Confirm P1 requirements are implemented
7. For brownfield (migration and rewrite): verify functional equivalence per `references/functional-equivalence.md`
8. Verify testing strategy conformance:
   - Compare planned validation stack (from plan.md testing strategy) against actual test evidence
   - If primary stack was specified (e.g. Playwright, Testcontainers), confirm it was **actually attempted** (look for dependency in pom.xml/package.json, test files using those tools, or documented installation attempt with error)
   - Confirm ALL tiers of the primary stack were attempted, not just some (e.g., both Testcontainers AND Playwright if both were specified)
   - Fallback stack is acceptable ONLY with documented evidence of primary stack failure: the exact command that was run, the exact error message, and why the error cannot be resolved in the current environment
   - "Already works with H2", "setup seemed complex", or absence of any attempt is NOT a valid blocker — rate as **CRITICAL**
   - Check acceptance criteria AND-conditions (e.g. "integration test AND E2E test") — partial satisfaction without documented blocker is **CRITICAL**
   - Verify all planned test evidence artifacts exist (e.g. Surefire XML, Playwright HTML report)
9. Write `checkpoints/traceability-matrix.yaml`:
   ```yaml
   traceability:
     - requirement: "REQ-XXX"
       plan_items: ["X.Y"]
       tasks: ["T001", "T002"]
       files: ["path/to/file-a"]
       status: "complete"  # complete | broken | partial
   ```
10. Write `migration-summary.md` with checkpoint validation, traceability matrix, constitution compliance, testing strategy conformance, findings, and verdict

## Verdict

**PASS**: All implementation evidence present, build passes, constitution followed, P1 requirements met, testing strategy executed as planned

→ Append `✓ Completeness check PASSED.` to migration-summary.md

**FAIL**: Missing implementation, build failure, constitution violation, unmet P1 requirement, or testing strategy deviation without documented blocker

→ Append `✗ Completeness check FAILED. N critical issues require resolution.` to migration-summary.md

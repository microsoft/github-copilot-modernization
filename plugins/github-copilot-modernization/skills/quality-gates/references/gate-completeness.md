# Gate: completeness — Final Validation

**Load**: constitution, feature spec, plan.md, implementation files, all 3 checkpoints (spec-to-plan.yaml, plan-to-tasks.yaml, tasks-to-impl.yaml)

> **Lite-path note (`deep_planning: false`):** small projects run without a planning phase, so `plan.md`, the feature spec, and the `spec-to-plan` / `plan-to-tasks` checkpoints are legitimately never produced. When they are absent because the lite path skipped `implementation-plan`, treat them as **N/A — not missing/CRITICAL**, and validate against the task list and implementation evidence instead. This note applies throughout the Checklist and Process below.

## Build Verdict (blocking — evaluate FIRST)

Judge build status ONLY from the `## Smoke Test Verdict` block in the smoke-test artifact.
A worker's prose ("build passed") or self-applied label is NOT evidence. Read `build_command`, `install_command`, and the returncodes directly.

1. If the `## Smoke Test Verdict` block is missing, or `build_command`/`returncode` is absent → CRITICAL.
2. If `returncode` != 0 → CRITICAL.
3. The build counts ONLY if it is the project's full build, unmodified: run from the repo root, covering every module (`covers_all_modules: yes`), and — for a JS/TS project — preceded by a frozen install (`npm ci` / `yarn install --immutable` (classic `--frozen-lockfile`) / `pnpm install --frozen-lockfile`) with `install_returncode == 0`. → CRITICAL if, for a JS/TS project, `install_command`/`install_returncode` is missing, the install is non-frozen or scoped to one package, or `install_returncode` != 0; or if `build_command` narrows scope, skips a module, or downgrades the build. Judge by this rule, not by matching a fixed token list; e.g. maven `-pl`/`-am`, `--filter`/`-w`/`cd <subdir> && build` (single package), `--no-frozen-lockfile`, and `--mode=skip-build` all fail it. (`install_*` may be `n/a` only for non-JS/TS.)
4. PASS the build check only when all returncodes are 0 AND `build_command` is the project's root-level full build AND `covers_all_modules: yes`. Otherwise CRITICAL → create a remediation task to re-run smoke-test with the full build; do NOT advance dependents.

## Checklist

- [ ] All plan items have corresponding implementation files → *CRITICAL if missing (lite path with no plan.md: verify implementation evidence against the task list / `tasks-to-impl.yaml` instead)*
- [ ] Build succeeds, tests pass — build half: see **Build Verdict** section above; tests half: verify test results in implementation artifacts → *CRITICAL if failure*
- [ ] Constitution followed in implementation → *CRITICAL if violated*
- [ ] All P1 requirements fulfilled → *CRITICAL if unmet*
- [ ] Every implementation task artifact includes `## Test Results` with pass/fail/skip counts and test command → *CRITICAL if missing or failed > 0*
- [ ] Testing strategy executed as planned: primary validation stack used; fallback only with documented blocker evidence → *CRITICAL if primary stack skipped without documented failure evidence (exact command + exact error output + explanation why it cannot be resolved). "H2 already worked" or "setup was complex" are not valid blockers. Partial strategy execution (e.g., integration but no E2E when E2E was planned) is also CRITICAL unless a documented, reproducible technical blocker prevented execution.*
- [ ] Consistency verified *(brownfield; change-type-aware)* → *CRITICAL if unverified*: migration / rewrite → functional equivalence (`references/functional-equivalence.md`); upgrade → upgrade-consistency, i.e. no residual old version/API, no mixed old/new across modules (`references/upgrade-consistency.md`)

## Constitution Hardstop Rule

**Constitution violations are always CRITICAL.** Any MUST NOT rule violated in code automatically fails this gate. Cannot be downgraded to non-blocking regardless of prior review outcomes.

## Process

1. Load all 3 checkpoints and verify each has `validation.passed == true`:
   - `checkpoints/spec-to-plan.yaml`
   - `checkpoints/plan-to-tasks.yaml`
   - `checkpoints/tasks-to-impl.yaml`

   **Lite-path tolerance (`deep_planning: false`):** when `implementation-plan` was not selected, `spec-to-plan.yaml` and `plan-to-tasks.yaml` are never written — treat them as **N/A, not CRITICAL**, and verify only `tasks-to-impl.yaml` (or equivalent implementation evidence). Do NOT fail the gate for plan-phase checkpoints that the lite path legitimately never creates.
2. Check plan.md Requirement Mapping table Implementation Evidence column
3. Verify all referenced implementation files exist
4. Evaluate build per the **Build Verdict** section (blocking — must be done before advancing); verify tests per implementation task artifacts
5. Verify constitution compliance in code
6. Confirm P1 requirements are implemented
7. Verify the change-type-appropriate consistency check (brownfield):
   - migration / rewrite → functional equivalence per `references/functional-equivalence.md`
   - upgrade → upgrade-consistency per `references/upgrade-consistency.md` (target version reached everywhere, no residual old API, no mixed old/new versions, deprecated symbols replaced)
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

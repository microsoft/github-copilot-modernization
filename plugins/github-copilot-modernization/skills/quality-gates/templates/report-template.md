# Migration Summary Report Template

Write to `FEATURE_DIR/migration-summary.md`:

```markdown
# Migration Summary Report

### Checkpoint Validation Summary

| Checkpoint | Status | Coverage | Errors | Warnings |
|------------|--------|----------|--------|----------|
| spec-to-plan.yaml | ✓/✗ | XX% | N | N |
| plan-to-tasks.yaml | ✓/✗ | XX% | N | N |
| tasks-to-impl.yaml | ✓/✗ | XX% | N | N |

### End-to-End Traceability Matrix

| Requirement | Plan Items | Tasks | Impl Files | Status |
|-------------|------------|-------|------------|--------|
| REQ-XXX | X.Y | T001-T003 | file-a, file-b | ✓ |
| REQ-YYY | X.Z | T004 | - | ❌ BROKEN |

### Constitution Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| [Principle 1 Name] | ✓ Followed | |
| [Principle 2 Name] | ✗ Violated | [specific violation] |

### Findings

| ID | Category | Severity | Location | Summary | Recommendation |
|----|----------|----------|----------|---------|----------------|
| C1 | Gap | CRITICAL | REQ-002 | No implementation files | Implement in next batch |

### Metrics Summary

- Total Requirements: N / Fully Implemented: M (X%)
- Total Plan Items: N / Realized: M (X%)
- Total Tasks: N / Completed: M (X%)
- End-to-End Coverage: X%
- Constitution Violations: N
- Critical Issues: N
```

## Verdict

**PASS** (all conditions):
- All checkpoints 100%, all tasks completed with code changes, no traceability breaks, no constitution violations, all requirements fulfilled
- Append: "✓ Completeness check PASSED. Feature is ready for final review."

**FAIL** (any condition unmet):
- List CRITICAL issues with remediation steps, recommend batch to re-run, provide task IDs
- Append: "✗ Completeness check FAILED. N critical issues require resolution."

## Severity Definitions

- **CRITICAL**: Checkpoint failed, broken traceability, constitution MUST violation, requirement not implemented
- **HIGH**: Partial requirement, implementation drift, untested acceptance criteria
- **MEDIUM**: Incomplete non-functional coverage, terminology drift
- **LOW**: Style/naming, documentation gaps

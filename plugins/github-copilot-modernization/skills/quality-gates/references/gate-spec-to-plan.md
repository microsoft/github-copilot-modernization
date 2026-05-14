# Gate: spec-to-plan — Checklist

**Load**: spec.md, plan.md

## Checklist

- [ ] Every REQ-XXX covered by ≥1 plan item → *CRITICAL if any missed*
- [ ] Coverage = 100% → *CRITICAL if < 100%*
- [ ] Requirement Mapping table present and complete → *CRITICAL if missing*
- [ ] Testing strategy includes test infrastructure design (external dependency strategy, test base classes, per-module test skeletons, test execution rule) → *HIGH if missing*

## Process

1. Extract REQ-XXX IDs from spec.md
2. Check plan.md Requirement Mapping table for coverage
3. Cross-reference each REQ-XXX against mapped plan items

## Validation Points

- **REQ Coverage**: All REQ-XXX from spec.md appear in Requirement Mapping table
- **Plan Item Mapping**: Each REQ maps to specific plan items (Phase-X, item X.Y format)
- **Completeness**: No orphaned requirements or unmapped plan items

## Output

Update `checkpoints/spec-to-plan.yaml` with validation results:
```yaml
validation:
  passed: true/false
  total_requirements: N
  covered_requirements: N
  coverage_percentage: N%
  missing_requirements: []
```

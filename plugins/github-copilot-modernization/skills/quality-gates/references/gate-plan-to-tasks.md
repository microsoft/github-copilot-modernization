# Gate: plan-to-tasks — Checklist

**Load**: plan.md

## Checklist

### Plan Item Coverage
- [ ] Every plan item (Phase-X, item X.Y) has ≥1 corresponding inline task → *CRITICAL if missed*
- [ ] Plan coverage = 100% → *CRITICAL if < 100%*
- [ ] Each task references its source plan item via `[Plan:X.Y]` → *CRITICAL if missing*

### Task Quality
- [ ] Task IDs are sequential (T001, T002...) with no duplicates → *MEDIUM if violated*
- [ ] Rewrite mode: code conversion tasks include `[Source:]` annotation → *CRITICAL if missing*

### Upstream Traceability
- [ ] Requirement Mapping table shows REQ → Plan → Task chain → *HIGH if missing*

## Process

1. Extract all plan items from plan.md phases
2. Find inline tasks with `- [ ] T###` format for each plan item
3. Verify `[Plan:X.Y]` references match plan item structure
4. Check rewrite-mode source annotations if applicable
5. Cross-check upstream traceability via Requirement Mapping table

## Validation Points

- **Plan Item Coverage**: All Phase-X items have corresponding inline tasks
- **Task References**: Tasks properly reference source plan items
- **Traceability**: Clear REQ → Plan → Task mapping via Requirement Mapping table

## Output

Update `checkpoints/plan-to-tasks.yaml` with validation results:
```yaml
validation:
  passed: true/false
  plan_items_total: N
  plan_items_covered: N
  coverage_percentage: N%
  errors: []
```

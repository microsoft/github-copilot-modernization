---
name: Functional Equivalence Verification
description: Verify that migrated or rewritten business logic produces the same results as the original.
mode: brownfield
---

## Overview

This skill ensures that the rewritten application produces **functionally equivalent** results to the source application. It's the critical validation step that confirms no business logic was lost or incorrectly implemented during rewrite.

## User Input

```text
```

You **MUST** consider the user input before proceeding (if not empty).

## When to Use

- **Mode**: BROWNFIELD (migration and rewrite)
- **Phase**: Completeness Check — invoked by completeness skill
- **Prerequisites**: Implementation complete, `business-logic-inventory.md` available

## Equivalence Definition

**Functional Equivalence** means:
- Same inputs → Same outputs (within acceptable tolerance)
- Same business rules applied
- Same error conditions handled
- Same side effects produced (database writes, notifications, etc.)

**NOT required for equivalence**:
- Same code structure
- Same performance characteristics (though should be comparable)
- Same internal state representation
- Same logging output

## Verification Strategies

### Strategy 1: Test Case Comparison

Extract test cases from source and verify same behavior in target.

```yaml
test_comparison:
  source:
    test_class: "com.example.service.OrderServiceTest"
    test_method: "testCalculateTotalWithDiscount"
    input: { items: [...], discountCode: "SAVE20" }
    expected_output: { total: 85.00, discount: 15.00 }
  
  target:
    test_class: "com.example.service.OrderServiceTest"
    test_method: "testCalculateTotalWithDiscount"
    input: { items: [...], discountCode: "SAVE20" }
    actual_output: { total: 85.00, discount: 15.00 }
  
  result: "PASS"
```

### Strategy 2: Golden Dataset Testing

Use real data samples to compare outputs.

```yaml
golden_dataset:
  name: "orders_sample_2025"
  source: "test-data/orders_sample.json"
  count: 1000
  
  execution:
    source_system:
      endpoint: "http://legacy:8080/api/orders/calculate"
      results_file: "source_results.json"
    
    target_system:
      endpoint: "http://localhost:8080/api/orders/calculate"
      results_file: "target_results.json"
  
  comparison:
    total_records: 1000
    matching: 998
    differing: 2
    match_rate: 99.8%
    
  differences:
    - record_id: "ORD-12345"
      field: "taxAmount"
      source_value: 8.499999
      target_value: 8.50
      analysis: "Rounding difference - acceptable"
    
    - record_id: "ORD-67890"
      field: "discountApplied"
      source_value: true
      target_value: false
      analysis: "BUG - discount logic not applied correctly"
```

### Strategy 3: Property-Based Testing

Define invariants that must hold in both systems.

```java
// Example using property-based testing
@Property
void orderTotalShouldEqualSumOfLineItems(@ForAll List<@Valid OrderItem> items) {
    BigDecimal expected = items.stream()
        .map(item -> item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())))
        .reduce(BigDecimal.ZERO, BigDecimal::add);
    
    Order order = new Order(items);
    BigDecimal actual = orderService.calculateSubtotal(order);
    
    assertThat(actual).isEqualByComparingTo(expected);
}
```

### Strategy 4: Parallel Running

Run both systems in parallel and compare responses.

```
┌──────────────────────────────────────────────────────────┐
│                    REQUEST                                │
└────────────────────────┬─────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
┌─────────────────┐             ┌─────────────────┐
│  SOURCE SYSTEM  │             │  TARGET SYSTEM  │
│   (Legacy)      │             │   (New)         │
└────────┬────────┘             └────────┬────────┘
         │                               │
         ▼                               ▼
┌─────────────────┐             ┌─────────────────┐
│ SOURCE RESPONSE │             │ TARGET RESPONSE │
└────────┬────────┘             └────────┬────────┘
         │                               │
         └───────────────┬───────────────┘
                         ▼
              ┌─────────────────┐
              │   COMPARATOR    │
              │ - Diff fields   │
              │ - Log mismatch  │
              │ - Alert on >1%  │
              └─────────────────┘
```

## Verification Checklist

Create `FEATURE_DIR/verification-checklist.yaml`:

```yaml
verification_checklist:
  metadata:
    generated: "2026-02-01"
    source_inventory: "business-logic-inventory.md"
    total_units: 56
  
  summary:
    verified: 52
    differs_intentionally: 3
    pending: 1
    failed: 0
    coverage: 98.2%
  
  units:
    - id: "BL-001"
      name: "Order Total Calculation"
      status: "verified"
      verification_method: "golden_dataset"
      test_count: 1000
      match_rate: 100%
      notes: ""
    
    - id: "BL-002"
      name: "Tax Calculation"
      status: "differs_intentionally"
      verification_method: "test_comparison"
      differences:
        - field: "rounding"
          source: "HALF_UP"
          target: "HALF_EVEN"
          reason: "Compliance with banking standards"
          approved_by: "Product Owner"
          approved_date: "2026-01-15"
    
    - id: "BL-003"
      name: "User Authentication"
      status: "pending"
      reason: "External OAuth provider needed"
      estimated_completion: "2026-02-15"
    
    # Continue for all units...

  gates:
    all_units_verified:
      required: true
      status: "PASS"
    
    no_unresolved_failures:
      required: true
      status: "PASS"
    
    intentional_differences_approved:
      required: true
      status: "PASS"
```

## Handling Differences

### Acceptable Differences

Document and approve these differences:

| Type | Example | Handling |
|------|---------|----------|
| Precision | Float rounding | Document tolerance |
| Format | Date format change | Document mapping |
| Intentional | Improved validation | Get approval |
| Deprecated | Removed feature | Document removal |

### Unacceptable Differences

These require fixing:

| Type | Example | Action |
|------|---------|--------|
| Logic error | Wrong calculation | Fix implementation |
| Missing feature | Function not ported | Implement missing |
| Data loss | Field not mapped | Add mapping |

## Verification Report

Generate `FEATURE_DIR/verification-report.md`:

```markdown
# Functional Equivalence Verification Report

**Project**: [PROJECT_NAME]
**Date**: [DATE]
**Verified By**: [NAME]

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Business Logic Units | 56 |
| Verified Equivalent | 52 (92.9%) |
| Intentionally Different | 3 (5.4%) |
| Pending | 1 (1.8%) |
| **Overall Status** | ✅ PASS |

## Verification Details

### By Category

| Category | Total | Verified | Different | Pending |
|----------|-------|----------|-----------|---------|
| Calculation | 12 | 11 | 1 | 0 |
| Validation | 15 | 15 | 0 | 0 |
| Workflow | 8 | 7 | 1 | 0 |
| ...

### Intentional Differences

| Unit | Difference | Reason | Approved |
|------|------------|--------|----------|
| BL-002 | Rounding method | Bank compliance | ✅ Product Owner |
| BL-015 | Error message format | UX improvement | ✅ UX Team |
| BL-042 | Deprecated feature removed | EOL | ✅ Stakeholder |

### Pending Items

| Unit | Reason | ETA |
|------|--------|-----|
| BL-003 | External dependency | 2026-02-15 |

## Test Evidence

- Golden Dataset Results: `test-results/golden-dataset-comparison.json`
- Unit Test Results: `test-results/unit-tests.xml`
- Property Test Results: `test-results/property-tests.xml`

## Sign-off

- [ ] All critical business logic verified
- [ ] Intentional differences approved
- [ ] Test evidence archived
- [ ] Stakeholder sign-off obtained
```

## Integration with Workflow

1. **During Implementation**: Run verification continuously per unit
2. **Before Test Execution**: Verify all units in inventory are covered
3. **Post-Migration Validation**: Generate final verification report
4. **Sign-off**: Require stakeholder approval for intentional differences

## Key Rules

- **100% Coverage**: Every business logic unit must be verified
- **No Silent Differences**: All differences must be documented and approved
- **Evidence Required**: Keep test results and comparison data
- **Stakeholder Sign-off**: Intentional differences need business approval

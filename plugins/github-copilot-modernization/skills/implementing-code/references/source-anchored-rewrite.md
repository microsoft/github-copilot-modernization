# Source-Anchored Implementation (REWRITE Mode)

**MANDATORY** for every task with a `[Source:]` annotation. Follow this process **before writing any target code**.

## Process

1. **Read source file(s)**: Use `read_file` to read each file referenced in `[Source: path#methods]`

2. **Extract behavioral specification**: From the source code, identify and document:
   - All conditional branches (if/else, switch/case, ternary) and what each branch does
   - All validation checks and their error responses
   - All data transformations and their exact formulas/logic
   - All side effects (database writes, notifications, audit logs, state mutations)
   - All exception handling paths (catch blocks, error returns)
   - All cross-service calls and how their results are used

3. **Cross-reference with BL unit**: If the task has a `[BL: BL-XXX]` reference, read the corresponding entry in `business-logic-inventory.md` and verify the extracted behavior matches the documented business rules. If discrepancies exist, the **source code is the source of truth**.

4. **Implement with branch parity**: Write the target code ensuring every behavioral branch from the source is preserved:
   - Each source conditional → corresponding target conditional
   - Each source validation → corresponding target validation (using target framework idioms)
   - Each source error path → corresponding target error handling
   - Each source side effect → corresponding target side effect

5. **Record source reference in batch report**: For each completed task, record `source_reference` with the source file, methods read, and `branches_preserved` count.

## Why This Matters

Without reading the source code, the LLM implements from the task *description*, which is an abstraction that loses conditional branches, edge cases, and error handling details. Source-anchored implementation ensures behavioral fidelity.

## Example

Task says "Convert ProductAction.add() → ProductController.addProduct()".

**Without source anchoring**: The LLM writes a generic add endpoint.

**With source anchoring**: It reads ProductAction.java#add and discovers:
1. Inventory check before adding
2. Duplicate name validation
3. Category existence validation
4. Audit log entry
5. Specific error messages for each failure path

All 5 behaviors are then preserved in the target code.

---
name: cwe-code-quality
description: Assess codebase for CWE code quality vulnerabilities (CWE-130, CWE-456, CWE-457, CWE-477, CWE-570, CWE-571, CWE-606, CWE-665, CWE-681, CWE-682, CWE-772, CWE-775, CWE-783, CWE-789, CWE-835, CWE-1057)
user-invocable: false
---

# CWE Security Assessment: Code Quality

## Role

You are an expert **code security reviewer** specializing in CWE vulnerability detection.

> **Important:** You are an auditor, NOT an implementation developer. Your sole responsibility is to identify whether the target vulnerabilities exist in the codebase. Do NOT suggest fixes or improvements.

## Objective

Analyze the application codebase for each of the 16 CWE rules listed below. For each rule, determine whether the vulnerability pattern exists in the codebase.

## CWE Rules to Assess

### CWE-130: Improper Handling of Length Parameter Inconsistency
- **Severity:** potential | **Story Points:** 3
- **Description:** The product parses a formatted message or structure, but it does not handle or incorrectly handles a length field that is inconsistent with the actual length of the associated data.

### CWE-456: Missing Initialization of a Variable
- **Severity:** potential | **Story Points:** 2
- **Description:** The product does not initialize critical variables, which causes the execution environment to use unexpected values.

### CWE-457: Use of Uninitialized Variable
- **Severity:** potential | **Story Points:** 2
- **Description:** The code uses a variable that has not been initialized, leading to unpredictable or unintended results.

### CWE-477: Use of Obsolete Function
- **Severity:** optional | **Story Points:** 1
- **Description:** The code uses deprecated or obsolete functions, which suggests that the code has not been actively reviewed or maintained.

### CWE-570: Expression is Always False
- **Severity:** optional | **Story Points:** 1
- **Description:** The product contains an expression that will always evaluate to false.

### CWE-571: Expression is Always True
- **Severity:** optional | **Story Points:** 1
- **Description:** The product contains an expression that will always evaluate to true.

### CWE-606: Unchecked Input for Loop Condition
- **Severity:** potential | **Story Points:** 3
- **Description:** The product does not properly check inputs that are used for loop conditions, potentially leading to a denial of service or other consequences because of excessive looping.

### CWE-665: Improper Initialization
- **Severity:** potential | **Story Points:** 3
- **Description:** The product does not initialize or incorrectly initializes a resource, which might leave the resource in an unexpected state when it is accessed or used.

### CWE-681: Incorrect Conversion between Numeric Types
- **Severity:** potential | **Story Points:** 3
- **Description:** When converting from one data type to another, such as long to integer, data can be omitted or translated in a way that produces unexpected values. If the resulting values are used in a sensitive context, then dangerous behaviors may occur.

### CWE-682: Incorrect Calculation
- **Severity:** potential | **Story Points:** 5
- **Description:** The product performs a calculation that generates incorrect or unintended results that are later used in security-critical decisions or resource management.

### CWE-772: Missing Release of Resource after Effective Lifetime
- **Severity:** potential | **Story Points:** 3
- **Description:** The product does not release a resource after its effective lifetime has ended, i.e., after the resource is no longer needed.

### CWE-775: Missing Release of File Descriptor or Handle after Effective Lifetime
- **Severity:** potential | **Story Points:** 3
- **Description:** The product does not release a file descriptor or handle after its effective lifetime has ended, i.e., after the file descriptor/handle is no longer needed.

### CWE-783: Operator Precedence Logic Error
- **Severity:** optional | **Story Points:** 1
- **Description:** The product uses an expression in which operator precedence causes incorrect logic to be used.

### CWE-789: Memory Allocation with Excessive Size Value
- **Severity:** potential | **Story Points:** 5
- **Description:** The product allocates memory based on an untrusted, large size value, but it does not ensure that the size is within expected limits, allowing arbitrary amounts of memory to be allocated.

### CWE-835: Loop with Unreachable Exit Condition ('Infinite Loop')
- **Severity:** potential | **Story Points:** 3
- **Description:** The product contains an iteration or loop with an exit condition that cannot be reached, i.e., an infinite loop.

### CWE-1057: Data Access Operations Outside of Expected Data Manager Component
- **Severity:** potential | **Story Points:** 5
- **Description:** The product uses a dedicated, central data manager component as required by design, but it contains code that performs data-access operations that do not use this data manager.

## Instructions

1. **Iterate through each CWE rule** listed above
2. **Systematically scan** the application source code for patterns matching each rule
3. **For each rule:** Stop scanning as soon as you find the FIRST confirmed match
4. **Continue to the next rule** after finding a match or exhausting the search
5. **Report findings** for ALL rules (both FOUND and NOT_FOUND)

### Search Strategy

- Start with common vulnerability patterns: user input handling, external data processing, resource management
- Check configuration files, API endpoints, data access layers, and utility classes
- Consider both direct patterns and indirect/transitive vulnerability paths
- Focus on source files (e.g., `.java`, `.py`, `.cs`, `.js`, `.ts`) — skip test files and generated code

## Output Format

Return the following complete JSON structure to the parent assessment. The parent writes it to the current run incoming directory and invokes the Node `record-result` contract:

```json
{
  "input_name": "CWE - Code Quality",
  "analysis_method": "LLM",
  "status": "success",
  "result": {
    "finding": "Assessed 16 CWE rules in Code Quality: X FOUND, Y NOT_FOUND",
    "confidence": "high",
    "evidence": ["Scanned application source files for code quality patterns"],
    "values": [
      {
        "id": "<CWE-XXX>",
        "name": "<Rule Name>",
        "status": "FOUND",
        "category": "Code Quality",
        "severity": "<mandatory|optional|potential — copy from the rule definition above>",
        "storyPoint": "<N — copy from the rule definition above>",
        "description": "<copy the Description from the rule definition above>",
        "evidence": {
          "files": ["src/path/to/File.java"],
          "explanation": "Description of the vulnerability found, including class/method and line reference"
        }
      },
      {
        "id": "<CWE-YYY>",
        "name": "<Rule Name>",
        "status": "NOT_FOUND",
        "category": "Code Quality",
        "severity": "<mandatory|optional|potential — copy from the rule definition above>",
        "storyPoint": "<N — copy from the rule definition above>",
        "description": "<copy the Description from the rule definition above>",
        "evidence": {
          "files": [],
          "explanation": ""
        }
      }
    ]
  },
  "execution_time_seconds": 0,
  "timestamp": ""
}
```

### Evidence Rules

- **FOUND**: `files` must contain workspace-relative file paths. `explanation` must describe the vulnerability with class, method, and/or line references.
- **NOT_FOUND**: `files` must be an empty array `[]`. `explanation` must be an empty string `""`.
- **Every rule** listed above MUST have exactly one entry in `values` — do NOT skip any rule.
- **For every entry** (both FOUND and NOT_FOUND), copy the `severity`, `storyPoint`, and `description` values exactly as documented in the corresponding rule definition in the "CWE Rules to Assess" section above.
- Set top-level `status` to `"not_applicable"` ONLY if the entire category is irrelevant to the project's language/technology stack.
- Update the `finding` summary with actual counts of FOUND and NOT_FOUND rules.

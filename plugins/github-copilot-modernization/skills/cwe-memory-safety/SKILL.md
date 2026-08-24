---
name: cwe-memory-safety
description: Assess codebase for CWE memory safety vulnerabilities (CWE-119, CWE-120, CWE-123, CWE-125, CWE-415, CWE-416, CWE-672, CWE-786, CWE-787, CWE-788, CWE-805, CWE-822, CWE-823, CWE-824, CWE-825)
user-invocable: false
---

# CWE Security Assessment: Memory Safety

## Role

You are an expert **code security reviewer** specializing in CWE vulnerability detection.

> **Important:** You are an auditor, NOT an implementation developer. Your sole responsibility is to identify whether the target vulnerabilities exist in the codebase. Do NOT suggest fixes or improvements.

## Objective

Analyze the application codebase for each of the 15 CWE rules listed below. For each rule, determine whether the vulnerability pattern exists in the codebase.

## CWE Rules to Assess

### CWE-119: Improper Restriction of Operations within the Bounds of a Memory Buffer
- **Severity:** mandatory | **Story Points:** 21
- **Description:** The product performs operations on a memory buffer, but it reads from or writes to a memory location outside the buffer's intended boundary. This may result in read or write operations on unexpected memory locations that could be linked to other variables, data structures, or internal program data.

### CWE-120: Buffer Copy without Checking Size of Input ('Classic Buffer Overflow')
- **Severity:** mandatory | **Story Points:** 13
- **Description:** The product copies an input buffer to an output buffer without verifying that the size of the input buffer is less than the size of the output buffer.

### CWE-123: Write-what-where Condition
- **Severity:** mandatory | **Story Points:** 13
- **Description:** Any condition where the attacker has the ability to write an arbitrary value to an arbitrary location, often as the result of a buffer overflow.

### CWE-125: Out-of-bounds Read
- **Severity:** optional | **Story Points:** 8
- **Description:** The product reads data past the end, or before the beginning, of the intended buffer.

### CWE-415: Double Free
- **Severity:** optional | **Story Points:** 8
- **Description:** The product calls free() twice on the same memory address.

### CWE-416: Use After Free
- **Severity:** mandatory | **Story Points:** 13
- **Description:** The product reuses or references memory after it has been freed. At some point afterward, the memory may be allocated again and saved in another pointer, while the original pointer references a location somewhere within the new allocation. Any operations using the original pointer are no longer valid because the memory belongs to the code that operates on the new pointer.

### CWE-672: Operation on a Resource after Expiration or Release
- **Severity:** potential | **Story Points:** 5
- **Description:** The product uses, accesses, or otherwise operates on a resource after that resource has been expired, released, or revoked.

### CWE-786: Access of Memory Location Before Start of Buffer
- **Severity:** optional | **Story Points:** 8
- **Description:** The product reads or writes to a buffer using an index or pointer that references a memory location prior to the beginning of the buffer.

### CWE-787: Out-of-bounds Write
- **Severity:** mandatory | **Story Points:** 13
- **Description:** The product writes data past the end, or before the beginning, of the intended buffer.

### CWE-788: Access of Memory Location After End of Buffer
- **Severity:** optional | **Story Points:** 8
- **Description:** The product reads or writes to a buffer using an index or pointer that references a memory location after the end of the buffer.

### CWE-805: Buffer Access with Incorrect Length Value
- **Severity:** optional | **Story Points:** 8
- **Description:** The product uses a sequential operation to read or write a buffer, but it uses an incorrect length value that causes it to access memory that is outside of the bounds of the buffer.

### CWE-822: Untrusted Pointer Dereference
- **Severity:** optional | **Story Points:** 8
- **Description:** The product obtains a value from an untrusted source, converts this value to a pointer, and dereferences the resulting pointer.

### CWE-823: Use of Out-of-range Pointer Offset
- **Severity:** optional | **Story Points:** 8
- **Description:** The product performs pointer arithmetic on a valid pointer, but it uses an offset that can point outside of the intended range of valid memory locations for the resulting pointer.

### CWE-824: Access of Uninitialized Pointer
- **Severity:** optional | **Story Points:** 5
- **Description:** The product accesses or uses a pointer that has not been initialized.

### CWE-825: Expired Pointer Dereference
- **Severity:** optional | **Story Points:** 8
- **Description:** The product dereferences a pointer that contains a location for memory that was previously valid, but is no longer valid.

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
  "input_name": "CWE - Memory Safety",
  "analysis_method": "LLM",
  "status": "success",
  "result": {
    "finding": "Assessed 15 CWE rules in Memory Safety: X FOUND, Y NOT_FOUND",
    "confidence": "high",
    "evidence": ["Scanned application source files for memory safety patterns"],
    "values": [
      {
        "id": "<CWE-XXX>",
        "name": "<Rule Name>",
        "status": "FOUND",
        "category": "Memory Safety",
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
        "category": "Memory Safety",
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

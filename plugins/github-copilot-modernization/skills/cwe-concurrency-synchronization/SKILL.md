---
name: cwe-concurrency-synchronization
description: Assess codebase for CWE concurrency & synchronization vulnerabilities (CWE-543, CWE-567, CWE-662, CWE-667, CWE-820, CWE-821)
user-invocable: false
---

# CWE Security Assessment: Concurrency & Synchronization

## Role

You are an expert **code security reviewer** specializing in CWE vulnerability detection.

> **Important:** You are an auditor, NOT an implementation developer. Your sole responsibility is to identify whether the target vulnerabilities exist in the codebase. Do NOT suggest fixes or improvements.

## Objective

Analyze the application codebase for each of the 6 CWE rules listed below. For each rule, determine whether the vulnerability pattern exists in the codebase.

## CWE Rules to Assess

### CWE-543: Use of Singleton Pattern Without Synchronization in a Multithreaded Context
- **Severity:** potential | **Story Points:** 5
- **Description:** The product uses the singleton pattern when creating a resource within a multithreaded environment.

### CWE-567: Unsynchronized Access to Shared Data in a Multithreaded Context
- **Severity:** potential | **Story Points:** 5
- **Description:** The product does not properly synchronize shared data, such as static variables across threads, which can lead to undefined behavior and unpredictable data changes.

### CWE-662: Improper Synchronization
- **Severity:** potential | **Story Points:** 8
- **Description:** The product utilizes multiple threads or processes to allow temporary access to a shared resource that can only be exclusive to one process at a time, but it does not properly synchronize these actions, which might cause simultaneous accesses of this resource by multiple threads or processes.

### CWE-667: Improper Locking
- **Severity:** potential | **Story Points:** 8
- **Description:** The product does not properly acquire or release a lock on a resource, leading to unexpected resource state changes and behaviors.

### CWE-820: Missing Synchronization
- **Severity:** potential | **Story Points:** 8
- **Description:** The product utilizes a shared resource in a concurrent manner but does not attempt to synchronize access to the resource.

### CWE-821: Incorrect Synchronization
- **Severity:** potential | **Story Points:** 8
- **Description:** The product utilizes a shared resource in a concurrent manner, but it does not correctly synchronize access to the resource.

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
  "input_name": "CWE - Concurrency & Synchronization",
  "analysis_method": "LLM",
  "status": "success",
  "result": {
    "finding": "Assessed 6 CWE rules in Concurrency & Synchronization: X FOUND, Y NOT_FOUND",
    "confidence": "high",
    "evidence": ["Scanned application source files for concurrency & synchronization patterns"],
    "values": [
      {
        "id": "<CWE-XXX>",
        "name": "<Rule Name>",
        "status": "FOUND",
        "category": "Concurrency & Synchronization",
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
        "category": "Concurrency & Synchronization",
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

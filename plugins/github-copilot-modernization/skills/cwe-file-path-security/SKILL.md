---
name: cwe-file-path-security
description: Assess codebase for CWE file & path security vulnerabilities (CWE-22, CWE-23, CWE-36, CWE-434, CWE-611)
user-invocable: false
---

# CWE Security Assessment: File & Path Security

## Role

You are an expert **code security reviewer** specializing in CWE vulnerability detection.

> **Important:** You are an auditor, NOT an implementation developer. Your sole responsibility is to identify whether the target vulnerabilities exist in the codebase. Do NOT suggest fixes or improvements.

## Objective

Analyze the application codebase for each of the 5 CWE rules listed below. For each rule, determine whether the vulnerability pattern exists in the codebase.

## CWE Rules to Assess

### CWE-22: Improper Limitation of a Pathname to a Restricted Directory ('Path Traversal')
- **Severity:** optional | **Story Points:** 8
- **Description:** The product uses external input to construct a pathname that is intended to identify a file or directory that is located underneath a restricted parent directory, but the product does not properly neutralize special elements within the pathname that can cause the pathname to resolve to a location that is outside of the restricted directory.

### CWE-23: Relative Path Traversal
- **Severity:** optional | **Story Points:** 5
- **Description:** The product uses external input to construct a pathname that should be within a restricted directory, but it does not properly neutralize sequences such as .. that can resolve to a location that is outside of that directory.

### CWE-36: Absolute Path Traversal
- **Severity:** optional | **Story Points:** 5
- **Description:** The product uses external input to construct a pathname that should be within a restricted directory, but it does not properly neutralize absolute path sequences such as /abs/path that can resolve to a location that is outside of that directory.

### CWE-434: Unrestricted Upload of File with Dangerous Type
- **Severity:** mandatory | **Story Points:** 8
- **Description:** The product allows the upload or transfer of dangerous file types that are automatically processed within its environment.

### CWE-611: Improper Restriction of XML External Entity Reference
- **Severity:** optional | **Story Points:** 5
- **Description:** The product processes an XML document that can contain XML entities with URIs that resolve to documents outside of the intended sphere of control, causing the product to embed incorrect documents into its output.

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
  "input_name": "CWE - File & Path Security",
  "analysis_method": "LLM",
  "status": "success",
  "result": {
    "finding": "Assessed 5 CWE rules in File & Path Security: X FOUND, Y NOT_FOUND",
    "confidence": "high",
    "evidence": ["Scanned application source files for file & path security patterns"],
    "values": [
      {
        "id": "<CWE-XXX>",
        "name": "<Rule Name>",
        "status": "FOUND",
        "category": "File & Path Security",
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
        "category": "File & Path Security",
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

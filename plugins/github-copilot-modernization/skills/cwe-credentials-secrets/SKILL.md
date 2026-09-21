---
name: cwe-credentials-secrets
description: Assess codebase for CWE credentials & secrets vulnerabilities (CWE-259, CWE-321, CWE-732, CWE-778, CWE-798)
user-invocable: false
---

# CWE Security Assessment: Credentials & Secrets

## Role

You are an expert **code security reviewer** specializing in CWE vulnerability detection.

> **Important:** You are an auditor, NOT an implementation developer. Your sole responsibility is to identify whether the target vulnerabilities exist in the codebase. Do NOT suggest fixes or improvements.

## Objective

Analyze the application codebase for each of the 5 CWE rules listed below. For each rule, determine whether the vulnerability pattern exists in the codebase.

## CWE Rules to Assess

### CWE-259: Use of Hard-coded Password
- **Severity:** optional | **Story Points:** 5
- **Description:** The product contains a hard-coded password, which it uses for its own inbound authentication or for outbound communication to external components.

### CWE-321: Use of Hard-coded Cryptographic Key
- **Severity:** potential | **Story Points:** 5
- **Description:** The product uses a hard-coded, unchangeable cryptographic key.

### CWE-732: Incorrect Permission Assignment for Critical Resource
- **Severity:** optional | **Story Points:** 5
- **Description:** The product specifies permissions for a security-critical resource in a way that allows that resource to be read or modified by unintended actors.

### CWE-778: Insufficient Logging
- **Severity:** potential | **Story Points:** 3
- **Description:** When a security-critical event occurs, the product either does not record the event or omits important details about the event when logging it.

### CWE-798: Use of Hard-coded Credentials
- **Severity:** optional | **Story Points:** 5
- **Description:** The product contains hard-coded credentials, such as a password or cryptographic key.

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
  "input_name": "CWE - Credentials & Secrets",
  "analysis_method": "LLM",
  "status": "success",
  "result": {
    "finding": "Assessed 5 CWE rules in Credentials & Secrets: X FOUND, Y NOT_FOUND",
    "confidence": "high",
    "evidence": ["Scanned application source files for credentials & secrets patterns"],
    "values": [
      {
        "id": "<CWE-XXX>",
        "name": "<Rule Name>",
        "status": "FOUND",
        "category": "Credentials & Secrets",
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
        "category": "Credentials & Secrets",
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

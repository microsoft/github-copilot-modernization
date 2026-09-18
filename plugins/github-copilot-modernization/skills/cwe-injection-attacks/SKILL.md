---
name: cwe-injection-attacks
description: Assess codebase for CWE injection attacks vulnerabilities (CWE-77, CWE-78, CWE-79, CWE-88, CWE-89, CWE-90, CWE-91, CWE-99, CWE-502, CWE-564, CWE-643, CWE-652)
user-invocable: false
---

# CWE Security Assessment: Injection Attacks

## Role

You are an expert **code security reviewer** specializing in CWE vulnerability detection.

> **Important:** You are an auditor, NOT an implementation developer. Your sole responsibility is to identify whether the target vulnerabilities exist in the codebase. Do NOT suggest fixes or improvements.

## Objective

Analyze the application codebase for each of the 12 CWE rules listed below. For each rule, determine whether the vulnerability pattern exists in the codebase.

## CWE Rules to Assess

### CWE-77: Improper Neutralization of Special Elements used in a Command ('Command Injection')
- **Severity:** mandatory | **Story Points:** 13
- **Description:** The product constructs all or part of a command using externally-influenced input from an upstream component, but it does not neutralize or incorrectly neutralizes special elements that could modify the intended command when it is sent to a downstream component.

### CWE-78: Improper Neutralization of Special Elements used in an OS Command ('OS Command Injection')
- **Severity:** mandatory | **Story Points:** 13
- **Description:** The product constructs all or part of an OS command using externally-influenced input from an upstream component, but it does not neutralize or incorrectly neutralizes special elements that could modify the intended OS command when it is sent to a downstream component.

### CWE-79: Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting')
- **Severity:** optional | **Story Points:** 8
- **Description:** The product does not neutralize or incorrectly neutralizes user-controllable input before it is placed in output that is used as a web page that is served to other users.

### CWE-88: Improper Neutralization of Argument Delimiters in a Command ('Argument Injection')
- **Severity:** optional | **Story Points:** 5
- **Description:** The product constructs a string for a command to be executed by a separate component in another control sphere, but it does not properly delimit the intended arguments, options, or switches within that command string.

### CWE-89: Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')
- **Severity:** mandatory | **Story Points:** 13
- **Description:** The product constructs all or part of an SQL command using externally-influenced input from an upstream component, but it does not neutralize or incorrectly neutralizes special elements that could modify the intended SQL command when it is sent to a downstream component. Without sufficient removal or quoting of SQL syntax in user-controllable inputs, the generated SQL query can cause those inputs to be interpreted as SQL instead of ordinary user data.

### CWE-90: Improper Neutralization of Special Elements used in an LDAP Query ('LDAP Injection')
- **Severity:** optional | **Story Points:** 5
- **Description:** The product constructs all or part of an LDAP query using externally-influenced input from an upstream component, but it does not neutralize or incorrectly neutralizes special elements that could modify the intended LDAP query when it is sent to a downstream component.

### CWE-91: XML Injection (aka Blind XPath Injection)
- **Severity:** optional | **Story Points:** 5
- **Description:** The product does not properly neutralize special elements that are used in XML, allowing attackers to modify the syntax, content, or commands of the XML before it is processed by an end system.

### CWE-99: Improper Control of Resource Identifiers ('Resource Injection')
- **Severity:** potential | **Story Points:** 3
- **Description:** The product receives input from an upstream component, but it does not restrict or incorrectly restricts the input before it is used as an identifier for a resource that may be outside the intended sphere of control.

### CWE-502: Deserialization of Untrusted Data
- **Severity:** mandatory | **Story Points:** 13
- **Description:** The product deserializes untrusted data without sufficiently ensuring that the resulting data will be valid.

### CWE-564: SQL Injection: Hibernate
- **Severity:** mandatory | **Story Points:** 8
- **Description:** Using Hibernate to execute a dynamic SQL statement built with user-controlled input can allow an attacker to modify the statement's meaning or to execute arbitrary SQL commands.

### CWE-643: Improper Neutralization of Data within XPath Expressions ('XPath Injection')
- **Severity:** optional | **Story Points:** 5
- **Description:** The product uses external input to dynamically construct an XPath expression used to retrieve data from an XML database, but it does not neutralize or incorrectly neutralizes that input. This allows an attacker to control the structure of the query.

### CWE-652: Improper Neutralization of Data within XQuery Expressions ('XQuery Injection')
- **Severity:** optional | **Story Points:** 5
- **Description:** The product uses external input to dynamically construct an XQuery expression used to retrieve data from an XML database, but it does not neutralize or incorrectly neutralizes that input. This allows an attacker to control the structure of the query.

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
  "input_name": "CWE - Injection Attacks",
  "analysis_method": "LLM",
  "status": "success",
  "result": {
    "finding": "Assessed 12 CWE rules in Injection Attacks: X FOUND, Y NOT_FOUND",
    "confidence": "high",
    "evidence": ["Scanned application source files for injection attacks patterns"],
    "values": [
      {
        "id": "<CWE-XXX>",
        "name": "<Rule Name>",
        "status": "FOUND",
        "category": "Injection Attacks",
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
        "category": "Injection Attacks",
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

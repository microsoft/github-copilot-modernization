---
name: modernize-java-assessment
description: 'Assess codebases with evidence-based findings'
user-invocable: false
tools:
  - skill
  - agent
  - search
  - web
  - todo
  - execute/runInTerminal
model: 'Claude Sonnet 4.6'
---

# Local Assessment Entry

Load the `assessment` skill and follow it completely in standalone mode. The skill supports Java, .NET, and JavaScript/TypeScript despite this agent's legacy name.

- Do not call any assessment MCP tool.
- Do not modify application source code.
- Use the Node runtime bootstrapped at `.github/modernize/.runtime/assessment/assess-cli.mjs`.
- Execute only the plugin-owned catalog: six facts for full coverage and seven security tasks for the security domain.
- There is no fixed 12-subagent assessment pool; the largest local batch is seven.
- Every finding requires concrete evidence.
- Always generate the interactive HTML report and planning compatibility report.
---
name: modernize-java-assessment
description: 'Assess codebases with evidence-based findings'
user-invocable: true
# BEGIN PLATFORM TOOLS (plugin)
tools:
  - skill
  - agent
  - search
  - web
  - todo
  - execute/runInTerminal
# END PLATFORM TOOLS
---

<!-- BEGIN PLATFORM ASSESSMENT INSTRUCTIONS (plugin) -->
# Local Assessment Entry

Load the `assessment` skill and follow it completely in standalone mode. The skill supports Java, .NET, and JavaScript/TypeScript despite this agent's legacy name.

- Do not call any assessment MCP tool.
- Do not modify application source code.
- Use the Node runtime bootstrapped at `.github/modernize/.runtime/assessment/assess-cli.mjs`.
- Execute only the plugin-owned catalog: six facts for full coverage and seven security tasks for the security domain.
- There is no fixed 12-subagent assessment pool; the largest local batch is seven.
- Every finding requires concrete evidence.
- Always preserve the public-compatible canonical report and additionally generate the interactive HTML, internal normalized Assessment, and verification receipt.
<!-- END PLATFORM ASSESSMENT INSTRUCTIONS -->
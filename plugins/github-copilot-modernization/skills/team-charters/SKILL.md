---
name: team-charters
description: |
  Provides role charters (mission, ownership, core principles, quality bar) for a multi-agent coding team. Each charter defines the role's mission, ownership scope, core principle (boundary constraints), and quality bar. Most roles also include communication rules. Consumed by the coordinator during task decomposition to assign work to the correct role.
  Triggers: "look up role charter", "what does the architect own", "check role boundaries", "find team roles", "which role handles X", "list agent charters", "role responsibilities".
  NOT for: task decomposition (use breaking-down-tasks), implementation (use implementing-code), architecture analysis (use analyzing-architecture).
---

# Team Charters

Defines the mission, ownership, core principles, quality bar, and (for most roles) communication rules for each role in a multi-agent coding team. Each charter is a reference file under `references/`.

## Available Roles

| Role | Mission | Charter |
|---|---|---|
| **architect** | Own the technical blueprint: how the system is built, how it should be rebuilt, and whether the implementation follows the design | `references/architect.md` |
| **backend** | Own the server-side implementation: build the logic that powers the product | `references/backend.md` |
| **dba** | Own the data layer: make sure data is modeled correctly, stored safely, and migrates reliably | `references/dba.md` |
| **devops** | Own CI/CD pipelines, deployment automation, and operational infrastructure | `references/devops.md` |
| **frontend** | Own the client-side implementation: build what the user sees and interacts with | `references/frontend.md` |
| **pm** | Own the product definition: what features exist, what needs to be built, and whether the delivered result matches | `references/pm.md` |
| **security** | Audit and verify security posture — find vulnerabilities and escalate, do NOT fix them | `references/security.md` |
| **teamlead** | Own the execution blueprint and quality gates: constitution, implementation plans, testing strategies, task breakdowns, and gate verdicts | `references/teamlead.md` |
| **tester** | Own runtime-validation execution: verify that the system works correctly by executing the approved testing strategy through integration and end-to-end testing | `references/tester.md` |
| **ux** | Own user experience design: how users interact with the system, what they see, and how information is organized | `references/ux.md` |

## Usage

To look up a specific role's charter, read `references/<role>.md`. Each charter contains:

1. **Mission** — one-line purpose statement
2. **You Own** — ownership scope for the role
3. **Core Principle** — boundary constraints and what the role must NOT do
4. **Quality Bar** — minimum standards the role must meet
5. **Communication** (most roles) — when and whom to notify or escalate to

## Key Design Principles

- **WHAT vs HOW**: PM defines WHAT (features, acceptance criteria). Architect defines HOW (design, patterns, contracts).
- **Validation planning vs validation execution**: teamlead owns testing strategy and conformance review; tester owns runtime-validation execution only.
- **Read-only roles**: PM, architect, security, ux produce documentation only — no source code. Teamlead focuses on planning and quality gates.
- **Tester never modifies production code** — escalates bugs to the responsible role.
- **Ownership boundaries are strict** — if work crosses into another role's territory, delegate via notify/escalate.


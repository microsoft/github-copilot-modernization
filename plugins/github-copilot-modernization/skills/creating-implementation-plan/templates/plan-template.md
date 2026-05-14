# Implementation Plan: [FEATURE]

**Date**: [DATE] | **Spec**: [reference]

## Summary

[Primary requirement + technical approach, derived from feature spec and design artifacts]

## Technical Context

**Language/Version**: [from architect's tech-stack.md]
**Primary Dependencies**: [from research]
**Storage**: [from data-model.md]
**Testing**: [from research]
**Target Platform**: [from research]
**Performance Goals**: [from spec]
**Constraints**: [from spec + constitution]

## Constitution Check

*GATE: Must pass. Re-check after design review.*

[Verify plan decisions align with constitution principles. List each principle and pass/fail.]

## Applied Guidelines

[List any matching migration/transformation guidelines from `skills/guidelines/` and how they influence the plan.]

## Implementation Steps

[Ordered steps with REQ-XXX traceability. Each step references the design artifacts it consumes. If a project topology exists, include the G-group label in the step title.]

### Step 1: [G1] [Title]
- **Group**: G1 — [group name from project topology] (omit this field if no project topology; use `Cross-cutting` for steps spanning all groups)
- **Requirements**: REQ-001, REQ-002
- **Design inputs**: [from dependency artifacts]
- **Description**: [What to implement and key decisions]

### Step 2: [G2] [Title]
- **Group**: G2 — [group name]
- **Requirements**: REQ-003
- **Design inputs**: [...]
- **Description**: [...]

## Project Structure

```text
[Concrete directory layout for this feature's implementation]
```

## Testing Strategy

> Fill per the runtime-validation skill (Part 1). This section is MANDATORY for brownfield (migration/rewrite) projects.

- **appType**: [API-only / server-rendered HTML / SPA / mixed / messaging / desktop]
- **Critical user journeys**: [3-5 minimum, from feature inventory]
- **primaryValidationStack**: [full stack when all capabilities available]
- **fallbackMatrix**:
  - `infra-tier`: [primary tool, e.g. Testcontainers for Java, docker-compose for others] → [fallback, e.g. H2, SQLite, embedded broker]. Prerequisite: [Docker / other]
  - `browser-tier`: [primary tool] → [fallback]. Prerequisite: [Node.js + Playwright / other]
- **Environment requirements**: [Docker? Node? Containers? Browser tooling? — list per capability]
- **knownGaps**: [per-axis coverage loss when each fallback is activated]
- **Test data strategy**: [seed, isolate (UUID), clean up]
- **Acceptance criteria**: [PASS definition per journey]
- **Validation review expectations**: [what final reviewer confirms]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., extra layer] | [current need] | [why simpler approach insufficient] |

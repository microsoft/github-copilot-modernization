---
name: feature-inventory
description: |
  Catalogs existing features from a codebase (API endpoints, user flows, UI screens, observable behaviors) and generates structured feature specs with REQ-XXX IDs, user scenarios, and success criteria.
  Triggers: "inventory features", "catalog existing functionality", "list what the app does", "extract requirements from code", "generate feature specs from research", "write a spec", "create feature specification", "define requirements".
  NOT for: implementation planning (use creating-implementation-plan), implementation (use implementing-code).
---


## User Input

You **MUST** consider the user input before proceeding (if not empty).

The text in the task description **is** the feature description. Assume you always have it available. Do not ask the user to repeat it unless they provided an empty command.

## Outline

Given that feature description, do this:

## Output

All outputs are written under your task's `Artifact path:` (from task metadata).

```
spec.md                     ← main artifact (feature specification)
requirements-checklist.md   ← quality checklist (if applicable)
```

## Workflow

1. Load constitution document (if available) to understand principles and constraints.

2. Read `knowledge-graph.json` (and, if needed, the query guidance in `skills/building-java-knowledge-graph/SKILL.md`) to understand the architecture and dependencies related to this feature. Also check for research files if available.

3. Load `skills/writing-feature-spec/templates/spec-template.md` for required sections.

4. Execute:
    1. Parse feature description from task
       If empty: ERROR "No feature description provided"
    2. Extract key concepts: actors, actions, data, constraints
    3. **Assign unique requirement IDs** (CRITICAL for traceability):
       - Format: `REQ-XXX` where XXX is a 3-digit sequence number (001, 002, ...)
       - Example: `REQ-001`, `REQ-002`, `REQ-003`
       - Each requirement MUST have unique ID across entire feature
    4. For unclear aspects:
       - Make informed guesses based on context and industry standards
       - Only mark with [NEEDS CLARIFICATION: specific question] if:
         - The choice significantly impacts feature scope or user experience
         - Multiple reasonable interpretations exist with different implications
         - No reasonable default exists
       - **LIMIT: Maximum 3 [NEEDS CLARIFICATION] markers total**
       - Prioritize clarifications by impact: scope > security/privacy > user experience > technical details
    5. Fill User Scenarios & Testing section
       If no clear user flow: ERROR "Cannot determine user scenarios"
    6. Generate Functional Requirements
       Each requirement must be testable
       Use reasonable defaults for unspecified details (document assumptions in Assumptions section)
    7. Define Success Criteria
       Create measurable, technology-agnostic outcomes
       Include both quantitative metrics (time, performance, volume) and qualitative measures (user satisfaction, task completion)
       Each criterion must be verifiable without implementation details
    8. Identify Key Entities (if data involved)
    9. Return: SUCCESS (spec ready for planning)

5. Write the specification to the assigned artifact path using the template structure, replacing placeholders with concrete details derived from the feature description while preserving section order and headings.

6. Report completion with spec file path, checklist results, and readiness for the next phase.

## Research-Driven Mode

When pre-built research files are available (provided by a design/explore phase), use this alternate workflow instead of reading source code directly:

### ⚠️ NO Direct Codebase Exploration
When research files exist, do NOT read project source files directly (source code, build files, config files). All codebase analysis is already in the research files.

### Research File Inputs

Look for these files in the current working directory or as referenced in the task:
- `project-structure.md` — functional domain list (REQUIRED)
- `tech-stack.md` — technology inventory (REQUIRED)
- `data-model.md` — key entities summary (optional)
- `architecture-summary.md` — substitute for direct knowledge graph reading (optional)
- Any additional `*.md` research files (optional)

### Domain-Driven Generation
Use the functional domain list from `project-structure.md` to drive:
- **User Scenarios**: For each domain, generate 1–3 user stories (P1/P2/P3, Given-When-Then)
- **Requirements**: For each domain, generate 2–4 REQ-XXX items referencing constitution principles
- **Key Entities**: Use entities from `data-model.md` directly (top 6–8)

### Incremental Section Writing
Write the spec **section by section**, appending each to the assigned artifact before moving to the next:
1. Header + Scope Baseline → create/write artifact
2. User Scenarios & Testing → append
3. Requirements (Functional per domain + Non-Functional) → append
4. Success Criteria → append

### Checklist Generation
After spec is complete, append a quality checklist section at the end of the artifact:
# Requirements Quality Checklist

## Requirement ID Coverage
- [ ] All requirements use REQ-XXX format
- [ ] IDs are unique and sequential

## Testability
- [ ] Every requirement is independently testable
- [ ] Acceptance criteria are concrete (Given-When-Then)

## Completeness
- [ ] Scope Baseline section complete
- [ ] User Scenarios prioritized (P1, P2, P3)
- [ ] Functional requirements cover all in-scope items
- [ ] Success criteria are measurable

## Constitution Alignment
- [ ] All constitution principles referenced
- [ ] Migration mode constraints respected

---

## General Guidelines

- Focus on **WHAT** users need and **WHY**.
- Avoid HOW to implement (no tech stack, APIs, code structure).
- Written for business stakeholders, not developers.
- DO NOT create any checklists that are embedded in the spec. That will be a separate command.

### Section Requirements

- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation

When creating this spec from a user prompt:

1. **Make informed guesses**: Use context, industry standards, and common patterns to fill gaps
2. **Document assumptions**: Record reasonable defaults in the Assumptions section
3. **Limit clarifications**: Maximum 3 [NEEDS CLARIFICATION] markers - use only for critical decisions that:
   - Significantly impact feature scope or user experience
   - Have multiple reasonable interpretations with different implications
   - Lack any reasonable default
4. **Prioritize clarifications**: scope > security/privacy > user experience > technical details
5. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
6. **Common areas needing clarification** (only if no reasonable default exists):
   - Feature scope and boundaries (include/exclude specific use cases)
   - User types and permissions (if multiple conflicting interpretations possible)
   - Security/compliance requirements (when legally/financially significant)

**Examples of reasonable defaults** (don't ask about these):

- Data retention: Industry-standard practices for the domain
- Performance targets: Standard web/mobile app expectations unless specified
- Error handling: User-friendly messages with appropriate fallbacks
- Authentication method: Standard session-based or OAuth2 for web apps
- Integration patterns: RESTful APIs unless specified otherwise

### Success Criteria Guidelines

Success criteria must be:

1. **Measurable**: Include specific metrics (time, percentage, count, rate)
2. **Technology-agnostic**: No mention of frameworks, languages, databases, or tools
3. **User-focused**: Describe outcomes from user/business perspective, not system internals
4. **Verifiable**: Can be tested/validated without knowing implementation details

**Good examples**:

- "Users can complete checkout in under 3 minutes"
- "System supports 10,000 concurrent users"
- "95% of searches return results in under 1 second"
- "Task completion rate improves by 40%"

**Bad examples** (implementation-focused):

- "API response time is under 200ms" (too technical, use "Users see results instantly")
- "Database can handle 1000 TPS" (implementation detail, use user-facing metric)
- "React components render efficiently" (framework-specific)
- "Redis cache hit rate above 80%" (technology-specific)

## Resources

### Templates
- `templates/spec-template.md` — Specification document template with all mandatory sections

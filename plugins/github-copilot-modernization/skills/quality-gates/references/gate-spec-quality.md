# Gate: spec-quality — Checklist

Write to `FEATURE_DIR/checklists/requirements.md`.

## Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

## Requirement Completeness

- [ ] No `[NEEDS CLARIFICATION]` markers remain
- [ ] Requirements are testable and unambiguous
- [ ] Success criteria are measurable and technology-agnostic
- [ ] All acceptance scenarios defined; edge cases identified
- [ ] Scope clearly bounded; dependencies identified

## Feature Readiness

- [ ] All functional requirements have clear acceptance criteria
- [ ] User scenarios cover primary flows

## Domain Coverage

*(Auto-populated if `research/project-structure.md` exists)*

- [ ] Each domain maps to ≥1 REQ-XXX
- Uncovered domain → **CRITICAL**

## Process

1. Check each item → pass/fail with specific quotes from spec
2. If `[NEEDS CLARIFICATION]` remains (keep max 3): present options table to user, wait for response, update spec
3. If items fail: fix and re-validate (max 3 iterations)
4. Write updated checklist to `FEATURE_DIR/checklists/requirements.md`

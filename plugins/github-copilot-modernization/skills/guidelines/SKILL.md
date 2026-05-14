---
name: guidelines
description: |
  Collection of framework-to-framework migration rules and transformation patterns (e.g., Struts→Spring MVC, JSP→Thymeleaf, EJB→Spring Boot).
  Triggers: "check migration guidelines", "look up transformation rules", "find Struts-to-Spring patterns", "apply migration conventions", "conversion rules for X→Y".
  Also consumed automatically by breaking-down-tasks and implementing-code during migration workflows.
  NOT for: direct execution — other skills scan this directory.
---

## User Input

You **MUST** consider the user input before proceeding (if not empty).


## Purpose

Guidelines are curated, domain-specific knowledge bases providing:
- **Migration patterns**: Technology-to-technology recipes
- **Transformation rules**: Concrete mappings and conversion templates
- **Checklists**: Step-by-step validation criteria

## Directory Structure

```
skills/guidelines/
├── SKILL.md                    # This file - lookup mechanism
├── struts-to-spring/           # Struts 2 → Spring Boot 3.x
│   └── SKILL.md
└── {domain}/                   # Future guideline domains
    └── SKILL.md
```

## Lookup Mechanism

When other skills need guideline lookup:

1. **Context Analysis**: Extract technology keywords from spec/plan/code.
2. **Guideline Discovery**: Search `skills/guidelines/` subdirectories for matching patterns.
3. **Application**: Load matching SKILL.md, extract applicable rules for current phase.

## Integration Points

| Workflow Step | Guideline Application |
|---------------|----------------------|
| Specification | Domain constraints, scope boundaries |
| Planning | Technology decisions, architecture patterns |
| Tasks | Transformation tasks, file-by-file changes |
| Implementation | Code transformation rules, test patterns |
| Completeness | Validation checklists, coverage criteria |

## Creating New Guidelines

1. Create directory: `skills/guidelines/{domain}/`
2. Create `SKILL.md` with:
   - Metadata header (name, description, triggers)
   - Rules organized by migration step
   - Concrete transformation examples (before/after)
   - Validation checklist

## Documenting Applied Guidelines

When guidelines are applied, document in the relevant artifact:

```markdown
## Applied Guidelines
- **Guideline**: struts-to-spring
- **Rules Used**: convert-action-to-controller, convert-validation
- **Reference**: skills/guidelines/struts-to-spring/SKILL.md
```

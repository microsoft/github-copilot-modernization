# Task Format Reference

## Checklist Format (REQUIRED)

Every task MUST follow this format:

```text
- [ ] [TaskID] [P?] [Story?] [Plan:X.Y] Description with file path
```

### Format Components

1. **Checkbox**: Always `- [ ]`
2. **Task ID**: Sequential (T001, T002...) in execution order
3. **[P] marker**: Only if parallelizable (different files, no dependencies)
4. **[Story] label**: `[US1]`, `[US2]` etc. Required for user story phases only; omit for Setup/Foundational/Polish phases
5. **[Plan:X.Y]**: REQUIRED — references source plan item. Multiple: `[Plan:2.1,2.3]`
6. **Description**: Clear action with exact file path

### Rewrite Mode — Source Annotation

In rewrite mode, tasks converting source code MUST include `[Source:]`:

```text
- [ ] T015 [US3] [Plan:3.2] Convert ProductAction to ProductController [Source: src/.../ProductAction.java#list,add,edit] [BL: BL-008]
```

Rules:
- Path relative from repo root
- Methods after `#`, comma-separated
- Multiple files: multiple `[Source:]` annotations
- Entire file: omit `#`
- Optional `[BL: BL-XXX]` links to business-logic-inventory.md
- Non-source tasks (setup, config) don't need `[Source:]`

### Examples

✅ `- [ ] T001 [Plan:1.1] Create project structure per implementation plan`
✅ `- [ ] T005 [P] [Plan:2.1] Implement auth middleware in src/middleware/auth.py`
✅ `- [ ] T012 [P] [US1] [Plan:2.2] Create User model in src/models/user.py`
✅ `- [ ] T015 [US3] [Plan:3.2] Convert ProductAction to ProductController [Source: src/.../ProductAction.java#list,add]`

❌ `- [ ] Create User model` (missing ID, Plan ref)
❌ `T001 [US1] Create model` (missing checkbox)

## Phase Structure

- **Phase 1**: Setup (project initialization)
- **Phase 2**: Foundational (blocking prerequisites)
- **Phase 3+**: User Stories in priority order (P1, P2, P3...)
  - Within each: Models → Services → Endpoints → Integration
  - Each phase = independently testable increment
- **Final Phase**: Polish & Cross-Cutting Concerns

## Task Organization Sources

1. **User Stories (spec.md)** — primary organization, each story gets its own phase
2. **Contracts** — map endpoints to their user story
3. **Data Model** — map entities to stories; shared entities go to Setup
4. **Infrastructure** — shared → Setup, story-specific → within that story

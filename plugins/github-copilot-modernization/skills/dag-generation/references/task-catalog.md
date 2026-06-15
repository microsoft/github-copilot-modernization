# Task Catalog — Fragment Library

LLM uses this to select task fragments for DAG generation. Each fragment is `{desc, phase}` plus optional ordering/dependency fields. **No role field** — coordinator matches role from team-charters at dispatch time.

**`after` field**: If both this fragment and the listed fragment are selected, this one must be scheduled after. If the listed fragment was not selected, the constraint is ignored.

**`requires` field**: Selecting this fragment forces the listed fragment to also be selected. Hard dependency.

---

## Plan Phase

### constitution
- **desc**: Set up project constitution (migration principles, coding conventions, target stack rules). Provides shared guardrails when multiple workers will produce code in parallel.
- **when**: Cross-stack rewrite with multiple workers; long-lived modernization; user asks for "rules"/"conventions"
- **skip when**: Small project where a single worker can hold the full codebase in context; same-stack upgrade; lite scope

### feature-inventory
- **desc**: Inventory existing features (API endpoints, user flows, UI screens, behaviors). Produces the checklist that conformance-completeness validates against.
- **after**: constitution
- **when**: Full rewrite requiring feature parity validation; user says "preserve all features"; module extraction with public API
- **skip when**: Same-stack upgrade; lite scope; small rewrite where features are obvious from code (single-module, few controllers)

### arch-analysis
- **desc**: Analyze current architecture (patterns, dependencies, data flow, risks).
- **after**: constitution
- **when**: Any non-trivial migration (default/heavy)
- **skip when**: Lite scope (single-file change)

### arch-design
- **desc**: Design target architecture (system design, API contracts, data model, tech choices). For cross-stack migrations, defines the new project structure; for in-place changes, not needed.
- **after**: arch-analysis, feature-inventory
- **when**: Cross-stack rewrite spanning multiple independently-deployable modules; module extraction with new boundary; architectural pattern change
- **skip when**: Same-stack upgrade; small cross-stack rewrite where target architecture is straightforward; drop-in library replacement

### data-modeling
- **desc**: Design data model and migration strategy (schema changes, ORM mapping, data migration plan, rollback strategy).
- **after**: arch-analysis, feature-inventory

### ux-design
- **desc**: Design frontend UX — page flows, component architecture, state management strategy, design system selection, responsive breakpoints.
- **after**: feature-inventory
- **when**: Frontend rewrite or new UI framework adoption (e.g. JSP→React, Ember→React); user asks for UX redesign
- **skip when**: Backend-only migration; no frontend changes; same-framework upgrade; frontend preserved as-is

### implementation-plan
- **desc**: Create implementation plan + task breakdown with traceability. Needed when deep planning is required — multiple workers implement in parallel or change spans multiple modules requiring sequenced steps.
- **after**: arch-design
- **when**: `deep_planning: true` — coordinator determined that execute tasks cannot be fully defined without plan-phase artifacts
- **skip when**: `deep_planning: false` — execute tasks are knowable upfront; single worker handles all implementation; codebase fits in one developer's context

### quality-gate-plan
- **desc**: Quality gate — validate the implementation plan (coverage, traceability, feasibility).
- **after**: implementation-plan, test-strategy
- **when**: implementation-plan is selected
- **skip when**: implementation-plan was skipped; lite scope

### test-strategy
- **desc**: Design test strategy — test types, scope, tooling, coverage targets, priority areas.
- **after**: arch-analysis
- **when**: runtime-validation is selected; cross-stack rewrite; change spans independently-deployable boundaries; user asks for testing plan
- **skip when**: Small project where a single worker handles everything; same-stack upgrade with no behavior change; no runtime-validation in pipeline

---

## Execute Phase

> **Implementation tasks are NOT selected from this catalog.** When `implementation-plan` is selected in the plan phase, the worker producing that plan decomposes the implementation into concrete tasks — the coordinator dispatches from that breakdown. When `implementation-plan` is skipped (small projects), the coordinator decomposes implementation tasks itself based on plan-phase outputs. The fragments below are **auxiliary** execute-phase tasks that may be selected alongside implementation tasks.

### scaffold
- **desc**: Set up target project structure + infrastructure (build files, CI skeleton, base config). For cross-stack migrations that produce a new codebase; not needed for in-place modifications.
- **scope**: global
- **when**: Cross-stack rewrite producing new project structure
- **skip when**: In-place modification; same-stack upgrade

### db-migration
- **desc**: Execute DB schema migration scripts (Flyway/Liquibase/EF migrations).
- **scope**: per-group
- **after**: [data-modeling]
- **requires**: data-modeling

### deployment-setup
- **desc**: Set up deployment configuration (CI/CD pipeline, environment config, containerization, infrastructure-as-code).
- **scope**: global
- **after**: [implementation]
- **when**: User requests CI/CD or deployment; new infrastructure needed
- **skip when**: No deployment/infra requirements specified; user only asks for code migration

---

## Validate Phase

### arch-review
- **desc**: Architecture review — verify implementation follows target architecture design (layering, dependency direction, API contracts, patterns). Checks that what was built matches what arch-design specified.
- **scope**: global
- **when**: arch-design was selected (reviews against that design)
- **skip when**: arch-design was skipped; small project where runtime-validation suffices

### security-review
- **desc**: Security audit — auth flows, input validation, secrets handling, dependency vulnerabilities, OWASP concerns.
- **scope**: global
- **when**: App has auth/security flows; user requests security audit; public-facing API
- **skip when**: No auth/security in source app; user didn't request security review

### ux-review
- **desc**: UX review — verify UI flows, accessibility, responsive design, component consistency against source app.
- **scope**: global
- **after**: frontend execute tasks
- **when**: Frontend rewrite or UI framework change (e.g. JSP→React, Ember→React)
- **skip when**: Backend-only migration; no frontend changes; same-framework upgrade

### smoke-test
- **desc**: Independent build and startup verification from reviewer perspective. Run the project's root-level full build and emit a `## Smoke Test Verdict` block into the artifact. Execution rules (full-build requirement, frozen install, verdict block format) are in the worker agent's **Smoke-Test Build Verification** section.
- **scope**: global
- **after**: all execute-phase tasks
- **when**: Always selected when execute-phase tasks exist
- **skip when**: Never skip — this is mandatory for any project that produces a runnable artifact

### runtime-validation
- **desc**: Runtime validation — integration + E2E tests, regression checks, feature verification.
- **scope**: global
- **after**: smoke-test, arch-review, security-review, ux-review, deployment-setup, test-strategy
- **when**: Cross-stack rewrite; architecture change; major version upgrade with breaking changes; DB schema change; frontend framework migration; behavior-altering upgrade; change touching auth/payments/data persistence; user requests validation
- **skip when**: Pure version bump with no API/behavior/transitive-dependency change; config/doc/metadata-only change; dev-tooling-only change producing identical build artifacts

### feature-parity-signoff
- **desc**: Verify feature-inventory checklist is fully covered — no missing endpoints, UI flows, or business rules. Produces parity matrix.
- **scope**: global
- **after**: feature-inventory, runtime-validation
- **when**: feature-inventory was selected
- **skip when**: feature-inventory was skipped

### conformance-review
- **desc**: Validate that tests executed according to strategy, all quality gates passed, and no regressions remain.
- **scope**: global
- **after**: runtime-validation, test-strategy
- **when**: Multiple validation steps exist; need final rollup
- **skip when**: Only runtime-validation in validate phase (conformance adds no value as separate step)

---

## Task Selection

Select tasks based on `change_type` (upgrade | extract | rewrite), `user_ask`, and `project_profile`. For each fragment, decide include/exclude with a one-line rationale. Respect hard rules above.

**change_type** (context signal, not lookup key):
- `upgrade` — version bumps, dependency updates, language/framework upgrades, same-stack modernization
- `extract` — pull out a module/service, define new boundaries
- `rewrite` — cross-stack migration or architecture overhaul

---

## Calibration References

These illustrate the expected scale of fragment selection across different project profiles. They are NOT templates to copy — derive your selection from the project's actual characteristics. The point is calibrating your judgment: a 1K LOC upgrade should not produce the same ceremony as a 200K LOC rewrite.

- **1.4K LOC, 1 module, rewrite (cross-stack migration)**: ~4 fragments. Most ceremony is overhead — single worker holds full context, features are obvious from code, target architecture is straightforward. deep_planning MUST be false. Skip coordination fragments (constitution, implementation-plan, quality-gate-plan, test-strategy), inventory fragments (feature-inventory, feature-parity-signoff), and detailed review fragments (arch-design, arch-review, security-review) unless the project has specific complexity signals (auth flows, data model changes, etc.).

- **12K LOC, single module, upgrade (version bump)**: ~3 fragments. Same-stack upgrade needs analysis, an implementation plan to sequence changes, and runtime validation. No new architecture, no feature changes, no DB changes.

- **50K LOC, 3 modules, rewrite (cross-stack)**: ~13 fragments. Multiple modules and cross-stack migration justify full ceremony — coordination, inventory, architecture, implementation planning, reviews, and validation.

- **200K LOC, 8 modules, extract (module separation)**: ~14 fragments. Large-scale extraction with new service boundaries needs nearly all fragments except feature inventory (scope is one module with known API).

- **80K LOC, upgrade (dependency bump only)**: ~1 fragment. Pure dependency update — only runtime-validation needed to gate the build.

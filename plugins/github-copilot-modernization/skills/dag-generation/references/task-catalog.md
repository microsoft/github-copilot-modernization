# Task Catalog — Fragment Library

LLM uses this to select task fragments for DAG generation. Each fragment is `{desc, phase}` plus optional ordering/dependency fields. **No role field** — coordinator matches role from team-charters at dispatch time.

**`after` field**: If both this fragment and the listed fragment are selected, this one must be scheduled after. If the listed fragment was not selected, the constraint is ignored.

**`requires` field**: Selecting this fragment forces the listed fragment to also be selected. Hard dependency.

**Hard rules** (override LLM selection):
- `db-migration` requires `data-modeling`.

---

## Plan Phase

### constitution
- **desc**: Set up project constitution (migration principles, coding conventions, target stack rules). Provides shared guardrails when multiple workers will produce code in parallel.
- **when**: Cross-stack rewrite with multiple workers; long-lived modernization; user asks for "rules"/"conventions"
- **skip when**: Small project (<5K LOC, single worker); same-stack upgrade; lite scope

### feature-inventory
- **desc**: Inventory existing features (API endpoints, user flows, UI screens, behaviors). Produces the checklist that conformance-completeness validates against.
- **after**: constitution
- **when**: Full rewrite requiring feature parity validation; user says "preserve all features"; module extraction with public API
- **skip when**: Same-stack upgrade; lite scope; small rewrite where features are obvious from code (<5K LOC, <10 endpoints)

### arch-analysis
- **desc**: Analyze current architecture (patterns, dependencies, data flow, risks).
- **after**: constitution
- **when**: Any non-trivial migration (default/heavy)
- **skip when**: Lite scope (single-file change)

### arch-design
- **desc**: Design target architecture (system design, API contracts, data model, tech choices). For cross-stack migrations, defines the new project structure; for in-place changes, not needed.
- **after**: arch-analysis, feature-inventory
- **when**: Cross-stack rewrite (10K+ LOC or 3+ modules); module extraction with new boundary; architectural pattern change
- **skip when**: Same-stack upgrade; small cross-stack rewrite (<5K LOC) where target architecture is straightforward; drop-in library replacement

### data-modeling
- **desc**: Design data model and migration strategy (schema changes, ORM mapping, data migration plan, rollback strategy).
- **after**: arch-analysis, feature-inventory

### ux-design
- **desc**: Design frontend UX — page flows, component architecture, state management strategy, design system selection, responsive breakpoints.
- **after**: feature-inventory
- **when**: Frontend rewrite or new UI framework adoption (e.g. JSP→React, Ember→React); user asks for UX redesign
- **skip when**: Backend-only migration; no frontend changes; same-framework upgrade; frontend preserved as-is

### implementation-plan
- **desc**: Create implementation plan + task breakdown with traceability. Needed when multiple workers implement in parallel or change spans multiple modules requiring sequenced steps.
- **after**: arch-design
- **when**: Multiple workers needed; change spans 3+ modules; complex sequencing dependencies
- **skip when**: Single worker handles all implementation; small project (<5K LOC); straightforward 1:1 mapping

### quality-gate-plan
- **desc**: Quality gate — validate the implementation plan (coverage, traceability, feasibility).
- **after**: implementation-plan, test-strategy
- **when**: implementation-plan is selected
- **skip when**: implementation-plan was skipped; lite scope

### test-strategy
- **desc**: Design test strategy — test types, scope, tooling, coverage targets, priority areas.
- **after**: arch-analysis
- **when**: runtime-validation is selected; cross-stack rewrite; 3+ modules; user asks for testing plan
- **skip when**: Small project (<5K LOC, single worker); same-stack upgrade with no behavior change; no runtime-validation in pipeline

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

### runtime-validation
- **desc**: Runtime validation — integration + E2E tests, regression checks, feature verification.
- **scope**: global
- **after**: arch-review, security-review, ux-review, deployment-setup, test-strategy
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

## Examples

### Example 1: "Upgrade Spring Boot from 2.7 to 3.2" (12K LOC, single module)
- change_type: upgrade
- selected: arch-analysis, implementation-plan, runtime-validation
- excluded rationale: no new architecture (skip arch-design/scaffold), no feature change (skip feature-inventory/feature-parity-signoff/conformance-review), no DB change (skip data-modeling/db-migration), single worker (skip constitution/quality-gate-plan). Implementation tasks generated by coordinator at runtime.

### Example 2: "Extract order module from monolith to microservice" (200K LOC, 8 modules)
- change_type: extract
- selected: constitution, arch-analysis, arch-design, data-modeling, implementation-plan, quality-gate-plan, test-strategy, scaffold, db-migration, deployment-setup, arch-review, security-review, runtime-validation, conformance-review
- excluded rationale: feature-inventory/feature-parity-signoff skipped — scope is one module with known API. Implementation tasks generated via deferred DAG.

### Example 3: "Migrate Struts 1 app to Spring Boot" (50K LOC, 3 modules)
- change_type: rewrite
- selected: constitution, feature-inventory, arch-analysis, arch-design, implementation-plan, quality-gate-plan, test-strategy, scaffold, arch-review, security-review, runtime-validation, feature-parity-signoff, conformance-review
- excluded rationale: no DB schema change (skip data-modeling/db-migration), no new infra needed (skip deployment-setup). Implementation tasks generated via deferred DAG.

### Example 4: "Migrate Struts 2 app to Spring MVC" (1.4K LOC, 1 module, 3 actions)
- change_type: rewrite
- selected: arch-analysis, scaffold, runtime-validation, conformance-review
- excluded rationale: tiny project (1.4K LOC, 3 actions) — single worker, no parallel coordination needed (skip constitution/implementation-plan/quality-gate-plan). Features obvious from code (skip feature-inventory/feature-parity-signoff). Target architecture straightforward 1:1 Action→Controller (skip arch-design/arch-review). No DB, no security, no deployment. Implementation tasks generated by coordinator at runtime.

### Example 5: "Update all npm dependencies to latest versions" (80K LOC)
- change_type: upgrade
- selected: runtime-validation
- excluded rationale: pure dependency bump — no architecture, no new code structure, no feature change. Runtime-validation gates the build; no other validation needed. Implementation tasks generated by coordinator at runtime.

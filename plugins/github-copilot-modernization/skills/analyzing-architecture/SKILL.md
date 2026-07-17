---
name: analyzing-architecture
description: |
  Architect analysis for rewrite/migration: produces structured architecture artifacts plus global prose research views (project-structure, tech-stack, data-model) for planning, implementation, feature-inventory, and gates. This is the single architect task.
  Triggers: "analyze architecture", "analyze existing application", "analyze the codebase", "codebase architecture analysis", "analyze for migration", "prepare migration analysis", "produce migration artifacts", "analyze before rewrite".
  NOT for: greenfield projects, pure syntax/version migrations (Python2→3, Java 8→17 — no paradigm shift), runtime validation (use runtime-validation), infrastructure/deployment analysis (use analyzing-operations), feature inventory/spec writing (use feature-inventory).
---

# Analyzing Architecture

## Purpose

Produce **only** artifacts that reduce a named failure mode. Anything that doesn't is excluded — it wastes agent context.

There are two artifact purposes:

- **Implementation fidelity**: behavior/contract fidelity to translate one unit correctly, plus seam contracts to integrate against the un-migrated remainder.
- **Design evidence**: evidence to decide unit count and splits — never pre-baked decisions.

## Required References

Each reference contains the YAML schema, extraction rules, and self-check for its artifact. Read all before starting the workflow.

| Reference | Artifact | What it provides |
|---|---|---|
| `references/unit-graph.md` | `unit_graph.yaml` | Schema for units, exported_signature, dynamic_entrypoints, shared_refs |
| `references/behavior.md` | `units/*/behavior.yaml` | Schema for side_effects, branches, error_paths, concurrency |
| `references/bindings.md` | `units/*/bindings.yaml` | Schema for framework wiring, runtime_config |
| `references/wire-contracts.md` | `wire_contracts.yaml` | Schema for external contracts, target_contract, semantic_divergence |
| `references/shared-modules.md` | `shared_modules.yaml` | Schema for god-class registry, fields with types, shared_refs relationship |
| `references/cross-unit-state.md` | `cross_unit_state.yaml` | Schema for implicit state flows, pairing values, verification_hint |
| `references/migration-boundary.md` | `migration_boundary.yaml` | Intent interpretation, must_rewrite with reasons, strategy rules |
| `references/seams.md` | `seams.yaml` | Schema for frozen_contract, bridge_points, declared vs inferred rules |
| `references/unit-decomposition.md` | `units/*/unit_decomposition.yaml` | Schema for candidate_splits, split-driver vocabulary |
| `references/project-structure.md` | `project-structure.md` | Functional domains, layers, project type — global prose view for planning/feature-inventory |
| `references/tech-stack.md` | `tech-stack.md` | Frameworks, deps, runtime versions, migration blockers — global prose view |
| `references/data-model.md` | `data-model.md` | Entity inventory, relationships, key-entities summary — global prose view |
| `references/extraction-signals.md` | (all artifacts) | Signal→artifact mapping, what to look for per signal area |
| `references/architecture-index.md` | `architecture_index.md` | Implementation Guide contract, per-unit navigation template |
| `references/consumption-contract.md` | (downstream) | How implementation agents read the artifacts |

## Design Principles

1. **Failure-mode-driven**: every field traces to a row in the Failure Mode Map (end of file). Can't name the failure it prevents → don't produce it.
2. **Source-loc as identifier**: `source_loc: path:line` is the natural ID. Never invent stable IDs.
3. **Self-contracting fields**: each field carries its consumption contract (`must_preserve`, `must_appear_in_target`) so the next agent needs no extra skill loaded.
4. **Per-unit sharding + global tables**: agents load one unit's small files plus global indexes, not a monolith.
5. **Extraction heuristics inline**: tell the executing LLM HOW to find data, not just the schema.
6. **Evidence, never fabricated numbers**: emit only values a tool actually computed, each with provenance. No invented composite scores, no made-up `confidence: 0.9`. Where confidence matters, report the *evidence basis* (`static` vs `static+runtime`), not a number nobody measured.
7. **Analyze observes; design decides**: candidate splits, candidate seams — never a committed unit count, never aggregates/BCs, never a priority ranking that pre-empts design's choice.
8. **Migration boundary is a first-class contract**: for rewrite/migration work, always identify the smallest runtime boundary that can satisfy the user's acceptance criteria. Expand to a full rewrite only when the user asks for clean removal/no legacy residue, or when technical constraints make a partial boundary unsafe. `source_anchors` are discovery evidence, not rewrite targets.
9. **Heuristic flag vs control gate**:
   - **Heuristic flags allowed**: a magic number that only *labels* something for design to re-check. Design sees the data and can overrule.
   - **Control gates forbidden**: a number that *changes what reaches the artifact set* (truncating candidates at a cap, skipping a flow below a floor). Replace with raw counts + per-row semantic contracts.
   - Classification vocabularies are *examples to recognize by judgment*, not closed enums to CI-validate.

## What is a "Unit"

A unit = one externally triggerable entry point (HTTP route, scheduled job, message handler, UI page, public API surface, CLI command). **Uniqueness invariant**: each source file appears in at most one unit's `source_anchors`. Files used by ≥2 units → `shared_modules.yaml`.

## The Artifacts

```
artifacts/
├── architecture_index.md          top-level implementation guide
├── project-structure.md         global prose, functional domains + layers + project type
├── tech-stack.md                global prose, frameworks + deps + runtime versions
├── data-model.md                global prose, entity inventory + key-entities summary
├── unit_graph.yaml              global index, lightweight
├── migration_boundary.yaml      global, minimal runnable boundary + rewrite scope contract
├── wire_contracts.yaml          global, outward contracts
├── shared_modules.yaml          global, files used by ≥2 units; god-class registry
├── cross_unit_state.yaml        global, implicit shared-state flows
├── seams.yaml                   global, partial-migration cut points + bridge design
└── units/<unit_name>/
    ├── behavior.yaml            per-unit, heavyweight
    ├── bindings.yaml            per-unit; may be [] + reason
    └── unit_decomposition.yaml  per-unit, CANDIDATES only, no commit
```


## Outputs

Base path: `{artifact_root}/` (typically `.github/modernize/rearchitecture/artifacts/`)

**Global artifacts** (1 each):
- `unit_graph.yaml` — always
- `migration_boundary.yaml` — rewrite/migration work
- `wire_contracts.yaml` — always
- `shared_modules.yaml` — always
- `cross_unit_state.yaml` — always
- `seams.yaml` — when seams exist (declared or inferred); omit file entirely if no seams found
- `architecture_index.md` (top-level implementation guide) — always
- `project-structure.md` (global prose: functional domains, layers, project type) — always
- `tech-stack.md` (global prose: frameworks, deps, runtime versions, migration blockers) — always
- `data-model.md` (global prose: entity inventory + key-entities summary) — when project has entities/ORM/DB access

**Per-unit artifacts** (one set per unit in `unit_graph.yaml`):
- `units/<unit_name>/behavior.yaml`
- `units/<unit_name>/bindings.yaml`
- `units/<unit_name>/unit_decomposition.yaml`

**Completeness invariant**: `count(units/*/behavior.yaml) == count(units in unit_graph.yaml)`.

For how downstream agents consume these artifacts, load `references/consumption-contract.md`.

---

`target_idiom` is NOT produced here — lives in `guidelines/<source>-to-<target>/`.

### Architecture index artifact — implementation guide

The top-level architect artifact is an **implementation index**, not a prose summary. It must tell implementation agents which artifact paths to read, why each matters, how to filter global rows, and what completion evidence to report.

Load `references/architecture-index.md` for the required `Implementation Guide` contract and example shape.

---

## Implementation-Fidelity Artifacts

Core artifacts:
- `unit_graph.yaml` (entry-point enumeration + `exported_signature` + `dynamic_entrypoints` + per-unit `shared_refs`). Load `references/unit-graph.md` for schema and self-check.
- `behavior.yaml` (side_effects, branches, error_paths, concurrency). Load `references/behavior.md` for schema.
- `bindings.yaml` (framework wiring + runtime_config). Load `references/bindings.md` for schema.
- `wire_contracts.yaml` (rest/grpc/kafka/sql/semantic_divergence). Load `references/wire-contracts.md` for schema and scope boundary.
- `shared_modules.yaml` (god-class registry: kind/used_by_units/fields/split_candidate). Load `references/shared-modules.md` for schema and `shared_refs` relationship.
- `cross_unit_state.yaml` (implicit session/ThreadLocal/SSO flows; per-row `must_confirm:runtime` for any unpaired flow). Load `references/cross-unit-state.md` for schema and `pairing` values.

### `migration_boundary.yaml` — minimal runnable boundary + rewrite scope contract

Records the smallest runtime-reachable implementation boundary that satisfies the user's acceptance criteria. Implementation scope comes from `must_rewrite`, not from all `source_anchors` or every legacy-framework file.

Load `references/migration-boundary.md` for intent interpretation rules, schema, and self-check.

### `seams.yaml` — partial-migration cut points + bridge design

Records deliberate cuts for partial migration: which side is frozen, which side migrates, and how the bridge converts protocols/idioms. `declared` seams are authoritative; `inferred` seams are advisory.

Load `references/seams.md` for schema, conditional `frozen_contract` rules, discovery signals, and self-check.

---

## Design-Evidence Artifact

### `units/<unit>/unit_decomposition.yaml` (per-unit)

Records split candidates for design. It produces `candidate_splits`, not target units; the design phase owns the decision.

Load `references/unit-decomposition.md` for schema and split-driver vocabulary.

---

## Workflow

1. **Load context** — source/target framework, existing KG, `guidelines/<source>-to-<target>/`, and any **user-declared seams** (cut points the user specified).
1b. **Load extraction signals** — read `references/extraction-signals.md` and map discovered signals into the structured artifacts.
1c. **Produce global prose views** — alongside the structured per-unit artifacts, emit `project-structure.md` (functional domains, layers, project type), `tech-stack.md` (frameworks, deps, runtime versions, migration blockers), and `data-model.md` (entity inventory + key-entities summary) per their reference schemas. These global views are consumed by creating-implementation-plan, feature-inventory, and the spec-quality gate; the structured YAML artifacts do not replace them.
2. **Build `unit_graph.yaml`** (spine). Resolve `exported_signature` from public signatures only. Seed `shared_modules.yaml` same pass; flag god-class + reference-cliff candidates.
2b. **Build `migration_boundary.yaml`** — infer user intent, acceptance criteria, cleanup requirement, and the smallest runtime-reachable rewrite boundary. Populate `must_rewrite`, `copy_as_is`, `legacy_allowed_to_remain`, and `defer_cleanup`. Only choose `full_rewrite` when user intent or technical evidence requires it; do not equate `source_anchors` with rewrite targets.
3. **Per-unit files — IMMEDIATELY after unit_graph, before global tables.** For EVERY unit listed in `unit_graph.yaml`, create `units/<unit_name>/behavior.yaml`, `units/<unit_name>/bindings.yaml`, and `units/<unit_name>/unit_decomposition.yaml`. Do not skip units. Do not create "representative samples". Do not defer to a later step. >~200 lines per file → re-examine the unit boundary. Populate `shared_refs` from subset whitelist. `unit_decomposition` sets `commit: false`.
3b. **Verify per-unit completeness before proceeding.** Run: count the units in `unit_graph.yaml` and count the `units/*/behavior.yaml` files. If they do not match, create the missing per-unit files NOW. Do not proceed to step 4 until every unit has all three files.
4. **Build `wire_contracts.yaml`** — outward edges; cross-ref unit_graph for external interfaces.
4b. **Build `cross_unit_state.yaml`** — scan medium patterns; pair across units only; per-row `must_confirm:runtime` on any unpaired flow.
4c. **Build `seams.yaml`** (skip if no declared or inferred seams exist) — emit every user-declared seam first (`source: declared`). Then add `inferred` seams from discovery signals. For each seam: record `frozen_side` + `frozen_side_rule` (always), and — where protocols differ — the `bridge_points` conversion design (mapping_rule + edge_cases + idempotency_retry + fallback). Add `frozen_contract` **only** when the migrating agent cannot read the frozen side's behavior from source (binary/private dependency, config/data-gated semantics, name-contradicts-behavior); when the frozen source is visible and self-explanatory, omit it — don't restate what the agent reads directly. Resolve declared/inferred conflicts toward declared.
4d. **Build the architecture index** — top-level architect artifact with an `Implementation Guide`. For each unit, list exact artifact paths, purpose of each file, how to filter global rows, and required completion evidence. Do not make it a prose-only summary.
5. **Self-check before completion** (hard — execute, do not skip):
   - **Per-unit completeness gate (MUST execute):** Count units in `unit_graph.yaml` (`grep -c '^\s*- name:' artifacts/unit_graph.yaml`). Count per-unit behavior files (`ls artifacts/units/*/behavior.yaml | wc -l`). If counts do not match, list missing units and create their behavior.yaml, bindings.yaml, and unit_decomposition.yaml NOW. Do not report done until counts match. "Representative samples" or "most controllers follow identical patterns" is NOT acceptable — every unit gets all three files.
   - Every unit in `unit_graph` has behavior/bindings/decomposition files.
   - `migration_boundary.yaml` exists for rewrite/migration work; `must_rewrite` is the implementation scope; `source_anchors` are not treated as rewrite targets.
   - The architecture index contains an `Implementation Guide` for every unit, with exact artifact paths, purpose, row-filter instructions, and completion evidence requirements.
   - The architecture index explicitly states that it is not the full contract and implementation agents must follow the listed artifact paths before implementation.
   - No `TBD` in `wire_contracts.yaml::target_contract`, `seams.yaml::frozen_contract` target form, or `seams.yaml::bridge_points[].mapping_rule`.
   - No source file in `source_anchors` of multiple units.
   - Every produced field maps to a Failure Mode Map row.
   - `unit_decomposition.commit == false`.
   - Every `shared_refs.used_fields ⊆ {f.name for f in shared_modules.fields}`.
   - Every `cross_unit_state` flow with `pairing != matched` carries `must_confirm: runtime`.
   - **Every `declared` seam present; every seam has a `frozen_side_rule`; `frozen_contract` present only where the frozen source is invisible/unrecoverable; every `protocol_shift != null` seam has ≥1 `bridge_point` with concrete `mapping_rule` (no `TBD`).**

## Rules

- No prose narrative artifacts. Reasoning lives in `notes:` / `rationale:`.
- No stable IDs. `source_loc: path:line` is the identifier.
- No tests / build / deploy / infra coverage. No standalone risk register. No `target_idiom.yaml`.
- Per-unit files capped at ~200 lines. Larger → split.
- `TBD` forbidden in wire contract `target_contract`, seam `frozen_contract` target form, and seam `mapping_rule`.
- `unit_decomposition.yaml` MUST set `commit: false`.
- Factual numbers (line numbers, counts, lists) recorded as-is. Quality/cohesion values MUST be tool-computed with provenance; inventing scores is a hard failure.
- A **`declared` seam is authoritative** — design may not overrule it; an `inferred` seam is a candidate.
- The **frozen side of a seam MUST NOT be refactored** in the migrating phase; the bridge adapts to it, not the reverse.
- **Implementation scope comes from `migration_boundary.yaml::must_rewrite`**, not from `unit_graph.source_anchors`, all files of the old framework, or inventory lists. `source_anchors` prove behavior exists; they do not mandate rewriting that file.
- Classification lists are vocabularies for judgment, not CI-enforced enums.

---

## Failure Mode Map

| # | Failure mode | Prevented by |
|---|---|---|
| 1 | Dropped side-effect | `behavior.yaml::side_effects[must_preserve]` |
| 2 | Dropped framework binding | `bindings.yaml::bindings[must_appear_in_target]` |
| 3 | Hallucinated target API | `guidelines/<source>-to-<target>/` (out of scope) |
| 4 | Broken caller (signature unsync) | `unit_graph.yaml::depends_on` + `exported_signature` |
| 5 | Dead-code removal of reflection/DI class | `unit_graph.yaml::dynamic_entrypoints` |
| 6 | Wire contract break | `wire_contracts.yaml::stability:frozen + target_contract` |
| 7 | Tx boundary lost | `behavior.yaml::concurrency.tx_boundary` |
| 8 | Cross-language semantic gotcha | `wire_contracts.yaml::semantic_divergence` |
| 9 | Missing runtime config | `bindings.yaml::runtime_config[must_appear_in_target]` |
| 10 | Significant branch dropped | `behavior.yaml::branches[must_preserve]` |
| 11 | Error contract drift | `behavior.yaml::error_paths[contract + must_preserve]` |
| 12 | Shared module duplicated/lost | `shared_modules.yaml::migration_strategy` |
| 13 | Concurrency model mismatch | `behavior.yaml::concurrency.model` |
| 14 | Implicit cross-unit state lost | `cross_unit_state.yaml::flows[must_preserve]` |
| 15 | Static pairing missed dynamic key / external writer | `cross_unit_state.yaml::pairing + must_confirm:runtime` |
| 16 | God-class field drift / hallucinated fields | `shared_modules.yaml::god_class + shared_refs.used_fields ⊆` |
| 17 | Premature commit to target unit count | `unit_decomposition.yaml::commit:false + candidate_splits` |
| 18 | Split candidate without driver/rationale | `unit_decomposition.yaml::candidate_splits[].drivers + rationale` |
| 19 | Fabricated score/confidence misleads design | Principle 6 + self-check: no composite_score |
| 20 | **Partial-migration cut breaks at the seam (an *unreadable* frozen-side semantic — binary dep, config-gated, or name-contradicts-behavior — never recorded)** | **`seams.yaml::frozen_contract[must_preserve]`, conditional: only when source is invisible/unrecoverable** |
| 21 | **Frozen side refactored, breaking un-migrated peers** | **`seams.yaml::frozen_side_rule`** |
| 22 | **Protocol-shift conversion left to the migrating agent's guess (wrong mapping/edge cases)** | **`seams.yaml::bridge_points[mapping_rule + edge_cases + idempotency_retry + fallback]`** |
| 23 | **User-specified cut point silently overruled by analyze** | **`seams.yaml::source:declared` authoritative rule** |
| 24 | **Inventory-driven over-rewrite: every discovered framework file or `source_anchor` becomes an implementation task, even though a smaller runtime boundary satisfies acceptance** | **`migration_boundary.yaml::{strategy,must_rewrite,legacy_allowed_to_remain}` + rule: source_anchors are not rewrite targets** |
| 25 | **User asked for clean/full rewrite but analyze silently leaves legacy runtime residue** | **`migration_boundary.yaml::{user_intent.cleanup_required,full_rewrite_reason}`** |

## NOT Included

- Test coverage map — tester / runtime-validation
- Build / packaging / deploy topology — `analyzing-operations`
- Performance baseline — cutover phase
- Standalone risk register — inline `notes` / `stability`
- Architecture summary prose — implementation agents need source-anchored contracts, not prose-only summaries
- Idiom mapping — `guidelines/<source>-to-<target>/`
- Function-level call graph beyond unit boundaries — `exported_signature` suffices
- **Cohesion metrics / co-access clusters (LCOM4/TCC)** — structural numbers did not change design decisions. God-class smells live on `shared_modules.yaml::split_candidate`.
- Pure syntax migration (Py2→3, Java 8→17)
- **Target unit count commitment** — design phase
- **Aggregate / BC / VO decisions, domain renames, migration sequencing** — design phase + human EventStorming
- **Composite/priority scores, decision gate ratios** — design weighs evidence with full context

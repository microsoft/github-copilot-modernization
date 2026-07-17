# Consumption Contract — How Downstream Agents Read Architecture Artifacts

This reference defines how implementation/design/review agents consume the artifacts produced by `analyzing-architecture`. The architect produces; downstream reads by following this contract.

## Artifact Root

All paths below are relative to `{artifact_root}/` (typically `.github/modernize/rearchitecture/artifacts/`).

## Reading Strategy by Role

### Implementation agent (assigned unit X)

**Must read before writing any code:**

1. `unit_graph.yaml` — filter to unit X:
   - `source_anchors` → source files to understand (NOT rewrite targets — see `migration_boundary.yaml::must_rewrite` for scope)
   - `depends_on` + `exported_signature` → call sites to preserve; `stability: frozen` signatures must keep exact shape in target
   - `dynamic_entrypoints` → do not dead-code-eliminate these
   - `shared_refs` → per-unit subset of shared modules this unit uses; `used_fields` names must ⊆ `shared_modules[module].fields[].name`

2. `migration_boundary.yaml`
   - `must_rewrite` → the files/modules in implementation scope
   - `copy_as_is` → leave untouched
   - `legacy_allowed_to_remain` → acceptable residue
   - Rule: implementation scope = `must_rewrite`, NOT `source_anchors`

3. `shared_modules.yaml` — rows where `used_by_units` includes X:
   - `migration_strategy` → how to handle (extract, wrap, split)
   - `shared_refs.used_fields` → only these fields are your concern (subset whitelist)
   - God-class entries → respect `split_candidate` guidance

4. `units/X/behavior.yaml`
   - `side_effects` where `must_preserve: true` → each must appear in target
   - `branches` where `must_preserve: true` → each branch path preserved
   - `error_paths` → preserve `contract` and `must_preserve` items
   - `concurrency.tx_boundary` → replicate transaction scope

5. `units/X/bindings.yaml`
   - `bindings` where `must_appear_in_target: true` → wire in target framework
   - `runtime_config` where `must_appear_in_target: true` → externalize config

**Filter remaining global artifacts for unit X:**

6. `wire_contracts.yaml` — rows where unit field matches X:
   - `stability: frozen` → preserve exact contract shape
   - `target_contract` → required target-side signature
   - `semantic_divergence` → cross-language gotchas to handle

7. `cross_unit_state.yaml` — flows where `writer.unit == X` or `reader.unit == X`:
   - `must_preserve: true` → replicate the state-passing mechanism
   - `pairing != matched` + `must_confirm: runtime` → flag for runtime verification

8. `seams.yaml` — cuts touching X:
   - `source: declared` → authoritative, do not change frozen side
   - `frozen_side_rule` → which side you must not modify
   - `bridge_points` → use `mapping_rule` for conversion; handle `edge_cases`
   - `frozen_contract` (when present) → the frozen side's behavior you cannot read from source

**Optional (do not treat as binding):**

9. `units/X/unit_decomposition.yaml`
   - `candidate_splits` — advisory only (`commit: false`)
   - Design may have already resolved these; check design artifacts first

### Design agent

1. Read `unit_graph.yaml` (all units) — unit count, dependencies, boundaries
2. Read `units/*/unit_decomposition.yaml` — candidate splits + drivers
3. Read `shared_modules.yaml` — god-class entries inform split decisions
4. Read `seams.yaml` — declared seams constrain design choices
5. Design owns: final unit count, split decisions, sequencing, domain naming

### Review / gate agent

Verify completeness by checking:
- `ls units/*/behavior.yaml | wc -l` == unit count in `unit_graph.yaml`
- Every unit has `bindings.yaml` and `unit_decomposition.yaml`
- `migration_boundary.yaml` exists (for rewrite/migration work)
- Architecture index contains `Implementation Guide` with per-unit entries
- Architecture index states it is not the full contract
- No `TBD` in `wire_contracts.yaml::target_contract`, `seams.yaml::frozen_contract` target form, or `seams.yaml::bridge_points[].mapping_rule`
- No source file appears in `source_anchors` of multiple units
- Every `unit_decomposition.yaml` has `commit: false`
- Every `shared_refs[].used_fields ⊆ {f.name for f in shared_modules[module].fields}`
- Every `cross_unit_state` flow with `pairing != matched` carries `must_confirm: runtime`
- Every `declared` seam present; every seam has `frozen_side_rule`
- Every `protocol_shift != null` seam has ≥1 `bridge_point` with concrete `mapping_rule` (no TBD)

## Relationship to Architecture Index

The **architecture index** (produced artifact) is a run-specific navigation file: it lists exact paths and per-unit reading instructions for a specific codebase's artifacts.

This **consumption contract** (reference file) defines the general field-level semantics: what each field means, which are hard contracts, how to filter global rows. Implementation agents use both:
1. Architecture index → find artifact paths for their assigned unit
2. Consumption contract → understand field semantics and consumption rules

## Key Rules for Consumers

1. **`source_anchors` ≠ rewrite targets.** Implementation scope comes from `migration_boundary.yaml::must_rewrite`.
2. **`must_preserve` / `must_appear_in_target` are hard contracts.** Missing one = failure mode triggered (see Failure Mode Map in SKILL.md).
3. **`commit: false` in unit_decomposition is real.** Do not treat candidate splits as decided structure.
4. **`declared` seams are authoritative.** Do not refactor the frozen side.
5. **Filter global artifacts to your unit.** Do not read all rows; use unit-name matching fields (`used_by_units`, `unit`, `writer.unit`/`reader.unit`, `cut_between`).
6. **Architecture index is a navigation aid, not the full contract.** Always follow the artifact paths it lists and read the actual YAML files.

# shared_modules.yaml — Cross-Unit Shared Code Registry

Records source files/modules used by ≥2 units. Prevents duplication, god-class field drift, and hallucinated fields during migration.

## Schema

```yaml
modules:
  - name: <module_name>                    # logical name for the shared module
    kind: <utility|base-class|dto|config|god-class|store|mixin>
    source_loc: "<path:line>"
    used_by_units:                         # which units reference this module
      - <unit_name>
    fields:                                # all public/accessible fields/methods with types
      - name: <field_or_method_name>
        type: "<fully.qualified.Type or primitive>"
    god_class: <true|false>                # true when the module has too many responsibilities
    split_candidate: <true|false>          # true when god_class or high fan-out suggests splitting
    migration_strategy: <extract|wrap|split|copy|inline>
      # extract: pull into its own module/package
      # wrap: wrap behind an interface for the target
      # split: break into cohesive pieces (when god_class/split_candidate)
      # copy: copy as-is (stable utility)
      # inline: inline into consuming units (small, single-purpose)
    notes: "<rationale for strategy choice>"
```

## Relationship to Per-Unit `shared_refs`

Each unit's `shared_refs` in `unit_graph.yaml` is a **subset whitelist** of this file:
- `shared_refs[].module` must match a `name` in this file.
- `shared_refs[].used_fields` must be a subset of this file's `fields` for that module.

This two-level design ensures:
1. The global file is the single source of truth for what the module contains.
2. Each unit declares only the fields it actually uses (preventing hallucinated field access).

**Self-check constraint**: `∀ unit U, ∀ ref in U.shared_refs: ref.used_fields ⊆ {f.name for f in shared_modules[ref.module].fields}`

## Key Fields

- **`god_class`**: flags modules with too many responsibilities. Prevents Failure Mode 16 (god-class field drift).
- **`split_candidate`**: advisory flag for design phase. Does not trigger automatic splitting — design decides.
- **`migration_strategy`**: how to handle during migration. This is a recommendation, not a gate.
- **`used_by_units`**: the filter key. Implementation agent for unit X reads rows where `used_by_units` includes X.

## Self-Check

- Every module listed in any unit's `shared_refs` exists in this file.
- No module has `used_by_units` with only one unit (by definition, shared = ≥2).
- Every `god_class: true` module has `split_candidate: true`.
- `fields` lists are non-empty.

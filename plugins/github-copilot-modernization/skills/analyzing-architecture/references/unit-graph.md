# unit_graph.yaml — Global Unit Index

The spine of all architecture artifacts. Every per-unit artifact set and every global-artifact filter key derives from this file.

## Schema

```yaml
units:
  - name: <unit_name>                      # kebab-case, unique across the graph
    trigger: <route|job|handler|page|api|cli>  # external trigger category
    trigger_detail: "<HTTP verb + path, cron expression, queue name, etc.>"
    source_anchors:                         # files that prove this unit exists — NOT rewrite targets
      - path: <relative/path>
        line: <int>                         # optional entry-point line
    exported_signature:                     # public signatures other units depend on
      - method: "<return_type ClassName.method(params)>"
        source_loc: "<path:line>"
        stability: <frozen|must_preserve|may_change>  # frozen = exact shape required by callers
    dynamic_entrypoints:                    # classes/methods reached only via reflection, DI, XML, or convention
      - target: "<fully.qualified.Class>"
        mechanism: <reflection|di|xml-config|convention|annotation-scan>
        source_loc: "<path:line>"           # where the dynamic reference is declared
    depends_on:                             # other units this unit calls
      - unit: <other_unit_name>
        via: "<method or contract>"
    shared_refs:                            # per-unit subset of shared_modules this unit uses
      - module: <shared_module_name>        # must exist in shared_modules.yaml
        used_fields:                        # subset; names must ⊆ shared_modules[module].fields[].name
          - <field_name>
```

## Key Fields

- **`name`**: the join key used by all per-unit directories (`units/<name>/`) and global-artifact row filters (`used_by_units`, `unit`, `writer.unit`/`reader.unit`, `cut_between`).
- **`source_anchors`**: evidence that a unit exists. Rule: `source_anchors ≠ rewrite targets`. Implementation scope comes from `migration_boundary.yaml::must_rewrite`.
- **`exported_signature`**: resolved from public method/route signatures only. Prevents Failure Mode 4 (broken caller / signature unsync).
- **`dynamic_entrypoints`**: anything reached via reflection, DI container scan, XML bean definition, naming convention, or annotation processing. Prevents Failure Mode 5 (dead-code removal of reflection/DI class). Include the `mechanism` so the implementation agent knows *how* the class is discovered.
- **`shared_refs`**: this is where per-unit shared-module usage lives. Each entry points to a module in `shared_modules.yaml` and lists the subset of fields this unit actually uses. Self-check constraint: `shared_refs[].used_fields ⊆ {f.name for f in shared_modules[module].fields}`.
- **`depends_on`**: inter-unit call edges. Combined with `exported_signature`, this lets the implementation agent preserve call-site contracts.

## Uniqueness Invariant

Each source file appears in at most one unit's `source_anchors`. Files used by ≥2 units belong in `shared_modules.yaml`.

## Self-Check

```bash
# unit count (used by per-unit completeness gate)
grep -c '^\s*- name:' artifacts/unit_graph.yaml

# no duplicate source_anchors across units
grep 'path:' artifacts/unit_graph.yaml | sort | uniq -d
# expect: empty output
```

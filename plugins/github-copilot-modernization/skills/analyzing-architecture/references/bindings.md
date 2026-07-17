# bindings.yaml — Per-Unit Framework Wiring & Runtime Config

Records framework-specific wiring (annotations, XML config, DI registrations, route declarations) and externalized runtime configuration that must appear in the target. Per-unit file: `units/<unit_name>/bindings.yaml`.

## Schema

```yaml
unit: <unit_name>
bindings:
  - type: <annotation|xml-config|di-registration|route-declaration|filter|interceptor|listener|convention>
    name: "<binding name or annotation>"
    source_loc: "<path:line>"
    target: "<class or method being bound>"
    must_appear_in_target: <true|false>    # true = implementation must wire this in target framework
    notes: "<framework-specific semantics>"
runtime_config:
  - key: "<config key / property name>"
    source_loc: "<path:line>"             # where it's read
    source: <properties-file|xml|env|annotation|code>
    default_value: "<default if any>"
    must_appear_in_target: <true|false>
    notes: "<what this config controls>"
```

## Key Fields

- **`bindings[].must_appear_in_target`**: when true, the implementation agent must create equivalent wiring in the target framework. Prevents Failure Mode 2 (dropped framework binding). The *form* will differ (e.g., Struts XML → Spring Boot annotation), but the *effect* must be preserved.
- **`bindings[].type`**: what kind of framework wiring. Helps the implementation agent find the right target-framework equivalent.
- **`runtime_config[].must_appear_in_target`**: when true, this config must be externalized in the target. Prevents Failure Mode 9 (missing runtime config).

## Scope Boundary

- **Included**: framework annotations/decorators, XML/YAML config bindings, DI container registrations, route/filter/interceptor/listener declarations, property/env-var references.
- **Excluded**: business logic (→ `behavior.yaml`), external API contracts (→ `wire_contracts.yaml`), ORM entity mappings that are purely internal data access (unless they define a cross-service data contract).

## Empty Bindings

When a unit has no framework wiring (rare — usually means it's a pure domain unit), produce `bindings: []` with a `reason` field explaining why:

```yaml
unit: pure_domain_calculator
bindings: []
reason: "No framework annotations or DI wiring — pure computation with no framework coupling."
runtime_config: []
```

## Self-Check

- Every unit in `unit_graph.yaml` has a `bindings.yaml` file (even if `bindings: []`).
- Every `must_appear_in_target: true` binding has a non-empty `name` and `source_loc`.

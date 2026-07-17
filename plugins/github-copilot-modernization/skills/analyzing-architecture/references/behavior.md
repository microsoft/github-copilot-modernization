# behavior.yaml — Per-Unit Behavior Contract

The heavyweight per-unit artifact. Records all externally observable behavior: side effects, conditional branches, error paths, and concurrency semantics. Implementation agents use this as the primary fidelity contract — every `must_preserve: true` item must appear in the target.

Per-unit file: `units/<unit_name>/behavior.yaml`.

## Schema

```yaml
unit: <unit_name>
side_effects:
  - source_loc: "<path:line>"
    effect: "<what happens — write, notification, cache mutation, audit log, external call>"
    must_preserve: <true|false>            # true = must appear in target (Failure Mode 1)
branches:
  - source_loc: "<path:line>"
    condition: "<the branching condition>"
    behavior: "<what happens on this branch — redirect, validation message, state change>"
    must_preserve: <true|false>            # true = branch path must be preserved (Failure Mode 10)
error_paths:
  - source_loc: "<path:line>"
    trigger: "<what causes the error — timeout, validation failure, null input>"
    outcome: "<user-visible result — error page, status code, retry, fallback>"
    contract: "<external contract if any — HTTP status, error response shape, exception type>"
    must_preserve: <true|false>            # true = error contract must be preserved (Failure Mode 11)
concurrency:
  model: <sync|async|reactive|thread-pool|event-loop|coroutine>
    # the concurrency model used by this unit (Failure Mode 13)
  tx_boundary:                             # transaction scope (Failure Mode 7)
    source_loc: "<path:line>"
    scope: "<what's inside the transaction — which operations are atomic>"
    isolation: "<isolation level if specified>"
    must_preserve: <true|false>
```

## Key Fields

- **`side_effects[].must_preserve`**: when true, the effect must exist in target code. Prevents Failure Mode 1 (dropped side-effect). Common examples: audit log writes, notification sends, cache invalidations.
- **`branches[].must_preserve`**: when true, the conditional path must be replicated. Prevents Failure Mode 10 (significant branch dropped). Focus on user-visible branching — not every `if` statement.
- **`error_paths[].contract`**: the external-facing error contract (HTTP status code, error response shape, exception type thrown to callers). Prevents Failure Mode 11 (error contract drift). May be empty for internal-only error handling.
- **`concurrency.model`**: the threading/async model. Prevents Failure Mode 13 (concurrency model mismatch). Critical when migrating between sync and async frameworks.
- **`concurrency.tx_boundary`**: transaction scope — which operations are atomic. Prevents Failure Mode 7 (tx boundary lost). Record the actual scope, not just "uses transactions".

## Size Cap

Per-unit behavior files are capped at ~200 lines. If a unit's behavior exceeds this, re-examine the unit boundary — it may need splitting (see `unit_decomposition.yaml`).

## Self-Check

- Every unit in `unit_graph.yaml` has a `behavior.yaml` file.
- Every `must_preserve: true` item has a `source_loc`.
- `concurrency` block is present when the unit uses transactions, async patterns, or thread pools.

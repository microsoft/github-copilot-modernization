# cross_unit_state.yaml — Implicit Shared-State Flows

Records implicit state passing between units: session attributes, ThreadLocal, SSO tokens, request-scoped data, static/singleton state, framework-managed context. These are invisible contracts that break silently when one side is migrated.

## Schema

```yaml
flows:
  - name: "<descriptive flow name>"
    medium: <session|threadlocal|static|cookie|http-header|jwt-claim|request-attribute|framework-context|database|cache|distributed-cache|file>
    key: "<state key or field name>"
    writer:
      unit: <unit_name>
      source_loc: "<path:line>"
    reader:
      unit: <unit_name>                    # different unit than writer
      source_loc: "<path:line>"
    pairing: <matched|unmatched-reader|unmatched-writer|dynamic-key|external-writer>
      # matched: both writer and reader found in analyzed units
      # unmatched-reader: reader found but writer not in any analyzed unit
      # unmatched-writer: writer found but reader not in any analyzed unit
      # dynamic-key: key is constructed dynamically; static analysis cannot pair
      # external-writer: state written by external system (SSO, reverse proxy, etc.)
    must_preserve: <true|false>
    must_confirm: <runtime|null>           # required when pairing != matched
    verification_hint: "<what to check at runtime — e.g., log entry, trace span, integration test assertion>"
    notes: "<how the state flows, edge cases>"
```

## Key Fields

- **`medium`**: how state is passed. Critical for migration — different target frameworks handle these differently (e.g., `threadlocal` may not exist in async/reactive targets).
- **`pairing`**: whether static analysis found both ends of the flow.
  - `matched` — both sides identified, flow is fully understood.
  - `unmatched-reader` / `unmatched-writer` — one end missing from analysis. Requires `must_confirm: runtime`.
  - `dynamic-key` — key is computed at runtime, cannot statically pair. Requires `must_confirm: runtime`.
  - `external-writer` — state injected by something outside the codebase (SSO provider, reverse proxy headers, etc.). Requires `must_confirm: runtime`.
- **`must_confirm: runtime`**: hard flag — this flow must be verified with runtime testing because static analysis cannot guarantee correctness. Prevents Failure Mode 15.
- **`must_preserve`**: when true, the state-passing mechanism must be replicated in the target. Prevents Failure Mode 14.

## Filter Key

Implementation agent for unit X reads flows where `writer.unit == X` or `reader.unit == X`.

## Self-Check

- Every flow with `pairing != matched` carries `must_confirm: runtime`.
- Every flow has valid `writer.unit` and `reader.unit` that exist in `unit_graph.yaml` (or are marked external).
- No duplicate flows (same writer + reader + key).

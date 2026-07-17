# wire_contracts.yaml — External Interface Contracts

Records outward-facing contracts: REST/SOAP/GraphQL/gRPC endpoints, message queues, SQL/data interfaces, and cross-language semantic traps. Implementation agents use this to preserve exact API shapes and catch semantic divergence.

## Schema

```yaml
contracts:
  - name: "<descriptive contract name>"
    unit: <unit_name>                      # join key to unit_graph; may be "global" for app-wide contracts
    type: <rest|soap|graphql|grpc|kafka|jms|rabbitmq|sql|file|sdk>
    stability: <frozen|must_preserve|may_change>
    source_loc: "<path:line>"
    contract:                              # wire shape
      method: "<HTTP verb or RPC method>"  # when applicable
      path: "<route or queue/topic name>"
      request: "<schema summary or DTO>"
      response: "<schema summary or DTO>"
      error: "<error contract / status codes>"
      auth: "<auth mechanism if part of wire contract>"
    target_contract:                       # required target-side form; TBD forbidden
      method: "<target method signature>"
      notes: "<mapping notes>"
    semantic_divergence:                   # cross-language / cross-framework gotchas
      - field: "<field name>"
        issue: "<what differs between source and target semantics>"
        source_loc: "<path:line>"
```

## Key Fields

- **`unit`**: the filter key. Implementation agent for unit X reads only rows where `unit == X` (or `unit == global`).
- **`stability: frozen`**: this contract shape must be preserved exactly (Failure Mode 6).
- **`target_contract`**: the required target-side signature. `TBD` is forbidden — if the target form cannot be determined during analysis, the seam/bridge must handle it.
- **`semantic_divergence`**: cross-language gotchas (e.g., Java `null` vs Kotlin non-null, date format drift, enum ordinal vs name). Prevents Failure Mode 8.

## Scope Boundary

- **Included**: REST, SOAP, GraphQL, gRPC, message queues (Kafka/JMS/RabbitMQ/SQS), SQL contracts (stored procedures, cross-service queries), file/SDK integration contracts.
- **Excluded**: internal method calls within a unit (those are `behavior.yaml`), ORM entity mappings (those are `bindings.yaml` unless they define a cross-service data contract), deploy/infra topology.

## Self-Check

- Every `stability: frozen` row has a non-TBD `target_contract`.
- Every row has a valid `unit` that exists in `unit_graph.yaml` (or is `global`).
- `semantic_divergence` entries have `source_loc`.

# Seams Artifact

This reference defines `seams.yaml`, the partial-migration cut-point and bridge-design contract.

### `seams.yaml` — partial-migration cut points + bridge design

**Prevents**: the dominant partial-migration failure — a migrated unit silently breaks where it meets the un-migrated remainder, because the *cut point*, *which side is frozen*, and the *conversion rule* were never recorded. wire_contracts records outward contracts and cross_unit_state records implicit state; **seams records the deliberate knife — where you cut, which side is frozen, and how the bridge converts across it.**

**A seam is a one-place model of a cut.** Each seam answers: where is the cut, what is on each side, which side is frozen (must NOT be refactored), and — when the two sides speak different protocols/idioms — the exact conversion the bridge performs.

**What a seam adds that reading the source does not.** Validated empirically (cargotracker routing closed-loop): when the frozen side's source is **visible**, any migrating agent that reads it recovers the behavioral contract on its own — re-stating it as a `frozen_contract` is redundant. The seam's irreducible value is the two things grep/read cannot give you:
- `frozen_side_rule` — the *decision* that this side is frozen and must NOT be refactored/recompiled. Not in the source; it's a phase boundary the architect declares.
- `bridge_points` — the *protocol/idiom conversion design* across the cut (param decomposition, response reconstruction, edge-case handling). A design commitment, not a fact extractable from either side.

`frozen_contract` is therefore **conditional, not standard issue** (see field rule below).

**Two sources — `declared` is authoritative, `inferred` is advisory**:
- `declared`: user/architect specified this cut point. Authoritative — design may NOT overrule it.
- `inferred`: analyze discovered a likely seam. Advisory — a candidate for design/user to confirm.
- On conflict (a declared seam contradicts an inferred one), `declared` wins; drop or fold the inferred row, note it.

**Discovery signals for `inferred` seams** (recognize by judgment, provenance not a gate): protocol boundary (rpc↔rest, sync↔async), framework boundary (Struts action ↔ Spring controller), layer boundary where you intend to keep the old service, external-system edge, and the **reference cliff** in `shared_modules.yaml` (a shared module heavily used on one side, barely on the other).

```yaml
seams:
  - id: src/com/acme/inventory/InventoryService.java:1   # cut point = natural ID
    description: "Order service migrated to REST; inventory stays on legacy gRPC, frozen."
    source: declared                       # declared (authoritative) | inferred (advisory)
    cut_between:
      migrated_side: unit_order_create     # being rewritten now
      frozen_side: legacy_inventory        # stays as-is this phase
    protocol_shift: {from: grpc, to: rest} # null when same protocol — bridge is then a thin adapter
    frozen_side_rule: "legacy_inventory MUST NOT be refactored or recompiled this phase."
    frozen_contract:                       # CONDITIONAL — emit ONLY when the frozen side's source is NOT visible to the migrating agent, OR a semantic cannot be recovered from the source it can read (private/obfuscated binary dependency, behavior gated by config/data not in source, a contract the public name contradicts). When the frozen source IS visible and self-explanatory, OMIT this — the migrating agent reads it directly; restating it here is redundant context cost. Default to omitting.
      - method: "reserve(orderId: string, items: Item[]) -> ReservationResult"
        source_loc: InventoryService.java:88
        semantics: >
          synchronous; throws InsufficientStockException(stockShortfall);
          idempotent on orderId (re-reserve returns same ReservationResult).
        must_preserve: true
    bridge_points:                         # the conversion design — ARCHITECT commits it; migrating agent does not invent it
      - at: "order_create → inventory call site, OrderController.java:142"
        from_form: "gRPC InventoryService.Reserve(ReserveRequest{order_id, repeated Item})"
        to_form:   "POST /legacy/inventory/reservations  body={orderId, items[]}"
        mapping_rule: >
          ReserveRequest.order_id → body.orderId;
          repeated Item{sku,qty} → items[]{sku,qty};
          ReservationResult.reservation_id → 201 Location header.
        edge_cases:
          - "empty items → 400 (NOT gRPC INVALID_ARGUMENT passthrough)"
          - "InsufficientStockException → 409 with {sku, shortfall}"
        idempotency_retry: "orderId is the idempotency key; bridge dedupes; safe to retry the POST."
        fallback: "bridge timeout → surface 504; do NOT auto-retry the write."
        must_preserve: true
```

**Self-check**: every `declared` seam present; every seam has a `frozen_side_rule`; `frozen_contract` present **only** where the frozen source is invisible/unrecoverable (absent otherwise — its absence is correct, not a gap); every `protocol_shift != null` seam has ≥1 `bridge_point` with a concrete `mapping_rule` (no `TBD`); declared/inferred conflicts resolved in favor of declared.


# Unit Decomposition Artifact

This reference defines `units/<unit>/unit_decomposition.yaml`, the split-candidate artifact for design.

### `units/<unit>/unit_decomposition.yaml` (per-unit)

**Prevents**: analyze prematurely committing to target unit count; design losing the rationale for split candidates.

**Hard rule**: produces `candidate_splits`, NOT `target_units`. Whole file is design-owned (`commit: false`, self-checked); no per-row decision markers.

**Split drivers — recognize these** (vocabulary; ≥1 per candidate, classify by judgment):
```
protocol_split  concern_split  execution_model_split  lifecycle_split
reuse_split  data_ownership_split  change_cadence_split  nfr_split
```

```yaml
unit: order_processing
commit: false                          # HARD: self-checked. Whole file is candidates, not decisions.
candidate_splits:
  - id: src/com/acme/order/OrderAction.java:42-120
    drivers: [concern_split, execution_model_split]
    rationale: >                       # MANDATORY ≥40 chars; self-checked
      handleRequest interleaves synchronous validation (42-78) with async inventory
      reservation (80-120): two execution models, two failure semantics.
    source_slice: {file: src/com/acme/order/OrderAction.java, lines: [42, 120]}

# _meta only when candidate count is unusually high (smell, NOT a truncation trigger):
# _meta: {candidate_count: 11, note: "high split count — unit likely under-defined; revisit boundary"}
```

**No `composite_score`**: ranking candidates is design's job — it has cross-unit/strategic context analyze lacks. Emit **all** candidates with drivers+rationale.

Cohesion machinery such as LCOM4/TCC, co-access clusters, and method-field matrices is not produced here. Structural numbers did not change design decisions. Candidate seams belong in `seams.yaml`; field-level cohesion concerns, when real, surface as `split_candidate` on `shared_modules.yaml`.

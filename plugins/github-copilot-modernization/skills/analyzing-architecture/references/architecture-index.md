# Architecture Index Artifact

This reference is loaded from `SKILL.md` when producing the top-level architecture/index artifact for implementation agents.

### Architecture index artifact — implementation guide

The top-level architect artifact is an **implementation index**, not a prose summary. Its filename should be `architecture_index.md` in the artifact root. Implementation agents discover it by this name.

It MUST include an `Implementation Guide` section. For every implementation unit, list:
- assigned unit name plus external trigger (route, API, message, job, CLI command, or public surface)
- exact artifact paths to read for that unit, expressed relative to the artifact root
- what each artifact is used for: behavior, bindings, wire contracts, shared modules, cross-unit state, seams, migration boundary, or split candidates
- how to filter global rows for the unit (for example by `used_by_units`, `flows`, `cut_between`, or equivalent fields)
- completion evidence required from the implementation agent: artifact paths read, implemented `must_preserve` items, unresolved/deferred contracts, and tests/build/runtime evidence

The index MUST say explicitly: "This index is not the full contract. Do not implement from this file alone; follow the artifact paths below."

Example shape (file names are illustrative; use the actual produced paths):

```markdown
## Implementation Guide

### Global artifacts
- `<unit_graph artifact>`
  - who reads: all implementation workers
  - use for: unit boundary, entrypoints, dependencies, exported signatures, shared refs
  - how to consume: find your assigned unit; follow its source anchors, shared refs, and dynamic entrypoints
- `<migration boundary artifact>`
  - who reads: all implementation workers
  - use for: implementation scope (must_rewrite vs copy_as_is vs legacy_allowed_to_remain)
  - how to consume: check must_rewrite for your unit's files; source_anchors are NOT rewrite targets
- `<wire contracts artifact>`
  - who reads: workers touching external/API calls
  - use for: request/response/error contracts, semantic divergence warnings
  - how to read: filter rows where unit matches your assigned unit
- `<shared modules artifact>`
  - who reads: workers whose unit references shared code
  - use for: migration strategy, field subset whitelist, god-class awareness
  - how to read: filter rows where used_by_units includes your unit
- `<cross-unit state artifact>`
  - who reads: workers whose unit reads or writes implicit shared state
  - use for: session/ThreadLocal/static state flows, must_confirm:runtime flags
  - how to read: filter flows where writer.unit or reader.unit matches your unit
- `<seams artifact>` (when present)
  - who reads: workers whose unit touches a migration cut point
  - use for: frozen side rules, bridge point mapping, declared vs inferred seam authority
  - how to read: filter cuts where cut_between includes your unit

### Unit: <unit_name>
- external trigger: <route/API/job/etc.>
- must read:
  - `<unit behavior artifact>` — use for side effects, branches, loading/error states, user-visible behavior
  - `<unit bindings artifact>` — use for selectors, route/query/runtime bindings, framework wiring
  - `<unit decomposition artifact>` — use for optional split candidates only; do not treat as required target structure
- relevant global rows:
  - `<wire contracts artifact>` rows tied to `<unit_name>`
  - `<shared modules artifact>` rows where used_by_units includes `<unit_name>`
  - `<cross-unit state artifact>` flows touching `<unit_name>`
  - `<seams artifact>` cuts touching `<unit_name>`
- before DONE report: artifacts_read, implemented_must_preserve, unresolved_or_deferred, verification evidence
```


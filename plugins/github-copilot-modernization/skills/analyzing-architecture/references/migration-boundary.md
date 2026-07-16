# Migration Boundary Artifact

This reference defines `migration_boundary.yaml`, the rewrite scope contract consumed by planning and implementation.

### `migration_boundary.yaml` — minimal runnable boundary + rewrite scope contract 

**Prevents**: inventory-driven over-rewrite — the implementation phase treats every discovered framework file or `source_anchor` as a rewrite target, even when acceptance can be satisfied by a smaller runtime-reachable cut.

**Default policy**: choose the smallest runtime boundary that satisfies the user's acceptance criteria. Expand only when user intent or technical constraints require it.

**Intent interpretation**:
- Distinguish **transformation acceptance** from **cleanup acceptance**. A migration/rewrite request defines the target behavior, runtime, interface, or deployment state; it does not automatically define a repository-hygiene goal.
- `rewrite/migrate/convert to <target>`, `tests/e2e pass`, `preserve behavior` → `cleanup_required: false` and `strategy: minimal_runtime` by default.
- `cleanup_required: true` only when the user explicitly asks for removal or cleanliness (for example: remove the old stack, no legacy residue, no old runtime, clean rewrite, delete old implementation), or when cleanup is necessary to satisfy a concrete build/runtime/contract/packaging/deployment constraint.
- long-term maintainability/refactor language without clean-removal requirement → `strategy: phased`: first satisfy the target runtime/contract boundary, then defer cleanup.
- technical blockers may expand the boundary only with scoped evidence. Cite the specific mechanism that forces expansion: build graph, runtime loader, ABI/API contract, packaging rule, deployment topology, data ownership, or cutover constraint. Generic claims such as "old and new stacks cannot coexist" are insufficient.

```yaml
user_intent:
  raw_request: "Rewrite this Vue SPA to React 18; E2E tests pass."
  inferred_acceptance: ["existing E2E tests pass", "preserve behavior"]
  cleanup_required: false
strategy: minimal_runtime        # minimal_runtime | full_rewrite | phased
runtime_reachable:               # files reachable from the target runtime entrypoint after the cut
  - src/client/main.js
  - src/client/router/index.js
must_rewrite:                    # implementation scope; DAG consumes this list, not source_anchors
  - path: src/client/main.js
    reason: "target runtime entrypoint"
  - path: src/client/App.vue
    reason: "root component, Vue-specific SFC"
  - path: src/client/router/index.js
    reason: "Vue Router → React Router rewrite required"
copy_as_is:
  - src/client/api/client.js
  - src/client/utils/formatting.js
legacy_allowed_to_remain:        # files may remain if not runtime-reachable and acceptance does not require cleanup
  - src/client/views/LegacyView.vue
  - src/client/components/LegacyWidget.vue
defer_cleanup:
  - "Remove unused Vue SFCs after runtime cutover is verified."
full_rewrite_reason: null        # required when strategy == full_rewrite
implementation_rule: >
  Implementation tasks use must_rewrite plus copy_as_is as needed.
  They MUST NOT infer rewrite scope from all source_anchors or all framework-specific files.
```

**Self-check**: `source_anchors` never used as rewrite scope; every `must_rewrite` row explains why it is runtime-reachable or required by acceptance; every `legacy_allowed_to_remain` row is either unreachable from the target entrypoint or explicitly deferred; `cleanup_required` is false unless explicitly requested by the user or forced by a concrete build/runtime/contract/packaging/deployment constraint; `full_rewrite_reason` present when `strategy: full_rewrite` and cites the specific forcing mechanism, not a generic coexistence claim.


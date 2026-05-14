# Project Topology: Output Template

The project topology is a shared infrastructure artifact consumed by all downstream tasks. It tells them how to split work without re-discovering project structure.

## Fixed path

`{{BASE_PATH}}/artifacts/project-topology.md`

`{{BASE_PATH}}` is the project root passed in by the caller (the directory containing `.github/modernize/`).

## Template

```markdown
# Project Topology

## Project Scale
- **Effective LOC**: <N> (<breakdown by language if multi-language>)
- **Module count**: <N>
- **Dependency density**: <edges> / <modules> = <ratio>
- **Language mix**: <percentages>

## Module Groups

| Group | Modules | Affinity Rationale (cite edges) | Effective LOC | Scope | Flag |
|-------|---------|-------------------------------|---------------|-------|------|
| G1 | ModA, ModB, ModC | Foundation: 3 internal edges (A→B, B→C, A→C); 6 external edges to G2/G3 | 85,000 | in-scope | — |
| G2a | ModD/Controllers, ModD/Routing | Web controllers (split from oversized ModD); 2 internal edges; depends on G1 (3 edges) | 70,000 | in-scope | — |
| G2b | ModD/Views, ModE, ModF | View layer (split from oversized ModD) + ModE/ModF; 3 internal edges; depends on G2a (4 edges), G1 (2 edges) | 50,000 | in-scope | — |
| G3 | ModG, ModH | Data access; 1 internal edge; shared DB schema | 45,000 | context-only | — |

Affinity Rationale MUST cite **internal edges** (within group) and **external/cross-group edges** (to/from other groups). Counts come from L1 output, not estimates.

## Cross-group Dependencies
- G1 → G2: 5 edges (ModB exposes APIs to ModD, ModE)
- G1 → G3: 1 edge (ModC ↔ ModG schema link)

## Critical Path (optional but recommended)
G1 → G3 → G5 → G7 (serialization bottleneck — these groups must complete in order)

## Sub-split (when a group is confirmed an outlier — produces independent top-level groups)

When `--validate` reports a group as an outlier (LOC > Q3+1.5·IQR AND > 2·median), DO NOT keep it as a single group. Split it at sub-package/sub-directory boundaries and list each split as its own top-level group in the Module Groups table above. **Splitting is outlier-driven, not threshold-driven — only split confirmed outliers.**

Example: `Foo.Services` (300K LOC, confirmed outlier) split into 4 — there is NO `G3` group; instead the table contains G3a, G3b, G3c, G3d as four independent top-level groups:

| Group | Modules | Affinity Rationale | Effective LOC | Scope | Flag |
|-------|---------|-------------------|---------------|-------|------|
| G3a | Foo.Services/{Common,Caching,Logging,...} (foundation services) | Internal foundation; depended on by G3b/G3c/G3d | 90,000 | in-scope | — |
| G3b | Foo.Services/{Catalog,Categories,...} | Catalog domain; depends on G3a | 70,000 | in-scope | — |
| G3c | Foo.Services/{Customers,Orders,Payments,...} | Order domain; depends on G3a, G3b | 80,000 | in-scope | — |
| G3d | Foo.Services/{Directory,Search,Topics,...} | Search/directory; depends on G3a | 60,000 | in-scope | — |

Each split-group runs its own full pipeline (plan → execute → validate). Inter-split dependencies (G3b→G3a etc.) are normal cross-group edges; parent's external dependencies (e.g. → G2) are inherited by whichever split-groups use them.

Document the split rationale (which sub-directory boundary, why) in the Provenance section.

### Required split-group evidence in Provenance

For each outlier parent module that was split, the Provenance section MUST include:

```
#### Split: <ParentModule> (parent LOC: <N>, outlier per --validate)

##### --module-loc output (verbatim)
<paste the literal `--module-loc <ParentModule>` output (re-invocation of the L1 step in module-loc mode for this parent)>

##### Split assignments
- G3a covers: Common/, Caching/, Logging/, Helpers/, Configuration/, Events/  → 90,000 LOC (sum)
- G3b covers: Catalog/, Categories/, Manufacturers/, Reviews/, Discounts/  → 70,000 LOC (sum)
- G3c covers: Customers/, Orders/, Payments/, Shipping/, Pickup/, Vendors/  → 80,000 LOC (sum)
- G3d covers: Directory/, Search/, Topics/, Menus/, Filters/  → 60,000 LOC (sum)
LOC sum: 300,000  vs parent L1 LOC: 298,500  (delta: 0.5% — within ±5% tolerance)

##### Inter-split dependency evidence
For each split-pair, record the count of source-level references from the dependent split's directory to the depended-on split's namespace/package, and the method used (which reference pattern, which directory). Example:
- G3b → G3a (catalog depends on common): 47 references found by scanning `Foo.Services/Catalog/` for imports of `Foo.Services.{Common,Caching,Logging}`
- G3c → G3a (orders depends on common): 62
- G3c → G3b (orders depends on catalog): 18
- G3d → G3a (search depends on common): 9
- G3a → others: 0 (foundation has no inbound from siblings — DAG root)

DAG check: G3a (root) ← G3b ← G3c ; G3a ← G3d  — no cycles ✓
```

## Provenance

### L1 Extract (decompose.py output summary)
- Detected language: <lang>
- Coverage: <discovered_loc> / <total_loc> LOC (<pct>%)
- Modules: <N>, Edges: <M>, SCCs: <K> (mega-SCC: <L>)
- DAG layers: <list>
- Oversized modules (informational only — split is outlier-driven, not threshold-driven): <list flagged by L1 or none>

### L2 Grouping decisions
- Path: <Path A: Hub-dominated | Path B: DAG-like (with optional SCC prelude)> (cite Graph Statistics signals: hub-ratio, depth, max SCC size, WCC count)
- Domain overrides: <if any group deviates from the topology-driven default, explain why>
- Implicit dependencies considered: <reflection/DI/ServiceLoader patterns assessed>
- Adapter feasibility (mega-SCC feedback edges): <if applicable>

### L3 Validation (paste --validate output verbatim)

**Hygiene rule**: paste the `--validate` output that corresponds to your **final** grouping decision. If you ran `--validate` multiple times during exploration (e.g. before sub-splitting an outlier, then again after), the block here MUST match the same spec your Topology classification + band judgment block judges. Do not paste an intermediate exploration run — re-run `--validate` with your final spec if needed.

\`\`\`
=== Grouping Validation ===
Groups: <N>  Modules covered: <M>/<M>

Group                 Mods        LOC   Int  Cross  Cohesion
G1                       3     65,324     3      6     0.333
...

=== Group Quality Scores ===
Outlier ratio  = x.xx    (max=... / median=...; statistical outliers: ...)
SCC integrity  = 0 violation(s)   (non-trivial module-SCCs split across groups)
Group cycles   = 0   (non-trivial group-level SCCs)
Coverage       = complete (0 missing, 0 unknown, 0 duplicate)
\`\`\`

(Note: per-group `Cross` and `Cohesion` columns are still printed in the per-group table for inspection; they are NOT aggregated into a quality score in v16.)

### Path classification + band judgment (REQUIRED)

State the path you classified (Path A vs Path B) and the band each of the 4 Quality Scores fell into per `references/topology-thresholds.md`. The numeric values here MUST match the Quality Scores block above (same `--validate` run).

\`\`\`
Path: <A: Hub-dominated | B: DAG-like with optional SCC prelude>  (signals from Graph Statistics that led here: <hub-ratio=…, depth=…, max SCC=…, etc.>)

Band per dimension (per topology-thresholds.md → Path <A|B> row):
- Outlier ratio  = x.xx → OK | Informational | Critical
- SCC integrity  = 0 → OK
- Group cycles   = 0 → OK
- Coverage       = complete → OK

Decision: All OK or Informational → submit. (If any Critical, apply remedy and re-validate; do not submit.)
\`\`\`
```

## Template rules

- Every module from L1 MUST appear in exactly one group (verified by L3 `--validate` MISSING check).
- Every group MUST have a `Scope` value: `in-scope` or `context-only`. When `scope = full`, all groups are `in-scope`.
- **Test modules** are filtered by L1 automatically — do not appear in any group.
- **Outlier groups** (per `--validate` outlier detection): split into multiple top-level groups (G3a, G3b, ...) in the Module Groups table — do NOT keep as a single group with sub-groups underneath. See the "Sub-split" section. Modules NOT flagged as outliers should NOT be split, regardless of absolute LOC.
- **L3 output**: paste verbatim into Provenance. Do NOT summarize, do NOT hand-compute alternative metrics.

For grouping rules, topology strategies, and metric thresholds, see `references/grouping.md`.

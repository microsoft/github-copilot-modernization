# Grouping (L2)

How the LLM groups modules using L1 (decompose.py) output. The script extracts data; **you decide how to group it.**

## Inputs from L1

L1 invocation (see SKILL.md for argument construction; `<merged>` = caller-supplied skip patterns ∪ `.gitignore` dirs ∪ BASELINE) gives you:
- **Module table**: name, LOC, files, DAG layer, in-degree, out-degree, flags (oversized / monitor)
- **Edge list**: every dependency edge with source/target
- **SCCs**: cyclic clusters; modules in the same SCC MUST be in the same group
- **DAG layers**: topological position; nearby layers tend to belong together
- **Oversized list**: modules flagged by L1 (informational marker only — see §1 rule 6 for split policy)
- **Coverage**: discovered LOC vs total project LOC; if <80%, edge sources are likely incomplete

**LOC definition**: lines of code in source files of the target language(s) only — extensions printed in L1's `Target extensions:` line. Static assets (images, css, json, html, sql), build output, and generated content are 0 LOC and do not appear in module or sub-directory LOC. `--exclude` filters at the directory level (build/vendor dirs); `--lang` filters at the extension level. Both apply to module LOC, sub-dir LOC, and coverage uniformly.

Supported languages: C#, Java, Python, JavaScript/TypeScript. Other languages → load `manual-extraction.md`.

## §0 Topology-Aware Grouping

decompose.py output is **data, not a partition**. Pre-filter trivial WCCs and lock any mega-SCC, then classify the remaining graph into one of **two paths** — A (Hub-dominated) or B (DAG-like).

### Terminology (used throughout this file and `topology-thresholds.md`)

- **In-degree of M** — number of distinct edges `X → M` where X ≠ M.
- **Out-degree of M** — number of distinct edges `M → Y` where Y ≠ M.
- **H (hub)** — the module with the highest in-degree. Ties broken alphabetically. `decompose.py` prints `top hub: <name> with in=<k>` and a top-3 list under `Top hubs (in)`.
- **Leaves of H** — `direct_preds(H)` = `{P : P → H}`. NOT all low-in-degree modules; specifically the modules that depend on H.
- **hub-ratio** — `max(in-degree) / mean(in-degree)`, computed across all modules. Reflects how concentrated incoming edges are on the top module. Mean denominator (not median) so a single tall hub against a long flat tail still scores high. See `topology-thresholds.md` Constants for `HUB_LOW` / `HUB_HIGH` / `HUB_GRAY` values.
- **Hub-chain** — multiple high-in-degree modules forming `H ← H' ← H'' ← spokes`. Treated as Path A with H = most-depended-on module; intermediate hubs are not leaves and inter-hub edges are not "inter-leaf" disqualifiers.
- **Trivial WCC** — a weakly-connected component with `< 3 modules AND < 5% of total LOC` (both required). Dropped as isolated leaves; the main component is classified on its own signals.
- **Mega-SCC** — a strongly-connected component with `> 50%` of modules OR `> 50%` of LOC.

### Pre-step 1 — WCC prefilter (always run first)

Compute weakly-connected components from L1 Graph Statistics.

- Drop every component matching `TRIVIAL_WCC` as isolated leaves (§1 rule 5).
- If **≥2 non-trivial components remain**, classify each component independently on its own Graph Statistics. Each component becomes its own family of groups, with no inter-family edges. Apply the rest of §0 / §1 per component.
- If **exactly 1 non-trivial component remains**, proceed to Pre-step 2 with that component as the working graph.

### Pre-step 2 — SCC prelude (mega-SCC lock)

If a mega-SCC exists (max SCC size > 50% of modules **OR** total SCC LOC > 50% of total LOC):

- **Lock the mega-SCC as one inseparable group** (hard constraint).
- **Periphery** (modules outside the mega-SCC) MUST be further partitioned by affinity — never lump all periphery into a single "the rest" group, even when SCC integrity validation passes. Periphery rules in priority order: (1) preserve any sub-SCC integrity (smaller non-trivial SCCs each become their own group); (2) cluster by domain affinity using shared inter-module edges (e.g. namespace-prefix vertical chains like `*.schema → *.commons → *.server`, shared-SPI adapter families, integration test harnesses); (3) merge remaining low-coupling singletons into a residual group only as the last step.
- Document feedback edges inside the mega-SCC as adapter candidates (§3).
- Then classify the **periphery** on its own Graph Statistics — Path A or Path B per below.

**IMPORTANT: periphery-only path classification.** After locking the mega-SCC, the full-graph `hub-ratio` and `top hub` reported by L1 are usually driven by SCC-internal nodes (e.g. `de.metas.util in=78` is high *because* every other SCC member depends on it inside the SCC) and DO NOT describe the periphery. Recompute path signals using only the periphery subgraph:

- Periphery hub-ratio = `max_in_degree(periphery) / avg_in_degree(periphery)`, where in-degree is computed only over edges between periphery modules (drop edges whose source or target is inside the locked mega-SCC).
- Apply the standard Path A vs Path B test (`topology-thresholds.md` Step 1) to **these recomputed numbers**, not the full-graph numbers.
- If periphery has 0 internal edges (pure star around the locked SCC) it is Path B by definition.

**Degenerate case — mega-SCC ≥ 90% LOC or ≥ 90% modules.** Periphery is too small to carry meaningful topology signal (often 0–2 trivial leaves). Path label is **informational only** — either A or B is acceptable, the grouping is essentially "the locked SCC + a handful of leaves." Document this in L2 and do not relitigate the path on subsequent convergence iterations.

If no mega-SCC, proceed directly with the full graph.

### Path classification (compute from L1 output for the post-prelude graph)

Evaluate top-down, stop at first match:

| Signal | Path | Grouping strategy |
|--------|------|-------------------|
| `hub-ratio ≥ HUB_HIGH` | **Path A** Hub-dominated | See Path A strategy below. |
| `hub-ratio` in `HUB_GRAY` AND at least one structural condition holds — any of (a) external inbound to H, (b) leaves outbound to non-{H ∪ leaves}, (c) hub-chain (top-2 hubs connected) | **Path A** (gray-zone promotion) | See Path A strategy below. |
| otherwise (including `hub-ratio ≤ HUB_LOW`, gray-zone with no Path A structural condition, or pure layered DAG / linear chain) | **Path B** DAG-like | See Path B strategy below. |

#### Path A — Hub-dominated

- **Pure star** (H has 0 external inbound AND leaves have 0 inter-leaf edges AND leaves have 0 outbound to non-{H ∪ leaves}) → single group `{H, all leaves}`. Safe because no cross-group edges escape the group.
- **Otherwise** → **H is its own group.** Leaves form a separate group (or sub-split per §1.1 if outlier-flagged). Merging H with leaves creates a group-level cycle — forbidden by §1.0 invariant.

#### Path B — DAG-like

- Each DAG layer is a candidate group. Within a layer, merge same-layer peers freely (they have 0 intra-layer edges by definition).
- Adjacent layers merge only if BOTH (combined LOC < `ideal_group_loc` from L1 `topology_hints`, = `total_loc / target_group_count`) AND (no resulting outlier per §1.1).
- Linear chain (depth ≈ modules, 1 module per layer) is the degenerate case — same merge rule applies; do not split modules unless §1.1 confirms outlier.

**Anti-patterns** (apply universally, not path-specific):
- One group per domain/business category — domain is metadata, not a structural reason to split. Each group adds full pipeline overhead.
- Splitting a module just because its absolute LOC is large — split is outlier-driven (§1.1), not threshold-driven.
- Merging a hub with its leaves when the hub still has external inbound — creates a group cycle.

## §1.0 Group-DAG Invariant (highest priority — overrides all other rules)

**The group graph (groups as nodes, cross-group edges as edges) MUST be a DAG.** Any candidate grouping that produces a group-level cycle is invalid, regardless of how nicely it satisfies other rules.

**Self-check before submitting**: For each candidate group G, compute its set of cross-group edges. Build a group-level adjacency matrix. Run a cycle check (DFS or Tarjan). If any cycle exists, the grouping is wrong — split the offending group along the edge that closes the cycle.

This invariant is reported by `decompose.py --validate` as the `Group cycles` Quality Score. A grouping that creates `A→B→A` at the group level is invalid even when every internal property looks good — see `topology-thresholds.md`, where Group cycles is a hard invariant (Critical when non-zero, on every path).

## §1 Grouping Rules

1. **SCC integrity** — Modules in the same SCC are inseparable.
2. **Same-layer merge (intra-layer)** — Same-DAG-layer modules with 0 intra-layer edges SHOULD merge if combined LOC < `ideal_group_loc`.
3. **Cross-layer merge (inter-layer)** — Only merge across DAG layers if (a) the upstream node is a single trivial module per Rule 5, OR (b) the downstream group has only one inbound edge and that edge is from the upstream node. **Never** cross-layer-merge when the downstream node has external dependents elsewhere — that creates the Hub-dominated trap.
4. **Hub classification** (`hub-ratio ≥ HUB_HIGH`, see `topology-thresholds.md` Constants) — Apply the Path A pure-star vs non-star distinction from §0:
   - If hub has 0 external inbound AND leaves have 0 external outbound → pure star, hub may merge with leaves.
   - Otherwise → hub is its own group, leaves grouped separately.
5. **Trivial modules** (<500 LOC or <1% total LOC) — Merge into nearest dependency neighbor. Zero-dep isolated leaves merge with same-layer peers; if no same-layer peer exists, merge with the closest non-trivial dependent.
6. **Oversized modules** (informational L1 flag) — Do NOT split reflexively. Splitting decision is **outlier-driven**, not threshold-driven (see §1.1 Outlier Test). When a module IS confirmed an outlier, split it at sub-package/sub-directory level: each split becomes a top-level group. Each split-group runs its own full pipeline. Inter-split dependencies become normal cross-group edges.
7. **Test modules** — L1 already filters them out. Tests are rewritten alongside their group during implementation.

## §1.1 Oversized Module Splitting Protocol

When a module is **confirmed an outlier** (per the test below), follow this protocol. Do NOT trigger this protocol from the L1 oversized marker alone — the marker is informational; the outlier test is authoritative.

### Outlier Test (run BEFORE splitting)

Run `--validate` first. The script reports `Outlier ratio = X.XX` (= max_group_LOC / median_group_LOC) and lists statistical outliers in parentheses. A statistical outlier is:

```
group_LOC > Q3 + 1.5·IQR  AND  group_LOC > 2 · median(group_LOCs)
```

Pure relative — no absolute threshold. Look up the Outlier ratio band in `topology-thresholds.md` for your path (A or B). If it falls in OK AND the listed outliers are empty, accept the grouping. **Do not split for the sake of evenness; do not split based on absolute LOC alone.** Some modules are intrinsically large and cannot be cleanly partitioned; forcing splits creates artificial seams that hurt downstream migration.

If Outlier ratio is Critical OR statistical outliers are listed, proceed with the protocol below for each outlier.

### Step 1: Get sub-directory LOC breakdown

Re-invoke L1 in `--module-loc <ModuleName>` mode (same `<path>`, `<lang>`, `<merged>` arguments). It returns LOC per sub-directory under that module, after L1's effective-LOC counting. Use this as the source of truth for sub-directory sizes — do NOT estimate.

### Step 2: Decide split boundaries (semantic)

Group sub-directories into split-groups using domain knowledge:
- **Foundation sub-directories** (Common, Caching, Logging, Helpers, Configuration, Events, ...) → put in the FIRST split-group (e.g. G3a). Other split-groups will depend on it.
- **Domain sub-directories** (Catalog, Customers, Orders, Search, ...) → group by business domain.
- **Target size**: each split-group's LOC should fall in the OK band for the project's path (see `topology-thresholds.md`). If still flagged outlier after splitting, split further.
- **Avoid leaving an "infrastructure" sub-dir alone unless it's substantial** — single-subdir split-groups whose LOC qualifies as trivial (per §1 rule 5) are usually wrong; merge into the closest neighbor.

### Step 3: Detect inter-split dependencies (evidence-based)

For each pair (G3b, G3a), search for cross-references using the language's import syntax (C# `using`, Java/Python `import`, JS/TS `import ... from`, etc.). Record the count and direction (G3b → G3a means catalog depends on common). A pair with 0 cross-references means the splits are independent (parallel-safe).

### Step 4: Document everything in the artifact

For each split-group, the Provenance section MUST contain:
- The exact `--module-loc` output (verbatim) showing which sub-directories were grouped.
- The exact import-search invocations and their counts for inter-split dependency edges.
- A 1-2 line rationale per split-group (semantic boundary chosen and why).

### Splitting quality checks (caller will verify)

1. **LOC sum**: ∑(split-group LOC) MUST equal parent module L1 LOC within ±5%. **Both sides MUST be measured by `decompose.py` — never mixed with shell `find`/`wc -l` or other line counters** (the script's exclusion logic and shell glob behave differently and will diverge by 10-30%). If you need finer-grained LOC than `--module-loc` provides, run `--module-loc` again on the same directory after sub-directory partitioning, never substitute external counts.
2. **No overlap**: each sub-directory appears in exactly one split-group.
3. **No omission**: every sub-directory from `--module-loc` output appears in some split-group (or is explicitly merged with a noted reason). **Conversely: sub-dirs NOT shown in `--module-loc` output MUST NOT be added to split-groups** — they were filtered by `--exclude` (build output, vendored deps, static assets, generated content). Adding them back inflates split-groups beyond the parent, defeating the purpose of splitting. The split-group LOC sum should approximately equal the parent module L1 LOC (the merged exclude — caller-supplied skip patterns ∪ `.gitignore` ∪ BASELINE — was passed per SKILL.md), not the parent's raw filesystem footprint.
4. **DAG**: declared inter-split dependencies form a DAG (no cycles).
5. **Each split-group's LOC is in line with peer groups** — re-run the outlier test on the new grouping; if any new split is itself flagged as outlier, split further.

### MANDATORY: Re-validate after splitting

After documenting splits, re-run `--validate` with the **expanded grouping spec** that lists each split-group separately. The script supports **virtual sub-modules** in spec strings: any token of the form `ParentModule/sub/path` is expanded to a virtual module whose:
- LOC is computed by walking `<parent_dir>/<sub/path>` (honors `--exclude` and built-in skip dirs)
- Edges are **inherited from the parent** (every edge touching the parent is replicated to all virtual children — this is intentionally over-inclusive so cross-group edges remain visible)
- Parent module is removed from the working set so it is neither double-counted nor flagged missing

Example (replace `G4:Nop.Web` with three split-groups):
```
--validate 'G1:Nop.Core,Nop.Data|...|G4a:Nop.Web/Controllers,Nop.Web/Factories,Nop.Web/Models,Nop.Web/Views|G4b:Nop.Web/Areas/Admin/Controllers,Nop.Web/Areas/Admin/Factories|G4c:Nop.Web/Areas/Admin/Views|G5:...'
```

The script will print a `[virtual sub-modules] expanded N sub-paths from M parent module(s)` line and then output the **Group Quality Scores** block on the expanded grouping. Use the scored protocol in §4 to judge whether the split actually resolved the outlier — not whether you rationalized it away.

**Caveats**:
- Sub-paths must exist on disk under the parent module's directory.
- Inherited edges to virtual children may over-report cross-group coupling at the per-group `Cross` column (a structural artifact of conservative inheritance — every parent edge replicated to all children). Document the actual finer-grained dependency in the Cross-group Dependencies section. The `Outlier ratio` Quality Score is not affected because it depends only on per-group LOC, which is computed from the actual sub-paths.
- If your split semantically separates code that the parent's external dependents only need part of, the inherited edges in `per-group Int/Cross` columns may look inflated. This is debug data only; the four Quality Scores (Outlier ratio, SCC integrity, Group cycles, Coverage) remain authoritative.

**Do NOT submit the artifact when a pre-split `--validate` run still flags the parent module as an outlier and you have not actually performed the split.** Critical findings must be resolved (split, merge, or re-classify topology with documented justification), not rationalized away.

## §2 Implicit Dependencies

When L1 reports implicit dependencies (reflection, DI, ServiceLoader, dynamic imports, plugin entry-points):

- Evaluate whether each pattern represents a TRUE cross-module runtime dependency.
- If yes: factor into grouping (prefer keeping coupled modules together).
- If no (e.g. internal reflection within one module): ignore.
- Record the assessment in the Provenance section.

## §3 Adapter Feasibility (Mega-SCC feedback edges)

For each feedback edge L1 reports inside a mega-SCC:

- **Accidental cycle** (code smell, breakable with an interface/adapter) → modules CAN be in different groups; note "adapter needed" in Cross-group Dependencies.
- **Essential cycle** (genuine bidirectional business dependency) → modules MUST stay in the same group.
- Document the assessment per feedback edge.

## §4 Validation (L3) — Authoritative Source

After grouping, ALWAYS invoke L3 validation: re-invoke `decompose.py` with the same `<path>`, `<lang>`, `<merged>` arguments plus `--validate '<spec>'`, where `<spec>` is the pipe-separated list of groups in the form `G1:M1,M2|G2:M3,M4|...`.

The script outputs **raw measurements only** — it never declares PASS/FAIL. **You judge** the grouping by classifying the path (A or B) and looking up bands in `topology-thresholds.md`.

### Output: Group Quality Scores (4 dimensions)

| Dimension | Definition |
|-----------|-----------|
| **Outlier ratio** | `max(group_LOC) / median(group_LOC)` — relative imbalance |
| **SCC integrity** | Count of non-trivial module-SCCs split across groups (invariant: must be 0) |
| **Group cycles** | Count of non-trivial group-level SCCs (invariant: must be 0) |
| **Coverage** | missing / unknown / duplicate modules in spec (invariant: must be complete) |

The script also outputs **Graph Statistics** (during the L1 phase before grouping):
- modules / edges / DAG depth / SCCs (count, max size, non-trivial count)
- WCCs (count, sizes)
- in-degree distribution (max, avg) / out-degree distribution (max, avg)
- hub-ratio (`max_in_degree / avg_in_degree`)

Use these to (1) run Pre-step 1 (WCC prefilter) and Pre-step 2 (SCC prelude) per `topology-thresholds.md`, then (2) classify the post-prelude graph as Path A or Path B per Step 1 of that file.

### Scored Validation Protocol

1. **Pre-step 1**: WCC prefilter — drop trivial WCCs; if ≥2 non-trivial components, classify each independently.
2. **Pre-step 2**: SCC prelude — if mega-SCC, lock it as one group, then classify periphery.
3. **Classify path** of the post-prelude graph → Path A (Hub-dominated) or Path B (DAG-like).
4. **Look up each Quality Score** in the matching path row of `topology-thresholds.md`.
5. **Categorize each dimension**: OK / Critical.
6. **Decide**:
   - All OK → submit grouping.
   - Any Critical → apply listed remedy, re-run `--validate`, re-judge.

The script always exits 0; exit code carries no judgment.

Paste the full output verbatim into the artifact's Provenance section — do not hand-compute, do not summarize. **Also document** the path you classified and the band each dimension fell into (one line each).

### Convergence Loop (how to react to Critical scores)

L2 grouping is iterative. Critical scores define a convergent process — each remedy moves the system toward a feasible state:

```
loop:
  run --validate
  pre-step 1 (WCC prefilter) + pre-step 2 (SCC prelude)
  classify path from post-prelude Graph Statistics → A or B
  for each Quality Score, look up band in topology-thresholds.md
  if all OK: done
  if any Critical, apply matching remedy:
    - Outlier ratio Critical               → run --module-loc <OutlierModule>, sub-split per §1.1, expand groups, re-validate
    - SCC integrity Critical               → merge listed SCC members into one group (§1 rule 1)
    - Group cycles Critical                → split offending group along edge that closes the cycle (§1.0)
    - Coverage Critical                    → fix typos / missing modules in spec
  re-validate
```

**Why it converges:**
- **Splitting** monotonically decreases the outlier's LOC (each split-group < parent). Cannot oscillate.
- **SCC integrity and Group cycles are hard invariants** — they always converge to 0 once their remedy is applied (merge SCC members; split cyclic groups).
- The loop terminates when no dimension is Critical, or when the outlier cannot be cleanly partitioned (escalate to manual review).

**Iteration cap**: max 5 iterations. If still Critical, the input topology is pathological (e.g. one giant SCC > 500K LOC) — escalate rather than further automated splitting.

### Score Coupling Diagnostics

When multiple Quality Scores hit Critical simultaneously, treat them as **coupled signals** rather than independent failures. The combinations below indicate root causes; addressing the root often resolves multiple Criticals in one move.

#### Pattern 1: Outlier ratio Critical + Group cycles Critical

**Likely root cause: a hub was merged with its leaves.**

If you see Outlier ratio high (one fat group) plus a group-level cycle, you almost certainly merged H with leaves while H still had external inbound. Separate H into its own group (Path A non-pure-star strategy). One operation usually fixes both.

#### Pattern 2: Same Critical persists across ≥2 re-grouping attempts

**Meta-signal: re-examine path classification, not grouping strategy.**

If two different grouping strategies both fail the same Critical dimension, the issue is upstream. Return to Pre-step 1 / Pre-step 2 / Step 1 and re-evaluate:
- Did you miss a non-trivial WCC (multi-component case)?
- Is there a mega-SCC you didn't lock?
- Is hub-ratio actually in HUB_GRAY? Recount in-degree.
- Does the hub have external inbound edges? Path A non-pure-star vs Path B with unmerged hub.

Don't keep iterating L2 with the wrong path — the bands differ per path, and you'll never converge.

---

**How to use these patterns:** when `--validate` reports any Critical dimension, scan this section first. If the failure pattern matches, apply the coupled remedy before reaching for individual remedies in the Convergence Loop above.


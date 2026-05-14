# Topology Thresholds (LLM Quality Judgment Reference)

`decompose.py` outputs **raw numbers** in two blocks:
- **Graph Statistics** (after L1 module table): in/out-degree distribution, hub-ratio, SCC count + max size, WCCs, DAG depth.
- **Group Quality Scores** (after `--validate`): Outlier ratio, SCC integrity, Group cycles, Coverage.

The script does NOT pass/fail. **You (LLM) judge** quality by:
1. Pre-filtering trivial WCCs and locking mega-SCC (Pre-steps below).
2. Classifying the remaining graph into one of **two paths** — A (Hub-dominated) or B (DAG-like).
3. Looking up that path's quality bands.
4. Deciding action: accept / rebalance / sub-split / re-group.

---

## Constants (single source of truth)

| Name | Value | Used by | Rationale |
|------|-------|---------|-----------|
| `HUB_LOW` | **3** | Path B §Identify (`hub-ratio ≤ HUB_LOW`); lower edge of gray zone | Below this, hub influence is too weak to reshape layering — graph reads as a layered DAG. |
| `HUB_HIGH` | **5** | Path A §Identify (`hub-ratio ≥ HUB_HIGH`); upper edge of gray zone | At/above this, the hub structurally dominates: most cross-layer edges funnel through one node. |
| `HUB_GRAY` | open interval `(HUB_LOW, HUB_HIGH)` = (3, 5) | Step 1 lookup gray-zone row | Numeric near-miss ≠ structural match. Default to **Path B**. Promote to **Path A** **only** if at least one Path A structural condition holds independently of the number — any of: (a) H has external inbound, **OR** (b) leaves have outbound to non-{H ∪ leaves}, **OR** (c) hub-chain pattern (multiple high in-degree modules form a chain `H ← H' ← H'' ← spokes`; pick most-depended-on as H, intermediate hubs are not leaves, inter-hub edges are not inter-leaf disqualifiers). Gray-zone is stricter than clear-hub only in that **structural verification is required** (clear-hub `≥ HUB_HIGH` auto-classifies Path A without checking (a)/(b)/(c)); the **set** of accepted structural conditions is identical between gray-zone and Path A §Identify. |
| `MEGA_SCC_PCT` | **50%** | Pre-step 2 (SCC prelude) | Past half the project (by module count OR LOC), the SCC *is* the project; treat it as one inseparable group, then classify the periphery on its own signals. |
| `TRIVIAL_WCC` | `< 3 modules AND < 5% of total LOC` | Pre-step 1 (WCC prefilter) | Single-node / 0-LOC stub components are not real disconnected tiers. Drop them as isolated leaves (§1 rule 5) and classify the main component on its own signals. |

Why these specific numbers: the two hub thresholds (3, 5) are conservative bounds chosen so that ratios *clearly* below 3 or *clearly* above 5 are unambiguous; the gap (3–5) is intentional and forces structural verification rather than rounding. The 50% mega-SCC mark is the symmetry point — past it, the SCC is the majority, so it dictates structure. The trivial-WCC rule (`<3 modules AND <5% LOC`) requires **both** conditions because either alone is too permissive.

**Endpoint inclusivity** — `HUB_LOW` and `HUB_HIGH` are **inclusive** (Path B uses `≤ HUB_LOW`, Path A uses `≥ HUB_HIGH`); `HUB_GRAY` is the **open** interval `(HUB_LOW, HUB_HIGH)` so the endpoints belong to Path B / Path A respectively, never to the gray zone. `MEGA_SCC_PCT` is **strict** (`>` 50%, not `≥`). `TRIVIAL_WCC` thresholds are **strict** (`<3` and `<5%`).

---

## Bands

- **OK** — accept the grouping as-is.
- **Critical** — **must fix** before submitting. Apply the listed remedy.

Three of the four dimensions are **invariants** that are Critical for every path:
- **SCC integrity** — must be `0`. Any non-trivial module-SCC split across groups violates `grouping.md` §1 rule 1. Remedy: merge the SCC members into one group.
- **Group cycles** — must be `0`. Any non-trivial group-level SCC violates the `§1.0 Group-DAG Invariant`. Remedy: split the group whose edges close the cycle, along the offending edge.
- **Coverage** — must be `complete`. Any missing/unknown/duplicate modules in the spec → fix the spec.

These three are not relaxed by any path. Only **Outlier ratio** has path-specific bands.

---

## Pre-step 1 — WCC prefilter

Compute weakly-connected components from L1 Graph Statistics.

- Drop every component matching `TRIVIAL_WCC` as isolated leaves (§1 rule 5 in `grouping.md`).
- If **≥2 non-trivial components remain**, classify each component independently on its own Graph Statistics; each component becomes its own family of groups, with no inter-family edges.
- If **exactly 1 non-trivial component remains**, proceed to Pre-step 2 with that component as the working graph.

---

## Pre-step 2 — SCC prelude (mega-SCC lock)

If max SCC size > `MEGA_SCC_PCT` of modules **OR** total SCC LOC > `MEGA_SCC_PCT` of total LOC:

- **Lock the mega-SCC as one group** (single inseparable group). Document feedback edges inside the SCC as adapter candidates (§3 in `grouping.md`).
- Classify the **periphery** (modules outside the mega-SCC) on its own Graph Statistics — Path A or Path B per Step 1 below. Periphery groups are partitioned by affinity, never lumped into a single "the rest" group (see `grouping.md` §1 mega-SCC periphery rules).

If no mega-SCC, proceed to Step 1 with the full graph.

---

## Step 1 — Path classification

Evaluate the rows below **top-down, in order**, and stop at the **first** row whose condition holds.

| Signal | Path |
|--------|------|
| `hub-ratio ≥ HUB_HIGH` | **Path A** Hub-dominated (clear-hub default — once `hub-ratio ≥ HUB_HIGH` the topology is hub-shaped. Hub-chain patterns — multiple high in-degree modules forming a chain like `M1 ← M2 ← M3 ← leaves` — are still Path A: pick the **most-depended-on** module as H; the intermediate hubs are not leaves and inter-hub edges are not "inter-leaf" disqualifiers.) |
| `hub-ratio` in `HUB_GRAY` AND at least one Path A structural condition holds — any of (a) external inbound to H, (b) leaves outbound to non-{H ∪ leaves}, (c) hub-chain (top-2 hubs connected) | **Path A** (gray-zone promotion) |
| otherwise | **Path B** DAG-like (covers pure layered DAGs, linear chains, and gray-zone hub-ratios that don't meet any Path A structural condition) |

---

## Path A — Hub-dominated

**Strategy** (full rules in `grouping.md` §0/§1):
- **Pure star** (H has 0 external inbound AND leaves have 0 inter-leaf edges AND leaves have 0 outbound to non-{H ∪ leaves}) → single group `{H, all leaves}`. Outlier ratio is undefined / 1.0; only the invariants apply.
- **Otherwise** → H is its own group; leaves are separate groups (sub-split per §1.1 if outlier-flagged). Merging H with leaves creates a group cycle.

| Dimension      | OK              | Critical                                         |
|----------------|-----------------|--------------------------------------------------|
| Outlier ratio  | <2.5            | ≥2.5 → sub-split outlier (typically the H or a fat leaf) per §1.1 |
| SCC integrity  | 0               | ≥1 → merge SCC members                           |
| Group cycles   | 0               | ≥1 → likely H merged with leaves; separate them  |
| Coverage       | complete        | any missing/unknown/dup → fix spec               |

---

## Path B — DAG-like

**Strategy** (full rules in `grouping.md` §0/§1):
- Each DAG layer is a candidate group. Within a layer, merge same-layer peers freely (0 intra-layer edges by definition). Adjacent layers merge only if BOTH (combined LOC < `ideal_group_loc`) AND (no resulting outlier).
- Linear chain (depth ≈ modules, 1 module per layer) is the degenerate case — same merge rule.

| Dimension      | OK              | Critical                                         |
|----------------|-----------------|--------------------------------------------------|
| Outlier ratio  | <2.5            | ≥2.5 → sub-split outlier per §1.1                |
| SCC integrity  | 0               | ≥1 → merge SCC members                           |
| Group cycles   | 0               | ≥1 → split offending group along cyclic edge    |
| Coverage       | complete        | any missing/unknown/dup → fix spec               |

---

## Step 2 — Look up each Quality Score against this path's row

## Step 3 — Action

- All dimensions OK → submit grouping.
- Any Critical → apply the listed remedy, re-run `--validate`, repeat.
- Iteration cap: 5. After 5, escalate to manual review.

---

## Why script never fails

`decompose.py --validate` always exits 0. The reason: pass/fail decisions depend on the path classification, and that classification is judgment, not arithmetic. Hard-coding a single threshold across paths forces the same number to mean different things in different projects, which produced false fails in past iterations. Putting the bands in this reference and the judgment in the LLM keeps the script's role narrow: **measure, not judge**.

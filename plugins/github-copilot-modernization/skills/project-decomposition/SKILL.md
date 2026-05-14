---
name: project-decomposition
description: |
  Single-source codebase decomposition: scans a project scope, builds the module dependency graph, counts LOC by language, computes skip patterns (caller-supplied ∪ .gitignore ∪ baseline), and (when grouping is required) produces topology groupings with L3 quality validation. One skill owns ProjectProfile JSON, grouping protocols, and quality gates.
  Triggers: "before generating a workflow plan", "before topology grouping", "project sizing", "LOC counting", "module grouping", "topology splitting rules", "topology consumer rules", "scale-aware splitting", "large codebase decomposition", "module dependency graph", "scope measurement".
  NOT for: semantic architecture analysis, implementation planning, running tests/builds/linters.
---

# Project Decomposition: Recon, Grouping & Validation

## What this skill does

This is the single entry point for measuring a codebase scope and (when needed) decomposing it into topology groups. Two modes:

1. **Lightweight recon (JSON)** — `scripts/decompose.py ... --profile-json` produces a structured `ProjectProfile` JSON with LOC / file counts / module list / dep graph summary / skip patterns. Used by upstream planners to decide pipeline variant and grouping needs.
2. **Full grouping + validation** — `scripts/decompose.py` directly, for L0→L1→L2 grouping protocol and L3 quality validation. Used when the workflow plan declares `grouping.needed: true`.

Both modes are the same `decompose.py` engine — single source of truth for LOC counting (`--lang` defines the LOC semantic boundary; `--exclude` defines the directory boundary), graph extraction, and validation scoring.

### Which mode to run

| Caller intent | Use | Why |
|---------------|-----|-----|
| Decide whether to fan out at all (sizing, dispatch) | `--profile-json` | Returns structured ProjectProfile (LOC, module count, depth, hub-ratio, sizing hints) without grouping output. Cheap, machine-readable. |
| Caller already decided to fan out and needs L1 numbers + L2 grouping + L3 validation | run without `--profile-json`; then again with `--validate` for L3 | Human-readable Graph Statistics + Quality Scores. |
| Caller wants both | run twice: once with `--profile-json` for the planner, once without for human L1 | The flags are mutually exclusive in one invocation; do not combine `--profile-json` with `--validate`. |

`--profile-json` and `--validate` cannot be combined in a single invocation (the script rejects this).

## When to Apply

**Scale threshold**: Codebase is large enough that no single agent reading the source can hold any one group's source in context, or has enough modules that dependency-aware grouping adds value. The unit being sized is **one group's codebase scope** (which many agents in the pipeline must read), not a "one-agent workload" — every group still runs a full plan→execute→validate pipeline with many agent sessions.

**Scope check** (after scale threshold is met, applied by the caller — see Workflow § input contract for the field this maps to):

1. The caller determines the **rewrite scope** from the user request and passes it via the `Scope:` dispatch field:
   - **Full rewrite** — all modules in scope → `scope = full`
   - **Partial rewrite** — user specifies modules/layers/features → `scope = scoped`
   - **Cross-layer rewrite** — rewrite targets a different architectural layer (e.g. Razor → Angular while backend stays) → `scope = scoped` (only the target layer is in scope; source-layer modules are `context-only`)

2. Apply the scope (classify groups using the dispatched value):
   - `full` — all groups are `in-scope`
   - `scoped` — analyze all modules for the dependency graph, but classify each group:
     - **`in-scope`** — being rewritten → generates DAG tasks
     - **`context-only`** — depended on by in-scope but NOT being rewritten → no DAG tasks, dependency context only

3. **Skip entirely** if all of the following hold for the in-scope set:
   - DAG depth ≤ 2 AND module count ≤ 3, AND
   - total in-scope LOC < `ideal_group_loc` (from `topology_hints`)

   Report skip rationale back to the caller (plain text reply, not the artifact); do not produce a topology artifact.

## Architecture: 3 Layers

| Layer | Output |
|-------|--------|
| **L1 Extract** (`scripts/decompose.py <path> --lang '<lang>' --exclude '<patterns>'`) | Modules, edges, SCCs, DAG layers, LOC, oversized flags. No grouping. |
| **L2 Group** (caller agent) | Module groups using L1 data + topology-aware judgment. See `references/grouping.md`. |
| **L3 Validate** (`scripts/decompose.py <path> --lang '<lang>' --exclude '<patterns>' --validate '<spec>'`) | 4 raw Quality Scores (Outlier ratio, SCC integrity, Group cycles, Coverage). Definitions and judgment protocol live in `references/grouping.md` §4 and `references/topology-thresholds.md`. |

Do NOT skip any layer. L3 is the only authoritative quality check — hand-computed metrics are not accepted.

## Files (load on demand)

| File | Load when |
|------|-----------|
| `references/grouping.md` | L2 step — topology-aware grouping rules + L3 metric definitions (authoritative source for thresholds) |
| `templates/output-template.md` | Output step — project topology artifact format and fixed path |
| `references/consume.md` | Downstream consumer contract — how the artifact is read and accepted |
| `references/manual-extraction.md` | Only if L1 reports `Unsupported language` (rare — C#/Java/Python/JS-TS supported) |

**Python is mandatory for topology grouping.** `decompose.py` is the only authoritative LOC counter for grouping/L3 metrics — external counters drift across runs and inflate by 5–15% on comment-heavy languages, which destabilizes outlier-ratio and SCC-integrity scoring.

`scripts/decompose.py` invocation surface:
- `<path> --lang '<lang>' --exclude '<merged>'` — extract mode
- `--validate '<spec>'` — L3 quality gate
- `--module-loc <Module>` — sub-dir LOC for a specific module
- `--json out.json` — machine-readable dump
- `--profile-json` — `ProjectProfile` JSON to stdout (see **JSON Profile Mode** below)

`--lang` and `--exclude` are required. `--lang` accepts `python|java|csharp|javascript` (or aliases: `py`, `cs`/`c#`/`dotnet`, `js`/`ts`/`node`). For mixed projects pass comma-separated, e.g. `--lang csharp,javascript`. `--exclude` takes the **merged** list (see Workflow § effective_exclude).

## Workflow

The caller dispatches with a fixed input contract — these fields MUST be present, do not infer them yourself:

| Field | Type | Example | Used by |
|-------|------|---------|---------|
| `Source path:` | absolute path to repo root | `/path/to/repo` | every L1/L3 invocation as `<source-path>` |
| `Language(s):` | comma-separated `decompose.py --lang` value | `csharp` or `csharp,javascript` | `--lang '<lang>'` |
| `Skip patterns:` | comma-separated path segments (may be empty) | `tests,docs,samples` | exclude-merge input |
| `Scope:` | `full` \| `scoped` | `scoped` | Scope check classification |
| `Mode:` | `topology` \| `profile-json` | `topology` | output shape — `profile-json` returns `ProjectProfile` JSON to stdout instead of producing the artifact (see **JSON Profile Mode** below) |

All five fields are required. If any is missing, halt and request it from the caller — do **not** guess or default. Then build the **effective exclude list** by union-ing four sources:

```
effective_exclude = caller_skip_patterns
                  ∪ gitignore_dirs(<source-path>/.gitignore)
                  ∪ auto_gen_dirs(<source-path>)        ← see below
                  ∪ BASELINE
```

**`auto_gen_dirs(path)`** — pre-L1 sniff for framework-generated code that the caller cannot anticipate (EF Core `Migrations/`, protobuf-generated stubs, OpenAPI/GraphQL codegen, ANTLR `.g4`-output dirs, etc.). These dirs may contain tens of thousands of lines that are not authored code; they distort outlier ratio and force spurious sub-splits. Procedure:

1. Walk top 2 levels under `<source-path>` (skipping anything already in BASELINE / gitignore_dirs / caller_skip_patterns).
2. For each directory whose **source-file LOC** (matching `--lang` extensions) ≥ 5% of project total, sample up to 3 source files (largest first) and read the **top 100 lines** of each.
3. If ≥ 1 sampled file contains any of these markers (case-insensitive), add the directory's segment name to `auto_gen_dirs`:
   - `<auto-generated>`
   - `DO NOT EDIT`
   - `This file was generated`
   - `@generated`
   - `Code generated by` (Go convention)
   - `auto-generated by`
4. Cap at 8 directories. Log each accepted dir and the marker that triggered it; this list is reproducible across runs.

Do NOT use this mechanism to skip hand-written code that happens to be large — only marker-confirmed generated code qualifies. If marker matching is ambiguous, leave the dir in and let the outlier-ratio band trigger normal remediation.

**BASELINE** (language-neutral, fixed list, always applied — fallback when caller/gitignore miss something):
```
.git, .svn, .hg, .idea, .vscode, .vs, .DS_Store,
node_modules, bower_components, vendor, packages,
__pycache__, .venv, venv, .tox, .pytest_cache, .cache,
bin, obj, target, build, dist, out,
.gradle, .mvn
```

BASELINE is fixed and language-neutral. Project-type-specific extras (framework directories, generated folders) are the **caller**'s responsibility and must be passed via `caller_skip_patterns`; do not extend BASELINE per project.

**`gitignore_dirs(path)`** — parse repo's `.gitignore` and extract directory-shaped entries:
- keep: lines ending in `/`, or bare path segments without glob chars (e.g. `wwwroot/lib/`, `App_Data`)
- drop: blanks, comments (`#…`), negations (`!…`), file-level globs (any line containing `*` `?` `[`)
- strip leading/trailing `/`; dedupe across all three sources
- if `.gitignore` is missing, this set is empty

Pass the merged list verbatim in every `decompose.py` invocation as `--exclude '<merged>'`. Rationale: build output, vendored deps, and generated assets the repo itself ignores must not inflate LOC or group sizes — relying on the caller alone is fragile.

1. **Extract (L1)** — Invoke `scripts/decompose.py <source-path> --lang '<lang>' --exclude '<merged>'`. Treat output as source of truth; do NOT re-extract module/edge/LOC data from raw source. Apply the caller's `scope` to classify modules.

2. **Group (L2)** — Load `references/grouping.md`. Use L1 data + topology rules to form groups.

3. **Validate (L3, MANDATORY)** — Invoke `scripts/decompose.py <source-path> --lang '<lang>' --exclude '<merged>' --validate 'G1:M1,M2|G2:M3,M4|...'`. Classify path (Path A vs Path B) and judge Quality Scores per `references/grouping.md` § Scored Validation Protocol & Convergence Loop. Paste full output into Provenance.

4. **Output** — Load `templates/output-template.md`. Produce the artifact at the fixed path.

5. **Consume** — Downstream consumers load `references/consume.md`. The caller runs an additional acceptance check (see consume.md § Acceptance Check).

---

## JSON Profile Mode (`--profile-json`)

For upstream planners that just need a structured snapshot of the scope — no grouping, no L2/L3 — invoke `decompose.py` with `--profile-json` instead of running the full L1→L2→L3 workflow.

```
scripts/decompose.py <scope_path> --lang '<lang>' --exclude '<merged>' --profile-json
```

- `<scope_path>`: project root, module dir, or any walkable sub-folder.
- `--lang`: required. Same canonical names + aliases as the extract mode. Multi-lang via comma.
- `--exclude`: same semantics as extract mode (see Workflow § effective_exclude). The script ships with NO defaults beyond `.git`.
- `--profile-json`: emits `ProjectProfile` JSON to stdout and suppresses normal text output.

> **Note on `.gitignore`**: `.gitignore` uses glob/negation/anchored semantics that don't map cleanly to the script's segment-substring exclusion. The caller assembles the merged exclude (see Workflow § effective_exclude) and passes it explicitly via `--exclude`. The script does NOT parse `.gitignore` itself.

Outputs `ProjectProfile` JSON to stdout. Schema:

```json
{
  "scope_path": "/abs/path",
  "languages": ["csharp"],
  "skip_patterns": ["bin", "obj", "..."],
  "total_loc": 314217,
  "total_files": 4321,
  "module_count": 36,
  "edge_count": 40,
  "scc_count": 36,
  "scc_nontrivial": 0,
  "dag_depth": 6,
  "topology_hints": {
    "target_group_count": 6,
    "ideal_group_loc": 52369,
    "median_module_loc": 1182,
    "trivial_module_test": {"abs_loc": 500, "pct_total": 0.01, "op": "or"},
    "oversized_threshold": 50000
  },
  "modules": [
    {"name": "Nop.Core", "loc": 7143, "files": 355, "layer": 5, "in_deg": 4, "out_deg": 0, "flags": []}
  ],
  "dag_layers": [
    {"layer": 0, "module_count": 31, "loc": 69913}
  ],
  "warnings": ["LOW COVERAGE: 27% of project code is outside discovered modules."]
}
```

`topology_hints` field meanings:
- `target_group_count` — recommended number of topology groups: `ceil(total_loc / 80_000)`, clamped to `[max(2, ceil(module_count / 12)), max(2, ceil(module_count / 4))]`. Computed by L1.
- `ideal_group_loc` — `total_loc / target_group_count`. Used by grouping rules to size merges and judge group-LOC distribution.
- `trivial_module_test` — module is trivial iff `loc < abs_loc OR loc/total_loc < pct_total` (note: OR, not AND).

**Single source of truth**: profile mode and extract/validate mode share the same in-memory analysis pass — LOC counting, `--lang` semantics, and `--exclude` semantics are identical by construction. If you need grouping or `--validate`, omit `--profile-json` and invoke `decompose.py` directly.

---

## Anti-patterns
- ❌ Hand-computing quality scores instead of running L3 `--validate`
- ❌ Re-extracting modules/edges/LOC from raw source instead of using L1 output
- ❌ Grouping by name or functional domain instead of dependency affinity (e.g. "payment plugins" — group by topology, not by what modules do)
- ❌ Splitting or moving modules between groups to equalize LOC sizes (corrupts dependency graph — size rebalancing belongs upstream). Note: merging trivial modules per `grouping.md` §1 is topology-driven, not LOC rebalancing.
- ❌ Skipping L3 validation because the artifact "looks reasonable"

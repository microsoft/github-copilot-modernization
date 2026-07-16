# appmod.board.floor-check

Quality gate: before any worker is dispatched, ensure the board schedules the mandatory governance fragments that a hand-rolled board commonly drops. Enforces two fragments — **`cve-remediation`** (when the change touches a dependency manifest) and the **completeness / consistency check** (`conformance-review`, plus `feature-parity-signoff` when applicable), the latter **only when the user explicitly requests it**.

## Purpose

Fragment selection lives inside `skill(dag-generation)`. When the coordinator hand-rolls the board (common on small / lite projects with `deep_planning=false`), mandatory governance fragments are silently dropped even when warranted. This gate verifies the **outcome** — that the warranted governance task is on the board — **regardless of whether `dag-generation` was invoked**.

It deliberately checks **only** the governance fragments the LLM tends to skip:

- **`cve-remediation`** — warranted whenever the change emits or modifies a dependency manifest (implicit; the user need not ask).
- **completeness / consistency** (`conformance-review`, and `feature-parity-signoff` when applicable) — warranted whenever the user **explicitly requests** a completeness / consistency / feature-parity check (any change type: upgrade, migration, rewrite).

It does NOT check implementation / smoke-test / runtime-validation tasks — those are trusted to the LLM.

## When

`before_all`, after the board is written and before the first worker dispatch.

**Skip the whole gate (run nothing) when:**
- The board contains the deep-planning placeholder `⏳ [Execute + Validate phases — pending deep planning completion]`. The execute+validate tail (including `cve-remediation`, `conformance-review`, and `feature-parity-signoff`) is generated later in §3.2.2; this gate is **re-run there** — once §3.2.2 replaces the placeholder with the real execute+validate tasks, the coordinator re-invokes this floor-check against the now-complete board. So skipping here is safe: the arms are evaluated at §3.2.2, not lost.

## Inputs available from coordinator context

- `{{BASE_PATH}}/board.md` — the task list.
- `{{BASE_PATH}}/artifacts/project-profile.yaml` — `assessment.change_type`, `assessment.transformations`, `project` notes.
- The user's original request (`## User Input` in `board.md`).

## Required behavior

0. **Verify the board exists.** Confirm `{{BASE_PATH}}/board.md` is present and non-empty. At `before_all` it must already be written (it is the artifact the coordinator is about to dispatch from). If it is **missing or empty**, this is an upstream failure, not a pass condition — fail the gate and block dispatch with: `board.md is missing or empty at before_all; the board must be generated before any worker is dispatched.` Do NOT treat an absent board as "nothing warranted."

Then run **both** arms below. Reuse each fragment's own `when` / `skip-when` / `override` from `skill(dag-generation)` → `references/task-catalog.md` (do NOT invent new criteria).

### Arm A — `cve-remediation` (warranted by change nature)

1. **Decide whether `cve-remediation` is warranted**:
   - **Warranted (`when`)**: the planned change will **emit or modify a dependency manifest** (`pom.xml` / `build.gradle` / `*.csproj` / `packages.config` / `package.json` / lockfiles) — true for essentially every brownfield migration / upgrade / rewrite — OR the user mentions security / CVE / vulnerability, OR assessment/arch-analysis flagged vulnerable or EOL dependencies. Judge this from the change nature (`change_type`, `user_ask`, transformations), **not** from a `git diff` — at `before_all` no implementation has run yet, so the working tree shows no manifest change.
   - **Not warranted (`skip-when`)**: no dependency manifest is produced or changed (pure config/docs/asset change, or a dependency-free single-file edit); OR the user explicitly opted out of security/CVE work. Do NOT treat **lite scope** as not-warranted — a lite-scope change that still touches a dependency manifest must be scanned (this is exactly the small/lite case this gate exists to catch).
   - If **not** warranted → this arm passes silently.
2. **If warranted, check `board.md`** for a `cve-remediation` task. Match case-insensitively on task title / assignment: any task that indicates CVE scanning / vulnerability remediation — e.g. mentions `cve`, `vulnerab`, `dependency scan`, `remediat`, or explicitly invokes `skill(cve-remediation)`.

### Arm B — completeness / consistency (warranted by explicit user request)

3. **Decide whether a completeness / consistency check is warranted** — mirror the `dag-generation` "Explicit-request override":
   - **Warranted (`when`)**: `user_ask` **explicitly** requests a completeness, consistency, or feature-parity check (e.g. "run a completeness check", "verify nothing was missed / dropped", "enforce consistency", "feature parity sign-off", "make sure the migration / upgrade / rewrite is complete and consistent"). This applies to **any** change type (upgrade, migration, rewrite) — it is the explicit user intent, not the project size or change type, that warrants it.
   - **Not warranted**: the user did not explicitly ask for such a check. Implicit completeness is the LLM's to plan; this gate enforces only the **explicit** request.
   - If **not** warranted → this arm passes silently.
4. **If warranted, check `board.md`** for a completeness/conformance validation task. Match case-insensitively: any task that indicates completeness / conformance / consistency / feature-parity validation — e.g. mentions `conformance`, `completeness`, `consistency`, `feature parity` / `feature-parity`, or explicitly runs the completeness gate (`skill(quality-gates)` → `references/gate-completeness.md`). When the change is a migration / rewrite that has a `feature-inventory` task, a `feature-parity-signoff` task also counts toward this arm.

5. **For each warranted arm: present → pass; absent → fail** (see Failure semantics).

## Pass criteria

The gate passes when, for **each** arm, either the fragment is not warranted, or the board already contains the corresponding task.

## Failure semantics

This action is a **quality gate**. On failure (any warranted arm missing its task) the coordinator MUST NOT dispatch any worker. Append the missing task(s) to `board.md` (do NOT re-run `dag-generation`), then **re-run this floor-check**; dispatch may proceed once it passes.

**Arm A — append `cve-remediation`** in the Implementation phase (fragment is `after: [implementation]`, `scope: per-group`, implementer/backend role). The task MUST instruct the worker to **use `skill(cve-remediation)`**, so the skill's existing scan→fix→verify workflow is reused — do NOT hand-roll an ad-hoc CVE check. Example board line:

   ```text
   - ⏳ t<N> [backend] Scan dependency manifests for CVEs and remediate via skill(cve-remediation) [deps: <implementation task id>]
   ```

**Arm B — append `conformance-review`** in the Validate phase (fragment is `after: [runtime-validation, test-strategy]`, `scope: global`, teamlead role). The task MUST run the completeness gate (`skill(quality-gates)` → `references/gate-completeness.md`), which performs the change-type-aware consistency check (migration / rewrite → functional-equivalence; upgrade → upgrade-consistency). Example board line:

   ```text
   - ⏳ t<N> [teamlead] Completeness & consistency check via skill(quality-gates) gate-completeness [deps: <last validation task id>]
   ```

   When the change is a migration / rewrite with a `feature-inventory` task, also ensure a `feature-parity-signoff` task is present (pm role: verify the feature-inventory checklist is fully covered — no missing endpoints, UI flows, or business rules).

> Rationale for "append, don't re-plan": the board is trusted for everything else (implementation / smoke-test / validation are the LLM's to plan). This gate surgically restores only the governance tasks that hand-rolled boards drop, rather than regenerating the whole DAG.

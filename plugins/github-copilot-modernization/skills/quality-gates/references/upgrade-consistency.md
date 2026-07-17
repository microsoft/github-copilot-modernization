---
name: Upgrade Consistency Verification
description: Verify that a same-stack upgrade (version bump / SDK or dependency swap) was applied completely and consistently — no residual old version, no mixed old/new usage, every call site migrated.
mode: upgrade
---

## Overview

This is the **consistency arm** of the completeness gate for `change_type: upgrade`
(version bumps, SDK swaps, dependency updates, same-stack modernization — e.g. an
Azure SDK major-version upgrade). Unlike a cross-stack rewrite, an upgrade does not
need *functional equivalence* of rewritten business logic; what matters is that the
upgrade was applied **completely and consistently** across the whole codebase, leaving
no partial-migration state behind.

A small/simple upgrade is exactly where this check matters most: the multi-agent
ceremony is light, so it is easy to bump a dependency in one module and silently leave
the old API in use elsewhere.

## When to Use

- **Mode**: `change_type: upgrade` (same-stack version bump / dependency or SDK swap)
- **Phase**: Completeness Check — invoked by the completeness gate (`gate-completeness.md` step 7)
- **Prerequisites**: Implementation complete; build/smoke-test evidence available
- **Inputs**: the user-specified target (library + version), the project profile
  (`assessment.transformations` fromStack/toStack and versions), and the changed files

## Consistency Definition

An upgrade is **consistent** when:
- The target library/SDK is at the requested version **everywhere** it is declared
- No source file still imports, references, or calls the **old** API/package/namespace
- No module is left on the **old** version (no mixed old/new across the build)
- Every deprecated/removed symbol from the old version has been replaced
- Configuration, properties, and build/dependency metadata match the new version
- The full build and tests are green (per the **Build Verdict** in `gate-completeness.md`)

## Checklist (all CRITICAL unless noted)

- [ ] **Target version reached** — every declaration of the upgraded artifact is at the
      requested target version. No declaration left at the old version. → *CRITICAL*
- [ ] **No residual old API** — no remaining imports / package references / namespace
      usages / API calls belonging to the old version anywhere in source. Grep the old
      package/namespace and confirm zero in-scope hits (excluding generated/vendored code). → *CRITICAL*
- [ ] **No mixed old/new versions** — a single coherent version across all modules and
      the dependency/BOM graph; no module still resolves the old version transitively
      where it is used directly. → *CRITICAL*
- [ ] **Deprecated/removed symbols replaced** — every symbol removed or deprecated by the
      target version has a migrated replacement; none left calling a removed API. → *CRITICAL*
- [ ] **Config & metadata updated** — properties, config files, and build descriptors
      reference the new version's expected keys/coordinates, not the old ones. → *HIGH*
- [ ] **Build & tests green** — full root-level build passes and tests pass per the
      Build Verdict; no module excluded to make the upgrade "pass". → *CRITICAL*
- [ ] **Target version preserved** — the delivered version matches the user-requested
      target verbatim; it was not downgraded or substituted to an LTS/familiar default. → *CRITICAL*

## Verification Strategy

1. Read the requested target (library + version) from `user_ask` and
   `assessment.transformations` (fromStack/fromStackVersion → toStack/toStackVersion).
2. **Version sweep** — enumerate every place the artifact's version is declared
   (e.g. `pom.xml`/`build.gradle`/BOM, `package.json`, lockfiles, `.csproj`). Confirm
   all are at the target version; record any left at the old version.
3. **Residual-old sweep** — search the source tree for the old package / namespace /
   import / API symbols. Any in-scope hit is a partial migration → CRITICAL.
4. **Mixed-version check** — resolve the effective dependency graph; flag any module
   that still uses the old version directly while others use the new one.
5. **Deprecation check** — for symbols removed/deprecated between source and target
   versions, confirm each usage was migrated to the replacement.
6. **Config/metadata check** — verify config keys, coordinates, and build descriptors
   match the new version.
7. **Build/test confirmation** — confirm the Build Verdict is PASS and tests passed.

## Report

Write findings into `migration-summary.md` (the completeness gate's report). Include a
short table of: declarations swept (old→new), residual-old hits (file:line), mixed-version
modules, unmigrated deprecated symbols, and the build/test verdict.

## Verdict

- **PASS**: target version reached everywhere, zero residual-old usage, no mixed
  versions, deprecated symbols replaced, build/tests green, requested version preserved.
- **FAIL**: any residual old API, any module left on the old version, any unmigrated
  removed/deprecated symbol, a downgraded/substituted target, or a non-green/scoped build.

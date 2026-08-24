---
name: assessment
description: Run a fully local application assessment for one Java, .NET, or JavaScript/TypeScript repository
user-invocable: false
---

# Application Assessment

Assess one repository using only plugin-shipped skills, scripts, AppCAT, npm-check-updates, and GitHub advisory access. Assessment must not call any MCP tool. The App Modernization MCP server remains available to other phases, but it is outside this skill's execution path.

## Inputs

- `workspace-path`: Absolute project root. Defaults to the current directory.
- `invocation-mode`: `standalone`, `coordinator`, or `batch-headless`.
- `attempt-request-path` (batch-headless only): Absolute v1 request artifact created by the batch control plane.
- `config` (optional): Explicit user overrides only. Never infer or fill unspecified fields.
  - `domains`: `java-upgrade`, `cloud-readiness`, `security`
  - `analysisCoverage`: `issue-only` or `full`
  - `targetRuntime`, `targetComputeServices`, `enableContainerization`, `targetOS`
  - `minimumCveSeverity`, `cveScanScope`

Defaults:

- Java: domains `java-upgrade,cloud-readiness`; coverage `issue-only`.
- .NET: domain `cloud-readiness`; coverage `issue-only`.
- JavaScript/TypeScript: local dependency assessment; automated Planning remains unsupported.

In `batch-headless` mode, never call `ask_user`. Read workspace, scope, approval, config, attempt scratch, and result path only from the request artifact. Batch Assessment accepts only fully approved input; missing required information fails the attempt instead of selecting a default or starting a persisted `NeedsInput` exchange.

## Hard Boundaries

- Do not invoke any MCP tool during assessment.
- Do not discover or execute skills outside the plan produced by `assessment-catalog.mjs`.
- Do not modify application source or build manifests.
- Subagent text is not completion evidence; verify files and normalize results through `assess-cli.mjs`.

## 1. Bootstrap And Detect Language

The plugin SessionStart hook installs the runtime at:

```text
.github/modernize/.runtime/assessment/assess-cli.mjs
```

For a different `workspace-path`, bootstrap it explicitly:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs bootstrap \
  --workspace-path <workspace-path>
```

Detect from the supplied root:

- Java: `pom.xml`, `build.gradle`, `build.gradle.kts`, or Java source.
- .NET: `.sln`, `.slnx`, `.csproj`, or C# source.
- JavaScript/TypeScript: `package.json`.
- Mixed Java/.NET root: assess each detected project root independently.
- No supported indicator: stop with an actionable error.

## 2. Prepare The Local Run

Create a UTC `yyyyMMddHHmmss` run ID, then call:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs prepare-run \
  --workspace-path <workspace-path> \
  --run-id <run-id> \
  --language <java|dotnet|javascript|typescript> \
  --domains <comma-separated-domains> \
  --coverage <issue-only|full>
```

Treat its JSON output as the only assessment task plan. It prepares run state, removes stale canonical outputs, and returns paths for AppCAT, findings, reports, and independent subagent batches.

For `batch-headless`, also pass attempt-scoped controls from the request:

```bash
  --attempt-scratch-root <attempt-directory>/scratch \
  --max-concurrency <request.decisions.maxConcurrency>
```

These options isolate AI task outputs and cap each wave. Omitting them preserves the single-repository paths and 6/7 task ceilings.

## 3. Run Deterministic Local Engines

### Java And .NET AppCAT

Run AppCAT when `cloud-readiness` or `java-upgrade` is selected:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs ensure-appcat \
  --language <java|dotnet>

node .github/modernize/.runtime/assessment/assess-cli.mjs run-appcat \
  --language <java|dotnet> \
  --workspace-path <workspace-path> \
  --run-dir <appcat-dir> \
  --mode issue-only
```

Pass explicitly requested targets, capabilities, or target OS to `run-appcat`; otherwise use runtime defaults. Full coverage does not change AppCAT mode: it adds the six fact documents in the next section.

Normalize the produced report:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs integrate-appcat \
  --report <appcat-dir>/report.json \
  --findings <findings-path> \
  --run-id <run-id>
```

If AppCAT fails, continue only with explicitly selected batches that do not require it and return `partial`.

### JavaScript/TypeScript Dependencies

Run the pinned npm-check-updates release without modifying `package.json`:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs run-ncu \
  --package-json <workspace-path>/package.json \
  --output-dir <run-dir>/javascript \
  --run-id <run-id> \
  --findings <findings-path>
```

Record the generated JSON result through `record-result`. Return `planningSupported: false`.

## 4. Execute Plugin-Owned AI Batches

Use only the batches returned by `prepare-run`. Execute batches one at a time. In standalone/coordinator mode, issue the batch's subagent calls in one assistant turn. In `batch-headless`, partition tasks in catalog order into waves no larger than the returned `maxConcurrency`; issue one wave in one assistant turn, wait for all results, then issue the next wave. Result requirements do not change when capacity is 1.

### Full-Coverage Facts: Exactly 6

Coverage `full` contains exactly these plugin-level skills:

1. `architecture-diagram`
2. `dependency-map`
3. `api-service-contracts`
4. `data-architecture`
5. `configuration-inventory`
6. `business-workflows`

Each subagent receives `workspace-path` and its plan-provided output path. Each owns one Markdown file under `.github/modernize/assessment/engines/facts/`. Dispatch all six concurrently and verify all six files exist. Do not launch granular `fact-*` skills; they are not part of this implementation.

### Security: Exactly 7

The local security batch contains:

- `cve-known-vulnerabilities`; and
- six CWE category skills:
  - `cwe-code-quality`
  - `cwe-concurrency-synchronization`
  - `cwe-credentials-secrets`
  - `cwe-file-path-security`
  - `cwe-injection-attacks`
  - `cwe-memory-safety`

All seven are independent top-level plugin skills under `skills/<skill-id>/SKILL.md`; none is nested under `assessment`.

Dispatch all seven subject to the plan-provided concurrency ceiling. Save each complete subagent result to its plan-provided JSON output path, then normalize every result:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs record-result \
  --skill <skill-id> \
  --input <output-path> \
  --findings <findings-path> \
  --run-id <run-id> \
  --run-dir <run-dir>
```

Every CWE rule must end as FOUND or NOT_FOUND. A missing/malformed result or PENDING rule makes security partial; never synthesize an empty success.

### Concurrency

There is no fixed 12-subagent scheduler:

- facts batch: 6 concurrent subagents;
- security batch: 7 concurrent subagents;
- AppCAT-only assessment: no AI subagents.

When both security and full coverage are selected, execute the two batches separately. Do not merge them into a 13-subagent turn. The maximum concurrency permitted by this catalog is 7. Batch correctness must also hold at a ceiling of 1.

## 5. Generate And Verify Reports

Generate the self-contained local report from normalized findings:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs generate-report \
  --memory-dir <memory-dir> \
  --run-id <run-id> \
  --output-dir <html-reports-dir> \
  --project-root <workspace-path> \
  --enrichment /dev/null
```

Generate the Planning compatibility report:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs generate-compat-report \
  --memory-dir <memory-dir> \
  --run-id <run-id> \
  --output-dir <reports-dir> \
  --language <java|dotnet|javascript|typescript> \
  --solution-mapping .github/modernize/.runtime/assessment/solution-mapping.json
```

For full coverage, archive and verify all six fact documents beside the compatibility report:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs archive-facts \
  --workspace-path <workspace-path> \
  --report <compatibility-report-path> \
  --coverage full \
  --facts-root <attempt-directory>/scratch/engines/facts
```

Omit `--facts-root` outside batch mode to preserve the canonical single-repository source path.

Completion requires:

- versioned compatibility `report.json` exists and parses;
- HTML report exists;
- AppCAT report exists when an AppCAT domain was selected;
- all seven security outputs have terminal data when security was selected;
- all six fact Markdown files are archived when coverage is full.

## Required Return

Return:

- status: `success`, `partial`, `cancelled`, or `failed`;
- detected language;
- selected domains and coverage;
- finding counts and top recommendations;
- HTML and compatibility report paths;
- six fact paths for full coverage;
- failed or missing local tasks;
- `planningSupported`: true for Java/.NET, false for JavaScript/TypeScript.

Coordinator and batch-headless modes do not show a standalone next-action menu. Standalone mode presents the report and stops; implementation fixes are outside this skill.
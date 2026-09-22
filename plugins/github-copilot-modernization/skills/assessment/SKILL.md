---
name: assessment
description: Run a fully local application assessment for one Java, .NET, or JavaScript/TypeScript repository
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

For `standalone` and `coordinator`, `config.analysisCoverage` is the only authority for a non-default coverage. A missing field always resolves to coverage `issue-only` with source `default`; a present valid field resolves to that exact value with source `explicit-user`. Never infer coverage from the request wording, repository content, size, complexity, technologies, or expected findings. For `batch-headless`, use the approved `request.decisions.analysisCoverage` with source `approved-batch`.

Defaults:

- Java: domains `java-upgrade,cloud-readiness`; coverage `issue-only`; capability `openjdk25`; target OS `windows,linux`; minimum CVE severity `high`; CVE scan scope `direct`.
- .NET: domain `cloud-readiness`; coverage `issue-only`.
- JavaScript/TypeScript: local dependency assessment; automated Planning remains unsupported.

In `batch-headless` mode, never call `ask_user`. Read workspace, scope, approval, config, attempt scratch, and result path only from the request artifact. Batch Assessment accepts only fully approved input; missing required information fails the attempt instead of selecting a default or starting a persisted `NeedsInput` exchange.

## Hard Boundaries

- Do not invoke any MCP tool during assessment.
- Do not discover or execute skills outside the plan produced by `assessment-catalog.mjs`.
- Do not modify application source or build manifests.
- Subagent text is not completion evidence; verify files and normalize results through `assess-cli.mjs`.

## 1. Bootstrap And Detect Language

The coordinator derives the source CLI from this skill's absolute loaded `SKILL.md` path and bootstraps the workspace runtime on demand at:

```text
.github/modernize/.runtime/assessment/assess-cli.mjs
```

Bootstrap the supplied `workspace-path` directly from the loaded skill before using the workspace runtime:

```bash
node <loaded-assessment-skill>/scripts/assess-cli.mjs bootstrap \
  --workspace-path <workspace-path>
```

Never guess the loaded skill path or derive it from a plugin-root environment variable.

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
  --coverage <effective-coverage> \
  --coverage-source <default|explicit-user|approved-batch>
```

The coverage value and source must be the pair resolved from the input contract above. In particular, `config: {}` requires `--coverage issue-only --coverage-source default`; `config: {"analysisCoverage":"full"}` requires `--coverage full --coverage-source explicit-user`.

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

Pass only explicitly requested targets, capabilities, or target OS to `run-appcat`. Do not turn the public report metadata defaults into AppCAT execution filters; the canonical publisher supplies Java capability `openjdk25` and target OS `windows,linux` when no override was requested. Full coverage does not change AppCAT mode: it adds the six fact documents in the next section.

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

Use only the batches returned by `prepare-run`. Execute batches one at a time and execute every catalog task yourself, serially, in catalog order. Never invoke a subagent, general-purpose agent, coordinator, router, or phase agent. Load exactly the task's `skill-id`, pass its absolute `workspace-path`, plan-provided absolute `output-path`, and explicit task settings, then finish and normalize that result before loading the next skill. The returned `maxConcurrency` is a ceiling; serial execution is required in standalone, coordinator, and `batch-headless` modes.

### Full-Coverage Facts: Exactly 6

Coverage `full` contains exactly these plugin-level skills:

1. `architecture-diagram`
2. `dependency-map`
3. `api-service-contracts`
4. `data-architecture`
5. `configuration-inventory`
6. `business-workflows`

Each skill execution receives `workspace-path` and its plan-provided output path. Each owns one Markdown file under `.github/modernize/assessment/engines/facts/`. Execute all six serially and verify all six files exist. Do not launch granular `fact-*` skills; they are not part of this implementation.

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

Execute all seven serially. Save each complete skill result to its plan-provided JSON output path, then normalize every result:

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

There is no subagent scheduler. Facts and security tasks run serially in separate batches; AppCAT-only Assessment has no AI task batch. When both security and full coverage are selected, finish one batch before starting the next. The catalog retains a maximum concurrency value for request compatibility, but the phase agent always operates at effective concurrency 1.

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

Generate the internal normalized Assessment after every deterministic engine and AI batch has finished:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs generate-normalized-assessment \
  --memory-dir <memory-dir> \
  --run-id <run-id> \
  --language <java|dotnet|javascript|typescript> \
  --solution-mapping .github/modernize/.runtime/assessment/solution-mapping.json
```

This writes `.github/modernize/.memory/runs/<run-id>/normalized-assessment.json`. It is an internal Planning and Batch validation sidecar, not a public assessment report. Do not show its path in the user-facing Assessment summary.

For Java/.NET runs with an AppCAT report, publish the public canonical report after normalization so plugin-owned CVE/CWE findings can be merged into `security[]`:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs publish-appcat-report \
  --source <appcat-dir>/report.json \
  --memory-dir <memory-dir> \
  --output-dir <reports-dir> \
  --run-id <run-id> \
  --language <java|dotnet> \
  --domains <comma-separated-domains> \
  --coverage <issue-only|full>
```

For JavaScript/TypeScript and security-only runs without AppCAT, synthesize the same public Unified report shape from complete assessment memory:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs generate-canonical-report \
  --memory-dir <memory-dir> \
  --output-dir <reports-dir> \
  --workspace-path <workspace-path> \
  --run-id <run-id> \
  --language <java|dotnet|javascript|typescript> \
  --domains <comma-separated-domains> \
  --coverage <issue-only|full>
```

Both paths create `.github/modernize/assessment/reports/report-<run-id>/report.json` with the established public `producer + metadata + summary + projects + rules + security` structure. The internal normalized sidecar uses `schemaVersion: 1` and never reuses the public report's `version` field.

For full coverage, archive and verify all six fact documents beside the canonical report:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs archive-facts \
  --workspace-path <workspace-path> \
  --report <canonical-report-path> \
  --coverage full \
  --facts-root <attempt-directory>/scratch/engines/facts
```

Omit `--facts-root` outside batch mode to preserve the canonical single-repository source path.

Finally, validate the completed run and derive the return evidence from disk. For `batch-headless`, use the machine JSON presentation:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs verify-artifacts \
  --workspace-path <workspace-path> \
  --run-id <run-id> \
  --language <java|dotnet|javascript|typescript> \
  --domains <comma-separated-domains> \
  --coverage <issue-only|full> \
  --report <absolute-canonical-report-path> \
  --normalized-assessment <absolute-normalized-assessment-path> \
  --html <absolute-versioned-html-report-path> \
  --appcat-report <absolute-appcat-report-path> \
  --security-root <absolute-security-output-directory>
```

For `coordinator` or `standalone`, pass the same artifact roles and request the deterministic public-style presentation:

```bash
node .github/modernize/.runtime/assessment/assess-cli.mjs verify-artifacts \
  --workspace-path <workspace-path> \
  --run-id <run-id> \
  --language <java|dotnet|javascript|typescript> \
  --domains <comma-separated-domains> \
  --coverage <issue-only|full> \
  --report <absolute-canonical-report.json> \
  --normalized-assessment <absolute-normalized-assessment.json> \
  --html <absolute-versioned-html-report-path> \
  --appcat-report <absolute-appcat-report-path> \
  --presentation user
```

Omit `--appcat-report` when no AppCAT domain was selected. Omit `--security-root` when security was not selected; outside batch mode its canonical default is used. This command is the only completion authority. Do not return `success` unless it exits zero and its receipt's `artifactValidation` is exactly `passed`. The user presentation writes that complete receipt to `verification.json` beside canonical `report.json` and includes the exact `Verification: passed` line plus its path. In coordinator mode, this must be the final tool call: immediately return its complete stdout verbatim with no wrapper, summary, field renaming, additional command, or recalculation. In standalone or batch-headless mode, copy paths, finding counts, top recommendation, and partial task IDs only from that receipt; do not infer or reconstruct them from prior command output or subagent text. A nonzero exit makes the run `partial` or `failed` with the verifier error and must never be converted into success.

Completion requires:

- public-compatible versioned `report.json` exists and parses for every language and domain combination;
- internal `normalized-assessment.json` exists, validates against its v1 schema, and matches the run request;
- HTML report exists;
- AppCAT report exists when an AppCAT domain was selected;
- all seven security outputs have terminal data when security was selected;
- all six fact Markdown files are archived when coverage is full.

## Required Return

Return:

- status: `success`, `partial`, `cancelled`, or `failed`;
- the complete final verifier output without changing any field;
- `artifactValidation`: exactly `passed` for `success`;
- the verifier's nested `completionEvidence` object;
- detected language;
- selected domains and coverage;
- finding counts and top recommendations;
- canonical report, HTML, and verification paths; the normalized sidecar remains inside the verification receipt;
- six fact paths for full coverage;
- failed or missing local tasks;
- `planningSupported`: true for Java/.NET, false for JavaScript/TypeScript.

Coordinator mode returns the verifier's deterministic natural-language summary and persisted `verification.json` evidence. Batch-headless returns machine JSON and does not show a standalone next-action menu. Standalone mode presents the report and stops; implementation fixes are outside this skill.
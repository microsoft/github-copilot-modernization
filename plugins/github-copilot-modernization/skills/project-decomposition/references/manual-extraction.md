# Manual Extraction (L1 fallback for unsupported languages)

Load this only when the L1 invocation (`scripts/decompose.py`) reports `Unsupported language`. Supported languages: C#, Java, Python, JavaScript/TypeScript.

For unsupported languages, you must produce L1 data (modules, edges, LOC, SCCs, DAG layers) using the same schema decompose.py outputs. To use L3 (`--validate`), the data must be machine-readable in the script's format — write a small wrapper or extend decompose.py for the new language.

## §1 Declarative Sources (preferred)

| Ecosystem | File | What to parse |
|-----------|------|---------------|
| .NET / C# | `*.csproj` | `<ProjectReference Include="...">` |
| .NET / C# | `Directory.Build.props`, `*.props` | `<Import>` chains → transitive `<ProjectReference>` |
| Maven / Java | `pom.xml` | `<dependency>` with matching `<groupId>` |
| Gradle / Java | `build.gradle(.kts)` | `implementation project(":sub")` |
| Python / Odoo | `__manifest__.py` | `'depends': [...]` list |
| Python / Frappe | `modules.txt` | module names (edges from import analysis) |
| Node / TS | `package.json` | `dependencies` / `devDependencies` with workspace refs |
| Go | `go.mod` | `require` directives |
| Rust | `Cargo.toml` | `[dependencies]` with `path = "..."` |

**Props/BOM chains**: Some ecosystems use inheritance/import files that inject implicit dependencies (.NET `Directory.Build.props`, Maven parent POM `<dependencyManagement>`, Gradle convention plugins). Follow the full chain.

## §2 Import-Based Fallback (no declarative source)

For monoliths/legacy systems:

1. Scan all source files for import/using/require statements.
2. Map each import to its owning module/package.
3. Aggregate class-level imports to module-level edges (deduplicate).
4. Same source→target = 1 edge regardless of scope/classifier.

## §3 Exclusion Rules

- **Version management / BOM declarations are NOT edges** — Maven `<dependencyManagement>`, Gradle `platform()`, .NET `Directory.Packages.props`, npm `peerDependencies` only declare versions, not coupling.
- **Test imports** — exclude unless the test module is a declared project module.
- **Vendored / third-party code** — exclude.

## §4 When Static Parsing Looks Incomplete

If declarative source + import scan yield coverage < 80% or obviously miss known dependencies:

- **Do NOT invoke external build tools at runtime** (no `mvn dependency:tree`, no `pipdeptree`, no `gradle dependencies`, no `dotnet list reference`). These require build environments, network access, or installed toolchains the agent cannot assume.
- **Preferred**: extend `scripts/decompose.py` to parse the missing declarative source (props chain, parent POM `<dependencyManagement>`, lockfile workspace hoisting, etc.). This is a skill maintenance task, not per-invocation work.
- **Acceptable per-invocation**: hand-write a small JSON file matching the schema in §5 below, skip L3 `--validate` for that run, and note `Provenance: manual extraction` in the artifact. Do not pretend coverage is higher than it is.

## §5 Constraints

- Use only languages and tools already on the machine. No `pip install` / `npm install`.
- LOC = effective (skip blank + comment lines).
- Match decompose.py's output schema so L3 `--validate` works.

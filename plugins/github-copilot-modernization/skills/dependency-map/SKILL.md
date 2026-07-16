---
name: dependency-map
description: Generate dependency map diagram from project build files
---

# Dependency Map

Analyze project build and package files to generate a visual map of all external dependencies grouped by functional category. Save to `.github/modernize/assessment/engines/facts/dependency-map.md`.

This skill focuses exclusively on **declared external dependencies** (libraries, frameworks, packages). For internal application structure and component relationships, see the `architecture-diagram` skill.

## Input Parameters

- `workspace-path` (optional): Path to the project to analyze (defaults to current directory)

## ⚠ Mermaid Safety Constraints — read BEFORE you write the ```mermaid block

Mermaid is unforgiving: one illegal character anywhere in the block crashes the **whole** diagram with `Syntax error in text`, not just the offending line. Stay strictly inside this subset:

1. **Chart kind.** `flowchart LR` only.
2. **Subgraph form.** Always `subgraph <AlphaNumId>["display label"]` (id matches `[A-Za-z][A-Za-z0-9_]*`, no spaces, no punctuation). NEVER use the anonymous form `subgraph "label"` — it crashes whenever the label contains `(`, `)`, `/`, `-`, etc.
3. **Node form.** Use `Id["label"]` for libraries; pick one shape per node — do not stack brackets.
4. **Arrow form.** Solid `-->`, dotted `-.->` for transitive/indirect. Arrow labels MUST be double-quoted: `-->|"persistence"|`. Never bare `-->|persistence|`.
5. **No line breaks in labels.** The escape `\n` was removed in modern Mermaid and is the #1 cause of failures. Keep labels on one line (e.g., `"Spring Boot 2.7.18"` not `"Spring Boot\n2.7.18"`).
6. **Banned characters inside any label or subgraph title.** Use the ASCII replacement:

   | Banned | Why it breaks | Replacement |
   |---|---|---|
   | `\n` (literal two chars) | escape removed | drop, or `<br/>` |
   | `—` (em-dash, U+2014) | parser treats as edge | `-` (ASCII hyphen) |
   | `–` (en-dash, U+2013) | parser treats as edge | `-` |
   | `{` `}` | opens an entity block | drop braces |
   | `"` inside a label | closes the label early | `'` (single quote) |
   | `\|` inside a label | breaks edge-label parser | rephrase |
   | `@` `#` `$` `%` `&` | unsafe | rephrase or drop |
   | `(` `)` outside `["..."]` | unbalanced parens crash | only inside the quoted label |
   | smart quotes `"` `"` `'` `'` | not ASCII | regular `"` and `'` |

7. **Unique node IDs across the whole diagram.** No two nodes/subgraphs may share an id.
8. **`subgraph` must be closed by a matching `end` on its own line.**

### Mandatory self-attestation

Immediately before writing the ` ```mermaid ` opening fence, emit this exact one-line HTML comment in the markdown (it does not render — it is for your own visible attestation):

```
<!-- mermaid-checked: no \n, no em-dash/en-dash, no {} in labels, subgraphs are id["label"], arrows are -->|"label"|, all subgraphs closed by end, ids unique -->
```

If you cannot truthfully emit that comment, fix the diagram first.

---

## Execution Steps

### Step 1: Generate Dependencies Section

Analyze build files and produce the complete `## Dependencies` section in one pass:

**Analysis — examine only build and package management files** (do NOT scan source code — that is the `architecture-diagram` skill's job):

- Java: pom.xml, build.gradle, settings.gradle, gradle.properties, gradle lockfiles
- .NET: *.csproj, Directory.Build.props, packages.config, Directory.Packages.props
- JavaScript/TypeScript: package.json, package-lock.json, yarn.lock, pnpm-lock.yaml

For each dependency extract:
- Group/package name and artifact name
- Declared version (or version range)
- Scope (compile, runtime, test, provided)

Also detect:
- Parent POM / BOM imports (Java)
- Central package management (.NET Directory.Packages.props)
- Transitive dependencies where visible from lock files or BOM

**Categorize** dependencies into functional groups:

| Category | Examples |
|----------|----------|
| Web Frameworks | Spring Web, ASP.NET Core MVC, JAX-RS |
| Database / ORM | Hibernate, Entity Framework, JDBC drivers |
| Messaging | Kafka client, RabbitMQ, Azure Service Bus |
| Caching | Redis, EhCache, MemoryCache |
| Logging | SLF4J, Log4j, Serilog, NLog |
| Security | Spring Security, Microsoft.Identity, OAuth libs |
| Observability | Micrometer, OpenTelemetry, Application Insights |
| Utilities | Guava, Apache Commons, Lombok, AutoMapper |

Rules:
- Exclude test-scoped dependencies (JUnit, xUnit, Mockito, etc.) from the main diagram and Dependency Summary table — they are not relevant for modernization planning
- If a dependency doesn't fit any category, put it under "Utilities"
- Collect test-scoped dependencies separately for the Test Dependencies section (Step 2)

**Diagram — Mermaid `flowchart LR`** (re-read the Safety Constraints above before writing):
- Application as the central left-side node
- One `subgraph` per functional category, using the `subgraph Id["display label"]` form
- Each dependency as a node showing name and version: `Lib["Library Name 1.2.3"]` (single line, no `\n`)
- Arrows from Application to each category subgraph
- If a BOM/parent POM manages versions, show it as a separate node linked to the dependencies it governs

Reference example (this block satisfies every Safety Constraint — match its shape):

<!-- mermaid-checked: no \n, no em-dash/en-dash, no {} in labels, subgraphs are id["label"], arrows are -->|"label"|, all subgraphs closed by end, ids unique -->
~~~mermaid
flowchart LR
    App["MyApplication"]

    subgraph Web["Web Frameworks"]
        SpringMVC["Spring MVC 5.3.x"]
        Thymeleaf["Thymeleaf 3.0"]
    end
    subgraph DB["Database / ORM"]
        Hibernate["Hibernate 5.6"]
        PgDriver["PostgreSQL Driver 42.6"]
    end
    subgraph Messaging["Messaging"]
        Kafka["Kafka Client 3.4"]
    end
    subgraph Cache["Caching"]
        Redis["Jedis 4.3"]
    end
    subgraph Log["Logging"]
        SLF4J["SLF4J 1.7"]
        Logback["Logback 1.2"]
    end
    subgraph Sec["Security"]
        SpringSec["Spring Security 5.7"]
    end
    subgraph Util["Utilities"]
        Lombok["Lombok 1.18"]
        Jackson["Jackson 2.14"]
    end

    App -->|"web"| Web
    App -->|"persistence"| DB
    App -->|"messaging"| Messaging
    App -->|"caching"| Cache
    App -->|"logging"| Log
    App -->|"security"| Sec
    App -->|"utilities"| Util
    SLF4J -.->|"implementation"| Logback
~~~

**Textual explanations (write immediately after the diagram):**
- **Dependency Summary table**: Category | Count | Key Libraries | Notes (e.g., Web Frameworks | 2 | ASP.NET MVC 5.2.7, Razor 3.2.7 | Legacy MVC stack on .NET Framework)
- **Version & Compatibility Risks**: A short paragraph highlighting dependencies that are outdated, end-of-life, or have known migration concerns (e.g., ".NET Framework 4.7.2 is in maintenance mode; Entity Framework 6 has a migration path to EF Core")
- **Notable Observations**: 2-4 bullet points on anything noteworthy — duplicate functionality across libraries, deprecated packages, security-sensitive dependencies, or unusually large transitive trees

### Step 2: Generate Test Dependencies Section

Collect all test-scoped dependencies (excluded from the main diagram) and produce the complete `## Test Dependencies` section:

- List detected test frameworks and supporting libraries with their versions (e.g., JUnit 5, Mockito, AssertJ, Testcontainers, xUnit, Jest)
- Report the total number of test-scope dependencies
- Note any test infrastructure concerns (e.g., outdated test framework version, missing contract-testing library, no integration test framework detected)

### Step 3: Save Output

Save to `.github/modernize/assessment/engines/facts/dependency-map.md` with this exact structure:

```
# Dependency Map

A brief introduction (1-2 sentences) stating project name and total dependency count.

## Dependencies

< Mermaid flowchart LR here >

### Dependency Summary

[Table: Category | Count | Key Libraries | Notes]

### Version & Compatibility Risks

[Short paragraph on outdated or end-of-life dependencies]

### Notable Observations

[2-4 bullet points on noteworthy findings]

## Test Dependencies

[Table: Framework | Version | Notes]

Total test-scope dependencies: N
[1-2 sentences on test infrastructure observations, or "No test dependencies detected."]
```

## Scaling Rules

- If the project has **more than 50 declared dependencies**, collapse minor utilities into a single aggregate node (e.g., `Utils["12 utility libraries"]`) and only show individually the top dependencies by importance
- Keep the diagram under **40 nodes** to ensure readability and GitHub rendering compatibility
- For multi-module projects (e.g., multi-module Maven/Gradle, multi-project .sln), show shared dependencies once and module-specific dependencies grouped by module

## Common failure patterns observed in past runs

Each row below is something the model actually produced that crashed the diagram. Use the ✅ form.

| ❌ Past mistake | ✅ Safe form | Why the ❌ crashed |
|---|---|---|
| `subgraph "Database / ORM"` | `subgraph DB["Database / ORM"]` | Anonymous subgraph + `/` in title |
| `Spring["Spring Boot\n2.5.12"]` | `Spring["Spring Boot 2.5.12"]` | Literal `\n` |
| `App -->\|persistence\| DB` | `App -->\|"persistence"\| DB` | Bare arrow label |
| `Lib["Spring Boot — 2.5"]` | `Lib["Spring Boot - 2.5"]` | em-dash inside label |
| `Lib["foo {bar}"]` | `Lib["foo bar"]` | `{}` inside label |

## Error Handling

- **Unsupported project type**: Output a single line: `> ERROR: Unsupported project type. This skill supports Java, .NET, JavaScript, and TypeScript projects only.`
- **No build files found**: Output: `> ERROR: No recognized build files found at workspace-path. Verify the path is correct.`
- **Incomplete dependency info**: Generate a best-effort diagram from available data. Add a note inside the diagram: `Note["Some dependencies could not be fully resolved"]`

## Success Criteria

- Mermaid diagram renders correctly with dependencies grouped by functional category
- Each dependency shows name and version
- Dependency Summary table lists categories with counts and key libraries
- Version & Compatibility Risks paragraph highlights outdated or end-of-life dependencies
- Notable Observations lists 2-4 noteworthy findings
- Test Dependencies section lists detected test frameworks with versions and total count
- The ```mermaid block is preceded by the `<!-- mermaid-checked: ... -->` attestation comment
- File saved to `.github/modernize/assessment/engines/facts/dependency-map.md`

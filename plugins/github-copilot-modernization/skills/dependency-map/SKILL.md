---
name: dependency-map
description: Generate dependency map diagram from project build files
---

# Dependency Map

Analyze project build and package files to generate a visual map of all external dependencies grouped by functional category. Save to `.github/modernize/assessment/engines/facts/dependency-map.md`.

This skill focuses exclusively on **declared external dependencies** (libraries, frameworks, packages). For internal application structure and component relationships, see the `architecture-diagram` skill.

## Input Parameters

- `workspace-path` (optional): Path to the project to analyze (defaults to current directory)

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

**Diagram — Mermaid `flowchart LR`:**
- Application as the central left-side node
- One `subgraph` per functional category
- Each dependency as a node showing name and version: `Lib["Library Name v1.2.3"]`
- Arrows from Application to each category subgraph
- If a BOM/parent POM manages versions, show it as a separate node linked to the dependencies it governs

Example:

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
    subgraph Messaging
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

## Mermaid Syntax Rules

The diagram must parse cleanly under **Mermaid >= 9.x**. Anything outside the legal subset crashes the entire diagram with `Syntax error in text`.

- Use `flowchart LR`
- Avoid special characters (`@`, `#`, `$`, `%`, `&`) in node labels — use plain text
- Always quote arrow labels with double quotes: `-->|"label"|`
- Use `subgraph` for grouping, with a display name in quotes if it contains spaces
- Use `-.->` (dotted arrow) for transitive/indirect relationships
- Verify all node IDs are unique across the entire diagram

### Line breaks in node labels — HARD RULE

- **NEVER use `\n` for line breaks inside node labels.** The literal `\n` escape was removed in modern Mermaid and is the #1 cause of "Syntax error in text".
- **Use `<br/>` instead**: `Node["First line<br/>Second line"]`.
- Prefer single-line labels; move detail into the inventory table.
- ❌ `Spring["Spring Boot\n2.5.12"]`
- ✅ `Spring["Spring Boot<br/>2.5.12"]` or `Spring["Spring Boot 2.5.12"]`

### Self-check before emitting each ```mermaid block

1. Search the block for the two characters `\n` — replace each with `<br/>`. Zero `\n` must remain.
2. Confirm every node ID is unique and every `subgraph` is closed by `end`.
3. Confirm every arrow label is double-quoted.

## Error Handling

- **Unsupported project type**: Output a single line: `> ERROR: Unsupported project type. This skill supports Java, .NET, JavaScript, and TypeScript projects only.`
- **No build files found**: Output: `> ERROR: No recognized build files found at {workspace-path}. Verify the path is correct.`
- **Incomplete dependency info**: Generate a best-effort diagram from available data. Add a note inside the diagram: `Note["Some dependencies could not be fully resolved"]`

## Success Criteria

- Mermaid diagram renders correctly with dependencies grouped by functional category
- Each dependency shows name and version
- Dependency Summary table lists categories with counts and key libraries
- Version & Compatibility Risks paragraph highlights outdated or end-of-life dependencies
- Notable Observations lists 2-4 noteworthy findings
- Test Dependencies section lists detected test frameworks with versions and total count
- File saved to `.github/modernize/assessment/engines/facts/dependency-map.md`

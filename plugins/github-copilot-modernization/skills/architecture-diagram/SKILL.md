---
name: architecture-diagram
description: Generate architecture diagram with component relationship details from project analysis
---

# Architecture Diagram

This skill generates a two-layer architecture visualization: a high-level application architecture diagram and a detailed component relationship diagram. Produce both in a single pass and save to `.github/modernize/assessment/engines/facts/architecture-diagram.md`.

## Input Parameters

- `workspace-path` (optional): Path to the project to analyze (defaults to current directory)

## ⚠ Mermaid Safety Constraints — read BEFORE you write any ```mermaid block

Mermaid is unforgiving: one illegal character anywhere in a block crashes the **whole** diagram with `Syntax error in text`, not just the offending line. There is no partial rendering. Stay strictly inside this subset:

1. **Chart kind.** Only `flowchart TD` (Step 1) or `flowchart LR` (Step 2). Never `graph TD`, never mixed.
2. **Subgraph form.** Always `subgraph <AlphaNumId>["display label"]`. The id must match `[A-Za-z][A-Za-z0-9_]*` (no spaces, no punctuation). NEVER use the anonymous form `subgraph "label"` — it crashes whenever the label contains `(`, `)`, `:`, `/`, `-`, etc., and the parser error appears on an unrelated line.
3. **Node form.** Only one of: `Id["label"]` (rectangle), `Id(("label"))` (circle), `Id[("label")]` (cylinder for data stores). Pick one shape per node — do not stack brackets.
4. **Arrow form.** Solid `-->`, dotted `-.->`. If you put a label on an arrow it MUST be double-quoted: `-->|"label"|`. Never bare `-->|label|`.
5. **No line breaks in labels.** The escape `\n` was removed in modern Mermaid and is the #1 cause of failures. Use `<br/>` in flowcharts when you really must break a line. Strongly prefer single-line ≤ 60-char labels — put detail in the Inventory / Stack tables instead.
6. **Banned characters inside any label or subgraph title.** Use the ASCII replacement:

   | Banned | Why it breaks | Replacement |
   |---|---|---|
   | `\n` (literal two chars) | escape removed | `<br/>` or drop |
   | `—` (em-dash, U+2014) | parser treats as edge | `-` (ASCII hyphen) |
   | `–` (en-dash, U+2013) | parser treats as edge | `-` |
   | `{` `}` (e.g. `{id}`) | opens an entity block | drop braces — write `id` or `:id` |
   | `"` inside a label | closes the label early | `'` (single quote) |
   | `\|` inside a label | breaks edge-label parser | rephrase |
   | `@` `#` `$` `%` `&` | unsafe in many positions | rephrase or drop |
   | `(` `)` outside a `["..."]` quoted label | unbalanced parens crash | only inside the quoted label |
   | smart quotes `"` `"` `'` `'` | not ASCII | regular `"` and `'` |

7. **Unique node IDs across the whole file.** If Layer 1 has `DB`, Layer 2 cannot also have `DB`. Use `DB1` and `DB2` (or `AppDb`, `ComponentDb`).
8. **`subgraph` must be closed by a matching `end` on its own line.** No `end`, no diagram.

### Mandatory self-attestation

Immediately before writing each ` ```mermaid ` opening fence, emit this exact one-line HTML comment in the markdown (the comment will not render — it is for your own visible attestation that you have re-checked the block):

```
<!-- mermaid-checked: no \n, no em-dash/en-dash, no {} in labels, subgraphs are id["label"], arrows are -->|"label"|, all subgraphs closed by end, ids unique -->
```

If you cannot truthfully emit that comment, fix the diagram first.

---

## Execution Steps

### Step 1: Generate Application Architecture Section

Analyze the project and produce the complete `## Application Architecture` section in one pass.

**Analysis:**
- Examine build files (Java: pom.xml, build.gradle; .NET: *.csproj, *.sln; JS/TS: package.json, tsconfig.json)
- Review configuration files (application.properties, appsettings.json, .env, database/API configs)
- Scan key source files to extract: framework, major dependencies, data access patterns, external integrations, technology stack
- Identify application layers (UI, Business Logic, Data Access), data storage technologies, and external service dependencies

**Diagram — Mermaid `flowchart TD`** (re-read the Safety Constraints above before writing):
- Application layers with technology info (use `subgraph` for grouping)
- Data storage components (specific names like "PostgreSQL", "Redis")
- External service integrations
- Data flow with descriptive arrow labels

**Do NOT include**: individual classes/methods or migration directions.

Reference example (this block satisfies every Safety Constraint — match its shape):

<!-- mermaid-checked: no \n, no em-dash/en-dash, no {} in labels, subgraphs are id["label"], arrows are -->|"label"|, all subgraphs closed by end, ids unique -->
~~~mermaid
flowchart TD
    subgraph Client["Client Layer"]
        Browser["Web Browser"]
    end
    subgraph App["Application Layer - Spring Boot 2.7"]
        Web["Spring MVC + Thymeleaf"]
        Security["Spring Security"]
        Service["Business Services"]
    end
    subgraph Data["Data Layer"]
        JPA["Spring Data JPA"]
        DB[("PostgreSQL 14")]
        Cache[("Redis")]
    end
    subgraph External["External Services"]
        SMTP["SMTP Email Service"]
        S3["AWS S3 Storage"]
    end

    Browser -->|"HTTP requests"| Web
    Web --> Security -->|"authorized"| Service
    Service -->|"CRUD operations"| JPA
    JPA -->|"SQL queries"| DB
    Service -->|"session cache"| Cache
    Service -->|"send email"| SMTP
    Service -->|"file upload"| S3
~~~

**Textual explanations (write immediately after the diagram):**
- **Technology Stack Summary table**: Layer | Technology | Version | Purpose
- **Data Storage & External Services**: A short paragraph describing what databases, caches, message brokers, or external APIs are used and how they fit into the architecture
- **Key Architectural Decisions**: 1-3 bullet points on notable patterns (e.g., "Uses repository pattern with EF6", "Autofac DI with module-based registration")

> ⚠ Move detail OUT of node labels and INTO this table. A diagram with short labels and a rich table renders; a diagram with long labels does not.

### Step 2: Generate Component Relationships Section

Analyze component interactions and produce the complete `## Component Relationships` section in one pass.

**Analysis:**
- Identify key component types by framework conventions:
  - Java (Spring): Controllers, Services, Repositories, Configurations, Entities, DTOs, Listeners, Filters
  - Java (Jakarta EE): Servlets, EJBs, CDI Beans, JPA Entities, JAX-RS Resources
  - .NET (ASP.NET Core): Controllers, Services, Middleware, DbContext, Entities, Hubs, Filters
  - .NET (Blazor/MVC): Pages, Components, ViewModels
  - JavaScript/TypeScript (Node.js): Routes, Controllers, Services, Middleware, Models
  - JavaScript/TypeScript (React/Angular/Vue): Components, Hooks, Services, Stores, Pages
- Trace dependency injection (constructor/field injection)
- Map communication patterns (REST, gRPC, message queues, events)
- Map data access patterns (service-to-repository, DbContext usage)
- Detect cross-cutting concerns (middleware, interceptors, filters)

**Diagram — Mermaid `flowchart LR`** (re-read the Safety Constraints above before writing):
- Components grouped by architectural layer using `subgraph` (Presentation, Business Logic, Data Access, Infrastructure)
- Interaction arrows with brief labels
- Cross-cutting concerns
- **Use IDs that do NOT collide with Step 1's diagram** (e.g., prefix with `c` for Component: `cWeb`, `cService`).

**Do NOT include**: method signatures, private helpers, or external dependencies (covered by dependency-map skill).

Reference example (satisfies every Safety Constraint):

<!-- mermaid-checked: no \n, no em-dash/en-dash, no {} in labels, subgraphs are id["label"], arrows are -->|"label"|, all subgraphs closed by end, ids unique -->
~~~mermaid
flowchart LR
    subgraph PresentationLayer["Presentation"]
        UserCtrl["UserController"]
        OrderCtrl["OrderController"]
    end
    subgraph BusinessLayer["Business Logic"]
        UserSvc["UserService"]
        OrderSvc["OrderService"]
        NotifSvc["NotificationService"]
    end
    subgraph DataAccessLayer["Data Access"]
        UserRepo["UserRepository"]
        OrderRepo["OrderRepository"]
    end
    subgraph InfraLayer["Infrastructure"]
        AuthFilter["AuthenticationFilter"]
        LogMiddleware["LoggingMiddleware"]
    end

    UserCtrl -->|"delegates"| UserSvc
    OrderCtrl -->|"delegates"| OrderSvc
    OrderSvc -->|"lookups"| UserSvc
    OrderSvc -->|"triggers"| NotifSvc
    UserSvc -->|"queries"| UserRepo
    OrderSvc -->|"queries"| OrderRepo
    AuthFilter -.->|"intercepts"| UserCtrl
    AuthFilter -.->|"intercepts"| OrderCtrl
    LogMiddleware -.->|"wraps"| PresentationLayer
~~~

**Textual explanation (write immediately after the diagram):**
- **Component Inventory table**: Component | Layer | Type | Responsibility

### Step 3: Save Output

Save the combined output to `.github/modernize/assessment/engines/facts/architecture-diagram.md` with this exact structure:

```
# Architecture Diagram

A brief introduction (1-2 sentences).

## Application Architecture

< Layer 1 Mermaid flowchart TD here >

### Technology Stack Summary

[Table: Layer | Technology | Version | Purpose]

### Data Storage & External Services

[Short paragraph on databases, caches, external APIs]

### Key Architectural Decisions

[1-3 bullet points on notable patterns]

## Component Relationships

< Layer 2 Mermaid flowchart LR here >

### Component Inventory

[Table: Component | Layer | Type | Responsibility]
```

## Scaling Rules

- If the project has **more than 30 components**, aggregate by package/namespace (e.g., show `com.example.orders` as one node instead of listing every class) — this also keeps labels short and safe.
- Keep each diagram under **40 nodes** to ensure readability and GitHub rendering compatibility.
- For multi-module projects, focus on inter-module boundaries in Layer 1 and key components within the most important modules in Layer 2.

## Common failure patterns observed in past runs

Each row below is something the model actually produced and crashed the diagram. Use the ✅ form.

| ❌ Past mistake | ✅ Safe form | Why the ❌ crashed |
|---|---|---|
| `subgraph "Spring Boot Application (port 8080)"` | `subgraph SpringApp["Spring Boot Application (port 8080)"]` | Anonymous subgraph + parentheses in title |
| `HC["HomeController\n GET / — gallery page"]` | `HC["HomeController GET /"]` (move detail to table) | Literal `\n` + em-dash |
| `PHOTOS_TABLE["PHOTOS table\n id (UUID PK)\n photo_data (BLOB)"]` | `PHOTOS_TABLE["PHOTOS"]` (columns belong in a table) | `\n` and overlong label |
| `PFC["PhotoFileController\n GET /photo/{id}"]` | `PFC["PhotoFileController GET /photo/:id"]` | `\n` + `{id}` |
| `Spring["Spring Boot\n2.7.18"]` | `Spring["Spring Boot 2.7.18"]` | `\n` |
| `A -->|fetches users| B` | `A -->|"fetches users"| B` | Bare (unquoted) arrow label |

## Error Handling

- **Unsupported project type**: Output a single line: `> ERROR: Unsupported project type. This skill supports Java, .NET, JavaScript, and TypeScript projects only.`
- **No source code found**: Output: `> ERROR: No recognized source files found at workspace-path. Verify the path is correct.`
- **Insufficient info**: Generate a best-effort diagram from available data. Add a note inside the diagram: `Note["Some components could not be identified"]`

## Success Criteria

- Layer 1 Mermaid diagram renders correctly showing architecture with technology names, data storage, and external dependencies
- Layer 1 is accompanied by Technology Stack Summary table, Data Storage & External Services paragraph, and Key Architectural Decisions
- Layer 2 Mermaid diagram renders correctly showing component interactions grouped by architectural layer
- Layer 2 is accompanied by Component Inventory table
- Every ```mermaid block is preceded by the `<!-- mermaid-checked: ... -->` attestation comment
- File saved to `.github/modernize/assessment/engines/facts/architecture-diagram.md`

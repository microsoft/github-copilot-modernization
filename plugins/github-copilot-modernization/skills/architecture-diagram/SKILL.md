---
name: architecture-diagram
description: Generate architecture diagram with component relationship details from project analysis
---

# Architecture Diagram

This skill generates a two-layer architecture visualization: a high-level application architecture diagram and a detailed component relationship diagram. Produce both in a single pass and save to `.github/modernize/assessment/engines/facts/architecture-diagram.md`.

## Input Parameters

- `workspace-path` (optional): Path to the project to analyze (defaults to current directory)

## Execution Steps

### Step 1: Generate Application Architecture Section

Analyze the project and produce the complete `## Application Architecture` section in one pass:

**Analysis:**
- Examine build files (Java: pom.xml, build.gradle; .NET: *.csproj, *.sln; JS/TS: package.json, tsconfig.json)
- Review configuration files (application.properties, appsettings.json, .env, database/API configs)
- Scan key source files to extract: framework, major dependencies, data access patterns, external integrations, technology stack
- Identify application layers (UI, Business Logic, Data Access), data storage technologies, and external service dependencies

**Diagram — Mermaid `flowchart TD`:**
- Application layers with technology info (use `subgraph` for grouping)
- Data storage components (specific names like "PostgreSQL", "Redis")
- External service integrations
- Data flow with descriptive arrow labels

**Do NOT include**: individual classes/methods or migration directions.

Example:

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
- **Technology Stack Summary table**: Layer | Technology | Version | Purpose (e.g., Presentation | ASP.NET MVC 5 | 5.2.7 | Server-side web framework)
- **Data Storage & External Services**: A short paragraph describing what databases, caches, message brokers, or external APIs are used and how they fit into the architecture
- **Key Architectural Decisions**: 1-3 bullet points on notable patterns (e.g., "Uses repository pattern with EF6 for data access", "Autofac provides DI with module-based registration")

### Step 2: Generate Component Relationships Section

Analyze component interactions and produce the complete `## Component Relationships` section in one pass:

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

**Diagram — Mermaid `flowchart LR`:**
- Components grouped by architectural layer using `subgraph` (Presentation, Business Logic, Data Access, Infrastructure)
- Interaction arrows with brief labels
- Cross-cutting concerns

**Do NOT include**: method signatures, private helpers, or external dependencies (covered by dependency-map skill).

Example:

~~~mermaid
flowchart LR
    subgraph Presentation
        UserCtrl["UserController"]
        OrderCtrl["OrderController"]
    end
    subgraph Business["Business Logic"]
        UserSvc["UserService"]
        OrderSvc["OrderService"]
        NotifSvc["NotificationService"]
    end
    subgraph DataAccess["Data Access"]
        UserRepo["UserRepository"]
        OrderRepo["OrderRepository"]
    end
    subgraph Infra["Infrastructure"]
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
    LogMiddleware -.->|"wraps"| Presentation
~~~

**Textual explanation (write immediately after the diagram):**
- **Component Inventory table**: Component | Layer | Type | Responsibility (e.g., CatalogController | Presentation | MVC Controller | Handles catalog browsing and CRUD)

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

- If the project has **more than 30 components**, aggregate by package/namespace (e.g., show `com.example.orders` as one node instead of listing every class)
- Keep each diagram under **40 nodes** to ensure readability and GitHub rendering compatibility
- For multi-module projects, focus on inter-module boundaries in Layer 1 and key components within the most important modules in Layer 2

## Mermaid Syntax Rules

The diagram must parse cleanly under **Mermaid >= 9.x** (the version used by GitHub, VS Code, Obsidian, and every modern renderer). Anything outside the legal subset crashes the entire diagram with `Syntax error in text`, not just the offending line.

- Use `flowchart TD` for Layer 1 and `flowchart LR` for Layer 2
- Avoid special characters (`@`, `#`, `$`, `%`, `&`) in node labels — use plain text
- Always quote arrow labels with double quotes: `-->|"label"|`
- Use `subgraph` for grouping, with a display name in quotes if it contains spaces
- Verify all node IDs are unique across the entire diagram

### Line breaks in node labels — HARD RULE

- **NEVER use `\n` for line breaks inside node labels.** The literal `\n` escape was removed in modern Mermaid and is the #1 cause of "Syntax error in text" — every node containing `\n` will fail to render.
- **Use `<br/>` instead** for an explicit line break: `Node["First line<br/>Second line"]`.
- If a label is long, prefer a single concise phrase over multi-line. Move details into the Component Inventory / Technology Stack tables that follow the diagram.
- ❌ `MediaLib["Media Library\n(MediaScannerService\nMediaFileService)"]`
- ✅ `MediaLib["Media Library<br/>MediaScannerService<br/>MediaFileService"]`
- ✅ `MediaLib["Media Library"]`  (and list the sub-components in the inventory table)

### Self-check before emitting each ```mermaid block

1. Search the block for the two characters `\n` — if found, replace each with `<br/>` (or remove). Zero `\n` must remain.
2. Confirm every node ID is unique and every `subgraph` is closed by `end`.
3. Confirm every arrow label is double-quoted.

## Error Handling

- **Unsupported project type**: Output a single line: `> ERROR: Unsupported project type. This skill supports Java, .NET, JavaScript, and TypeScript projects only.`
- **No source code found**: Output: `> ERROR: No recognized source files found at {workspace-path}. Verify the path is correct.`
- **Insufficient info**: Generate a best-effort diagram from available data. Add a note inside the diagram: `Note["Some components could not be identified"]`

## Success Criteria

- Layer 1 Mermaid diagram renders correctly showing architecture with technology names, data storage, and external dependencies
- Layer 1 is accompanied by Technology Stack Summary table, Data Storage & External Services paragraph, and Key Architectural Decisions
- Layer 2 Mermaid diagram renders correctly showing component interactions grouped by architectural layer
- Layer 2 is accompanied by Component Inventory table
- File saved to `.github/modernize/assessment/engines/facts/architecture-diagram.md`

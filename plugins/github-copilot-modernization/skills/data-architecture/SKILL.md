---
name: data-architecture
description: Generate data architecture and persistence layer documentation with data model diagram
---

# Data Architecture & Persistence Layer

Analyze the project to document database configuration, entity models, data ownership boundaries, repository interfaces, and caching strategies. Generate a Mermaid ER diagram showing entity relationships. Save to `.github/modernize/assessment/engines/facts/data-architecture.md`.

## Input Parameters

- `workspace-path` (optional): Path to the project to analyze (defaults to current directory)

## Scope Boundaries — Avoid Redundancy with Other Skills

This skill is part of a set of four complementary assessment skills. To avoid content duplication across their output documents, observe these scope rules:

- **Introduction**: Write a 1-2 sentence intro focused on the data layer (number of entities, database types, ORM). Do NOT restate the application's overall architecture type, web framework, or API surface — those are covered by other skills.
- **Configuration property keys/values** (e.g., `spring.jpa.hibernate.ddl-auto`, `spring.sql.init.*`) are owned by the `configuration-inventory` skill. In the Database Configuration table, describe the *behavior* (e.g., "Hibernate does not manage schema; SQL scripts are authoritative") but do NOT list raw property key-value pairs. Reference `configuration-inventory.md` for the full property inventory.
- **API endpoints and HTTP methods** are owned by the `api-service-contracts` skill. Do NOT list controller endpoints or HTTP paths. Repository methods are in scope for this skill; controller routes are not.
- **Business workflow steps and validation rules** are owned by the `business-workflows` skill. Do NOT describe multi-step business processes or enumerate validation constraints. When documenting entity relationships (cascade, fetch), focus on the persistence/ORM implications, not the business process flow.
- **Deployment configurations** (Docker Compose, K8s, profiles) are owned by the `configuration-inventory` skill. Mention database profiles only in the Database Configuration table to identify which DB is used per profile — do NOT describe Docker Compose services, K8s manifests, or deployment targets in detail.

## Execution Steps

### Step 1: Generate Database Configuration Section

Extract database configuration from project files, **per profile/environment**, and produce the complete `## Database Configuration` section:

- Database types: HSQLDB, MySQL, PostgreSQL, MongoDB, SQL Server, Oracle, SQLite, CosmosDB, DynamoDB
- **Per-profile configuration**: identify which database is used in each profile (e.g., HSQLDB for `default`/dev in-memory testing, MySQL for `production`/`mysql` profile)
- Database drivers per profile (e.g., `mysql-connector-java` for production, `hsqldb` for development)
- Connection configuration: connection strings, JDBC URLs, pooling settings (HikariCP, connection pool size)
- Migration tools: Flyway, Liquibase, EF Migrations, Alembic, Prisma Migrate, Knex migrations
- Schema management: DDL auto-generation settings (`spring.jpa.hibernate.ddl-auto`), schema versioning, initial schema scripts
- Seed data: `data.sql`, `import.sql`, seed migration files, or programmatic data seeding

### Step 2: Generate Data Ownership per Service Section

Determine table/entity ownership across modules/services and produce the complete `## Data Ownership per Service` section. Scope is strictly the per-service ownership table — high-level data boundary discussion belongs in Step 6.

For each module/service, identify:

- Which tables/entities it owns (bounded context analysis)
- ORM framework used (e.g., Hibernate, EF Core, MyBatis, Mongoose)
- Caching layer used by this service (if any)
- Brief notes (e.g., outbox table, schema-per-service)

> Do NOT include shared-vs-isolated data store summary, cross-service data access patterns, or read/write/CQRS observations here — those belong in the `## Data Ownership Boundaries` section (Step 6).

### Step 3: Generate Entity Model Section

Scan source code for data access patterns and ORM entities, then produce the complete `## Entity Model` section:

**Analysis:**
- Java: JPA/Hibernate entities (`@Entity`, `@Table`), Spring Data repositories (`JpaRepository`, `CrudRepository`), MyBatis mappers, JDBC templates
- .NET: EF Core `DbContext`, EF Core entities, Dapper, ADO.NET
- JavaScript/TypeScript: Mongoose models/schemas, Sequelize models, TypeORM entities, Prisma schema, Knex migrations

Identify:
- Entity/model classes with their fields, types, and constraints — note the source file path for each entity
- Transaction management annotations/configuration (`@Transactional`, `TransactionScope`, etc.)
- Bidirectional vs unidirectional relationship mappings (e.g., `owner.addPet(pet)` establishing parent-child links)

**Diagram — Mermaid `erDiagram`:**
- Show primary entities with key fields (PK, FK)
- Use standard cardinality notation: `||--o{` (one-to-many), `||--||` (one-to-one), `}o--o{` (many-to-many)
- Group related entities logically
- Include relationship labels
- Annotate which service owns each entity group (use comments or subgraph labels)

Example:

~~~mermaid
erDiagram
    Owner ||--o{ Pet : "has"
    Pet ||--o{ Visit : "has"
    Pet }o--|| PetType : "is of"
    Vet }o--o{ Specialty : "has"
    Owner {
        int id PK
        string firstName
        string lastName
        string address
        string city
        string telephone
    }
    Pet {
        int id PK
        string name
        date birthDate
        int ownerId FK
        int typeId FK
    }
    PetType {
        int id PK
        string name
    }
    Visit {
        int id PK
        int petId FK
        date visitDate
        string description
    }
    Vet {
        int id PK
        string firstName
        string lastName
    }
    Specialty {
        int id PK
        string name
    }
~~~

### Step 4: Generate Key Repository Methods Section

For each service/module, document the key repository interfaces and produce the complete `## Key Repository Methods` section:

- Repository interface name, entity type, and source file path
- Standard CRUD methods inherited from base interface
- Custom query methods with their signatures and purposes — especially:
  - Bulk/batch queries (e.g., `findByPetIdIn(Collection<Integer>)`) used for cross-service aggregation
  - Custom finders with derived query methods
  - Named queries or `@Query`-annotated methods
  - Raw SQL or stored procedure calls
- Query method parameters and return types

### Step 5: Generate Caching Strategy Section

Identify caching layers and configuration and produce the complete `## Caching Strategy` section:

- Cache providers: EhCache, Redis, Caffeine, Spring Cache (`@Cacheable`, `@CacheEvict`), MemoryCache, IDistributedCache
- Cache configuration: TTL, eviction policies, cache regions/names
- Cache-aside, read-through, write-through, write-behind patterns
- Session caching, query result caching, second-level cache (Hibernate)
- Rationale for caching decisions (e.g., "veterinarian data is read frequently but changes rarely")
- JSR-107 (JCache) / `cache-api` usage and provider binding

### Step 6: Generate Data Ownership Boundaries Section

Document data-store topology and cross-service access semantics, plus data classification, then produce the complete `## Data Ownership Boundaries` section (including the `### Data Classification & Sensitivity` subsection):

**Boundaries:**
- Shared vs isolated data stores (shared database, database-per-service, logical separation within shared DB)
- Cross-service data access patterns: how one service queries another service's data (direct DB access vs REST API calls vs batch/bulk query methods such as `findByPetIdIn(...)` that enable gateway-level aggregation)
- Read/write patterns and CQRS observations across services

**Data Classification & Sensitivity (`### Data Classification & Sensitivity` subsection):**
- Identify whether stored data contains sensitive categories — PII (names, addresses, phone numbers, emails), PHI (health records), PCI (payment card data)
- For each sensitive category found, note whether encryption-at-rest, data masking, or field-level access controls are in place
- If absent, state this explicitly (e.g., "Owner entity stores PII (firstName, lastName, address, telephone); no encryption-at-rest or masking configured")

### Step 7: Save Output

Save to `.github/modernize/assessment/engines/facts/data-architecture.md` with this exact structure:

```
# Data Architecture & Persistence Layer

A brief introduction (1-2 sentences) summarizing the data layer.

## Database Configuration

[Table: Service/Module | DB Type | Profile | Driver | Connection | Migration Tool]

## Data Ownership per Service

[Table: Service | Tables Owned | ORM Framework | Caching | Notes]

## Entity Model

< Mermaid erDiagram here >

## Key Repository Methods

[Table: Service | Repository | Notable Methods | Purpose]

## Caching Strategy

[Table or description of caching layers, providers, TTL, patterns, and rationale]

## Data Ownership Boundaries

[Description of shared vs isolated data stores, cross-service data access patterns, and aggregation enablers]

### Data Classification & Sensitivity

[Table: Entity | Sensitive Fields | Classification (PII/PHI/PCI/None) | Controls in Place]
[If no sensitive data found: "No PII, PHI, or PCI data detected in entity model."]
```

## Scaling Rules

- If the project has **more than 30 entities**, aggregate minor entities and show only the core domain model (15-20 key entities)
- Keep the ER diagram under **40 entities** to ensure readability and GitHub rendering compatibility
- For multi-module projects, focus on inter-module entity relationships and data boundaries
- Collapse join tables into relationship annotations rather than showing them as separate entities
- In the repository methods table, focus on non-CRUD custom methods; omit standard inherited methods

## Mermaid Syntax Rules

Use `erDiagram`. The diagram must parse cleanly under the official Mermaid grammar — anything outside it crashes the whole diagram, not just the offending line. Stay inside the minimal legal subset below.

### Attribute grammar

Every attribute line inside an entity body MUST follow exactly this shape:

```
<type> <name> [<key>] ["<description>"]
```

- `<type>` and `<name>`: single tokens, plain text (letters, digits, underscore). No spaces, no backticks, no `@#$%&`.
- `<key>`: optional. **Exactly one of** `PK`, `FK`, `UK` — never two, never combined. Compound tokens like `PK_FK`, `PKFK`, `PK/FK` are not part of the grammar.
- `<description>`: optional, must be a double-quoted string. The description is free text BUT must not contain `{`, `}`, or unescaped double quotes.

### Canonical attribute examples (copy these shapes)

```
int        Id              PK
string     Name
int        OwnerId         FK
int        InstructorId    PK    "also FK to Person (shared PK)"
int        CourseId        PK    "composite PK; FK to Course"
int        StudentId       PK    "composite PK; FK to Person"
string     Email           UK    "unique"
decimal    Budget                "money column"
bytes      RowVersion            "concurrency token"
```

Rule of thumb for **composite primary keys whose columns are also foreign keys** (join tables like `CourseAssignment`, shared-PK one-to-one tables like `OfficeAssignment`): mark every column as `PK` only, and note the FK role in the quoted description. The FK relationship itself is already conveyed by the cardinality arrows between entities — duplicating it as a second key marker is what crashes the parser.

### Relationships

- Cardinality is written as `<left>--<right>`, where each side independently picks one of:
  - `||` — exactly one
  - `|o` / `o|` — zero or one
  - `}o` / `o{` — zero or many
  - `}|` / `|{` — one or many
  The "open" side of `o`/`}`/`{` always faces inward (toward the `--`). All resulting combinations are legal, e.g. `||--o{` (one-to-many), `||--||` (one-to-one), `}o--o{` (many-to-many), `}o--||` (many-to-one), `|o--o{` (zero-or-one to many), `||--o|` (one to zero-or-one).
- Always quote the label: `Owner ||--o{ Pet : "has"`.
- The label is free text but must not contain `{`, `}`, or unescaped double quotes.

### Hard prohibitions (these crash the whole diagram, not just one line)

1. **No `{` or `}` inside any quoted description or label.** Mermaid's ER parser treats `{` as the entity-body opener even inside quotes. Use `<...>` for placeholders, or rephrase in plain words.
   - ❌ `string Key PK "Redis key /basket/{BuyerId}"`
   - ✅ `string Key PK "Redis key /basket/<BuyerId>"`
2. **No more than one key marker per attribute.** See the grammar above.
3. **No backticks, no special characters (`@#$%&`) in entity names, attribute names, or types.**
4. **No `\n` anywhere in the diagram.** The literal `\n` escape was removed in modern Mermaid (>= 9.x) and triggers "Syntax error in text". Keep every quoted description on a single line; if you need to express more, shorten the prose or split it across multiple attributes.
   - ❌ `string Roles "comma-separated\nROLE_USER, ROLE_ADMIN"`
   - ✅ `string Roles "comma-separated; ROLE_USER, ROLE_ADMIN"`

### Self-check before emitting the diagram

Before writing the ```` ```mermaid ```` block, walk every attribute line and verify it matches `<type> <name> [<key>] ["<description>"]` with **at most one** key token. Walk every quoted string and verify it contains no `{` or `}`. If a description needs to express two key roles (e.g., composite PK that is also FK), encode the second role as plain text inside the quoted description — never as a second token before the quote.

## Error Handling

- **Unsupported project type**: Output a single line: `> ERROR: Unsupported project type. This skill supports Java, .NET, JavaScript, and TypeScript projects only.`
- **No data access layer found**: Output: `> ERROR: No recognized data access patterns or entities found at {workspace-path}. Verify the path is correct.`
- **Insufficient info**: Generate a best-effort diagram from available data. Add a note: `> Note: Some entities or relationships could not be fully identified.`

## Success Criteria

- Database configuration table lists all discovered databases with type, profile, driver, and migration tools
- Data ownership table maps each service to its owned tables, ORM, and caching layer
- Mermaid ER diagram renders correctly showing entity relationships with cardinality and key fields
- Repository methods table documents custom query methods with purposes, especially cross-service aggregation enablers
- Caching strategy section describes cache providers, patterns, and rationale
- Data ownership boundaries describe shared vs isolated stores and cross-service data access patterns
- Data Classification & Sensitivity table identifies PII/PHI/PCI fields and documents presence or absence of controls
- File saved to `.github/modernize/assessment/engines/facts/data-architecture.md`

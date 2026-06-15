---
name: business-workflows
description: Generate core business workflow documentation with sequence diagram
---

# Core Business Workflows

Analyze the project to document business processes end-to-end, domain entities, business rules, service-to-domain mapping, cross-service data flows, and decision logic. Generate a Mermaid sequence diagram showing the primary business workflow. Save to `.github/modernize/assessment/engines/facts/business-workflows.md`.

## Input Parameters

- `workspace-path` (optional): Path to the project to analyze (defaults to current directory)

## Scope Boundaries — Avoid Redundancy with Other Skills

This skill is part of a set of four complementary assessment skills. To avoid content duplication across their output documents, observe these scope rules:

- **Introduction**: Write a 1-2 sentence intro focused on the business domain (what the application does for its users). Do NOT restate the technology stack, database options, or framework versions.
- **Domain Entities table**: Focus on business meaning — entity description, bounded context, and business relationships. Do NOT reproduce entity field lists, data types, PK/FK annotations, or ORM mapping details (cascade, fetch strategy) — those are owned by the `data-architecture` skill.
- **Validation rules in workflow steps**: When describing a workflow step that involves validation, reference the rule by name (e.g., "PetValidator checks name and birthDate") rather than re-listing every constraint. Enumerate the full validation rules only once in the "Business Rules & Decision Logic" section.
- **Caching behavior**: If caching affects a workflow (e.g., vet list served from cache), mention the business impact (e.g., "vet data served from cache, reducing load") but do NOT describe the cache provider, TTL, configuration class, or JMX statistics — those are owned by the `data-architecture` skill.
- **API endpoint paths and HTTP methods**: Only mention endpoint paths as entry points for workflows (e.g., "Staff submits POST /owners/new"). Do NOT create endpoint inventory tables — those are owned by the `api-service-contracts` skill.

## Execution Steps

### Step 1: Generate Domain Entities Section

Identify the domain model and produce the complete `## Domain Entities` section:

- Identify domain entities and aggregates (DDD patterns if present)
- Focus on business meaning — entity description, bounded context, and business relationships
- Do NOT reproduce entity field lists, data types, PK/FK annotations, or ORM mapping details (cascade, fetch strategy) — those are owned by the `data-architecture` skill

### Step 2: Generate Service-to-Domain Mapping Section

Map each service to its bounded context and owned entities, then produce the complete `## Service-to-Domain Mapping` section (applies to microservice or multi-module architectures):

- Service name → bounded context (e.g., `customers-service` → Customer Management, `visits-service` → Appointment Management)
- Domain entities owned by each service/context
- Cross-context data exchange patterns: how domains communicate (REST API, events, shared database)
- Data that spans contexts (e.g., `petId` as a foreign key in visits-service referencing customers-service's Pet entity)
- Aggregation boundaries: which service is the source of truth for which data

### Step 3: Generate Primary Workflows Section

Scan for business process entry points, trace each significant workflow end-to-end, and produce the complete `## Primary Workflows` section:

**Entry points to scan:**
- Controllers/endpoints that initiate business processes (not just CRUD — look for multi-step operations)
- **API Gateway aggregation endpoints** that compose responses from multiple backend services — these are business workflow entry points even though they live in the gateway layer (e.g., fetching owner details combined with visit history)
- Scheduled tasks (`@Scheduled`, Quartz, Hangfire, cron jobs, `BackgroundService`)
- Event listeners (`@EventListener`, `@KafkaListener`, `INotificationHandler`, message handlers)
- CLI commands or batch job entry points
- Startup/initialization routines that set up business state

**For each significant entry point, trace the flow:**
- Entry point → service layer → domain logic → persistence
- The sequence of operations: validation → business rule check → state mutation → side effects
- Branching logic (if/else, switch, strategy pattern) that represents business decisions
- Orchestration vs choreography patterns in multi-service workflows

### Step 4: Generate Cross-Service Data Flows Section

Trace cross-service data composition flows end-to-end and produce the complete `## Cross-Service Data Flows` section:

- Gateway aggregation patterns: e.g., gateway fetches owner from customers-service → extracts pet IDs → fetches visits from visits-service → merges visits into pet records → returns composite response
- Which service provides which data and how they are joined/merged
- Circuit breaker fallback behavior that affects business outcomes (e.g., "when visits-service is unavailable, owner details are returned without visit history" — this is a business-relevant degradation, not just a technical detail)

### Step 5: Generate Business Workflow Sequence Section

Create a **Mermaid `sequenceDiagram`** showing the primary business workflow end-to-end and produce the complete `## Business Workflow Sequence` section:

- Show the most important business process (e.g., "customer places order", "owner registers pet and schedules visit", "gateway aggregates owner with visit history")
- Include actors, services, and domain entities as participants
- Show business rule checks and decision points
- Annotate with business-relevant labels (not technical method names)
- Use `alt`/`else` blocks to show circuit breaker fallback paths that affect business outcomes
- Show cross-service data aggregation flows

Example:

~~~mermaid
sequenceDiagram
    participant Owner
    participant Gateway as "API Gateway"
    participant CustSvc as "Customer Service"
    participant VisitSvc as "Visit Service"
    participant DB as "Database"

    Owner->>Gateway: View my pets and visits
    Gateway->>CustSvc: Get owner details
    CustSvc->>DB: Find owner with pets
    DB-->>CustSvc: Owner + Pet list
    CustSvc-->>Gateway: OwnerDetails(pets)

    Gateway->>Gateway: Extract pet IDs from response
    Gateway->>VisitSvc: Get visits for pets (batch)
    alt Visit Service Available
        VisitSvc->>DB: Find visits by pet IDs
        DB-->>VisitSvc: Visit records
        VisitSvc-->>Gateway: Visits per pet
        Gateway->>Gateway: Merge visits into pet records
    else Visit Service Unavailable (Circuit Breaker)
        Note over Gateway: Fallback - return owner without visits
    end
    Gateway-->>Owner: Complete owner profile with visits
~~~

### Step 6: Generate Business Rules & Decision Logic Section

Extract and document business rules and cross-cutting concerns, and produce the complete `## Business Rules & Decision Logic` section:

**Business Rules:**
- **Validation rules**: Input validation, field constraints, format checks, custom validators
- **Decision logic**: Conditional business logic, pricing rules, eligibility checks, approval workflows
- **State transitions**: Entity lifecycle states (e.g., Order: Created → Confirmed → Shipped → Delivered), state machines
- **Business constraints**: Uniqueness rules, capacity limits, temporal constraints (booking windows, cooldown periods)
- **Computed values**: Derived fields, calculated totals, aggregated metrics
- **Data integrity rules**: Bidirectional relationship maintenance (e.g., `owner.addPet(pet)` ensuring both sides of the relationship are set)

**Cross-Cutting Concerns:**
- **Transactions**: Transaction boundaries, `@Transactional` scope, saga patterns, eventual consistency
- **Error handling**: Business exception types, compensating actions, dead-letter handling
- **Audit/logging**: Business event logging, audit trails, change tracking
- **Authorization**: Business-level authorization rules (role-based, attribute-based, resource ownership)

### Step 7: Save Output

Save to `.github/modernize/assessment/engines/facts/business-workflows.md` with this exact structure:

```
# Core Business Workflows

A brief introduction (1-2 sentences) summarizing the application's business domain.

## Domain Entities

[Table: Entity | Service / Bounded Context | Description | Key Relationships]

## Service-to-Domain Mapping

[Table: Service | Domain Context | Owned Entities | External Dependencies]

## Primary Workflows

### Workflow 1: [Name]

[Description, steps, business rules involved, cross-service interactions]

### Workflow 2: [Name]

[Description, steps, business rules involved]

## Cross-Service Data Flows

[Description of aggregation/composition patterns, which service provides which data, how data is joined, fallback behavior when services are unavailable]

## Business Workflow Sequence

< Mermaid sequenceDiagram here, with alt/else blocks for fallback paths >

## Business Rules & Decision Logic

[Summary of key business rules, validation rules, state transitions, and decision points]
```

## Scaling Rules

- If the project has **more than 10 distinct workflows**, focus on the 3-5 most important business processes and summarize the rest in a "Other Workflows" section
- Keep the sequence diagram under **40 participants and messages** to ensure readability and GitHub rendering compatibility
- For multi-module projects, focus on the primary end-to-end business workflow that spans modules
- Aggregate minor CRUD operations and show only workflows that involve business logic beyond simple create/read/update/delete

## Mermaid Syntax Rules

The diagram must parse cleanly under **Mermaid >= 9.x**. Anything outside the legal subset crashes the entire diagram with `Syntax error in text`.

- Use `sequenceDiagram`
- Avoid special characters (`@`, `#`, `$`, `%`, `&`) in participant labels — use plain text or quoted labels
- Use `->>` for synchronous calls and `-->>` for responses
- Use `participant` with alias syntax for readable labels: `participant Svc as "OrderService"`
- Use `Note over` for annotations about business decisions or fallback behavior
- Use `alt`/`else`/`end` blocks for decision points and circuit breaker fallbacks
- Do not use backticks inside participant labels

### Line breaks — HARD RULE

- **NEVER use `\n` for line breaks inside participant aliases, messages, or notes.** The literal `\n` escape was removed in modern Mermaid and triggers "Syntax error in text".
- Keep aliases on a single line: `participant Tx as "Transcoding Service"` — not `"Transcoding\nService"`.
- For multi-fact notes, emit multiple `Note over` statements instead of `\n`-separated text.
- ❌ `Note over Client,API: First fact\nSecond fact`
- ✅ Two consecutive `Note over Client,API: ...` lines.

### Self-check before emitting each ```mermaid block

1. Search the block for the two characters `\n` — remove or split. Zero `\n` must remain.
2. Confirm every `alt`/`opt`/`loop`/`par` block is closed by `end`.

## Error Handling

- **Unsupported project type**: Output a single line: `> ERROR: Unsupported project type. This skill supports Java, .NET, JavaScript, and TypeScript projects only.`
- **No business logic found**: Output: `> ERROR: No recognized business logic or workflows found at {workspace-path}. The project may be a library or framework without business processes.`
- **Insufficient info**: Generate a best-effort document from available data. Add a note: `> Note: Some workflows or business rules could not be fully traced.`

## Success Criteria

- Domain entities table lists key entities with their owning service/bounded context, descriptions, and relationships
- Service-to-domain mapping table maps each service to its domain context and owned entities
- At least one primary workflow is documented with steps, business rules, and cross-service interactions
- Cross-service data flows describe aggregation/composition patterns with fallback behavior
- Mermaid sequence diagram renders correctly showing end-to-end business workflow with `alt`/`else` blocks for fallbacks
- Business rules section summarizes validation, decision logic, state transitions, and constraints
- File saved to `.github/modernize/assessment/engines/facts/business-workflows.md`

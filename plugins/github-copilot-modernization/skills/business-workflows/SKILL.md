---
name: business-workflows
description: Generate core business workflow documentation with sequence diagram
---

# Core Business Workflows

Analyze the project to document business processes end-to-end, domain entities, business rules, service-to-domain mapping, cross-service data flows, and decision logic. Generate a Mermaid sequence diagram showing the primary business workflow. Save to `.github/modernize/assessment/engines/facts/business-workflows.md`.

## Input Parameters

- `workspace-path` (optional): Path to the project to analyze (defaults to current directory)

## ⚠ Mermaid Safety Constraints — read BEFORE you write the ```mermaid block

Mermaid sequenceDiagram is unforgiving in a few specific ways: one bad alias or one missing `end` crashes the **whole** diagram with `Syntax error in text`, not just the offending line. Stay strictly inside this subset for the sequence diagram:

1. **Chart kind.** `sequenceDiagram` only. Never `sequence-diagram`, never `sequence`.
2. **Participants.** Always declare with the alias form `participant <AlphaNumId> as "Display Label"`. The id must match `[A-Za-z][A-Za-z0-9_]*`. Never omit the id — even a one-word participant should be `participant Owner as "Owner"`. This is the single biggest cause of past failures.
3. **Arrows.**
   - `->>` synchronous request
   - `-->>` synchronous response
   - `-)` async fire-and-forget
   - Message text goes after `:` and is plain text — keep it short and on one line.
4. **Blocks.** `alt` / `else` / `opt` / `loop` / `par` / `critical` MUST be closed by `end` on its own line. Every open block must have a matching `end`. Missing `end` is the #2 cause of past failures.
5. **No line breaks anywhere.** The escape `\n` was removed in modern Mermaid. Aliases, message text, and `Note over` content must all be single-line. Split a long note into multiple consecutive `Note over` lines; split a long message into multiple arrows. This is the #1 cause of past failures.
6. **Banned characters inside participant aliases specifically** (message text is more permissive — only `\n` is banned there):

   | Banned in alias | Why it breaks | Replacement |
   |---|---|---|
   | `\n` (literal two chars) | escape removed | drop |
   | `"` (a second double-quote) | closes the alias early | `'` (single quote) |
   | `` ` `` (backtick) | breaks alias quoting | drop |
   | smart quotes `"` `"` `'` `'` | not ASCII | regular `"` and `'` |
   | `:` | confuses with message delimiter | rephrase, e.g. `"Order Service (v2)"` not `"Order Service: v2"` |
   | `<br/>` | not interpreted inside aliases | rephrase as shorter alias |

7. **Quote the alias.** `participant Svc as "Order Service"` — never `participant Svc as Order Service` (unquoted multi-word aliases break).

### Mandatory self-attestation

Immediately before writing the ` ```mermaid ` opening fence, emit this exact one-line HTML comment in the markdown (it does not render — it is for your own visible attestation):

```
<!-- mermaid-checked: every participant uses `participant Id as "Label"`, no \n in aliases/messages/notes, every alt/opt/loop closed by end, no `:` inside any alias -->
```

If you cannot truthfully emit that comment, fix the diagram first.

---

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

Reference example (this block satisfies every Safety Constraint — match its shape):

<!-- mermaid-checked: every participant uses `participant Id as "Label"`, no \n in aliases/messages/notes, every alt/opt/loop closed by end, no `:` inside any alias -->
~~~mermaid
sequenceDiagram
    participant Owner as "Owner"
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

## Common failure patterns observed in past runs

Each row below is something the model actually produced that crashed the diagram. Use the ✅ form.

| ❌ Past mistake | ✅ Safe form | Why the ❌ crashed |
|---|---|---|
| `participant Owner` (no alias) | `participant Owner as "Owner"` | Bare participants can break when used later with spaces |
| `participant Tx as "Transcoding\nService"` | `participant Tx as "Transcoding Service"` | Literal `\n` in alias |
| `participant API as "REST API: v2"` | `participant API as "REST API (v2)"` | `:` in alias collides with message delimiter |
| `Note over Client,API: First fact\nSecond fact` | Two consecutive `Note over Client,API: ...` lines | `\n` in note text |
| `alt happy path` ... missing `end` | `alt happy path` ... `end` | Unclosed block |
| `participant Svc as Order Service` (unquoted) | `participant Svc as "Order Service"` | Multi-word alias must be quoted |

## Error Handling

- **Unsupported project type**: Output a single line: `> ERROR: Unsupported project type. This skill supports Java, .NET, JavaScript, and TypeScript projects only.`
- **No business logic found**: Output: `> ERROR: No recognized business logic or workflows found at workspace-path. The project may be a library or framework without business processes.`
- **Insufficient info**: Generate a best-effort document from available data. Add a note: `> Note: Some workflows or business rules could not be fully traced.`

## Success Criteria

- Domain entities table lists key entities with their owning service/bounded context, descriptions, and relationships
- Service-to-domain mapping table maps each service to its domain context and owned entities
- At least one primary workflow is documented with steps, business rules, and cross-service interactions
- Cross-service data flows describe aggregation/composition patterns with fallback behavior
- Mermaid sequence diagram renders correctly showing end-to-end business workflow with `alt`/`else` blocks for fallbacks
- Business rules section summarizes validation, decision logic, state transitions, and constraints
- The ```mermaid block is preceded by the `<!-- mermaid-checked: ... -->` attestation comment
- File saved to `.github/modernize/assessment/engines/facts/business-workflows.md`

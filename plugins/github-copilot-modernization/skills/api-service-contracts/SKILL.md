---
name: api-service-contracts
description: Generate API and service communication contracts with sequence diagram
---

# API & Service Communication Contracts

Analyze the project to document all services, API endpoints, communication patterns (sync/async), DTOs, and retry/circuit-breaker policies. Generate a Mermaid sequence diagram showing the primary request flow across services. Save to `.github/modernize/assessment/engines/facts/api-service-contracts.md`.

## Input Parameters

- `workspace-path` (optional): Path to the project to analyze (defaults to current directory)

## Scope Boundaries — Avoid Redundancy with Other Skills

This skill is part of a set of four complementary assessment skills. To avoid content duplication across their output documents, observe these scope rules:

- **Introduction**: Write a 1-2 sentence intro focused on the API surface (number of endpoints, communication style). Do NOT restate the application's technology stack, database options, or architecture type — those are covered by other skills.
- **Entity fields and persistence details** are owned by the `data-architecture` skill. In the DTOs & Contracts section, list entity/DTO **class names** and their role in the API contract (request type, response type, immutability). Do NOT reproduce full field lists, ORM annotations (cascade, fetch strategy), or table names — reference `data-architecture.md` instead.
- **Validation rules** (e.g., `@NotBlank`, custom validators) are owned by the `business-workflows` skill. Mention validation only when it affects the API contract (e.g., "returns 400 if validation fails"). Do NOT enumerate individual field constraints.
- **Caching implementation details** (provider, TTL, configuration class) are owned by the `data-architecture` skill. In the sequence diagram, you may show cache hit/miss behavior, but do NOT repeat the cache provider name, configuration details, or rationale.
- **Configuration properties and profiles** (e.g., `spring.jpa.*`, database profiles) are owned by the `configuration-inventory` skill. Do NOT list property keys/values.
- **Startup dependency chain details** (readiness probes, K8s manifests, dockerize) are owned by the `configuration-inventory` skill. Mention startup order only if it directly affects API availability. Do NOT repeat probe paths or wait mechanisms.

## Execution Steps

### Step 1: Generate Service Catalog Section

Identify all independently deployable services/modules and produce the complete `## Service Catalog` section:

- Multi-module builds: Maven modules (`pom.xml` `<modules>`), Gradle subprojects (`settings.gradle`), .NET solutions (`.sln` → `.csproj` projects), monorepo workspaces (`package.json` workspaces)
- Docker Compose services (`docker-compose.yml` service definitions) — note third-party containers vs source-built services
- Kubernetes deployments, Helm charts, or IaC definitions

For each service extract:
- Service name and Maven module / project name
- Port number (from config files, `docker-compose.yml`, or `application.properties`/`appsettings.json`)
- Category: **API Layer** (gateways, BFFs), **Business** (domain services), **Infrastructure** (config, discovery, admin), **Observability** (tracing, metrics, dashboards)
- Purpose (one-line description)
- Key framework dependencies (from `pom.xml`, `.csproj`, `package.json`)

### Step 2: Generate API Endpoints Inventory Section

Scan source code for API endpoint definitions and produce the complete `## API Endpoints Inventory` section:

- Java (Spring): `@RestController`, `@Controller`, `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@RequestMapping`
- Java (Jakarta EE): `@Path`, `@GET`, `@POST`, `@PUT`, `@DELETE` (JAX-RS)
- .NET (ASP.NET Core): `[ApiController]`, `[HttpGet]`, `[HttpPost]`, `[HttpPut]`, `[HttpDelete]`, `[Route]`
- JavaScript/TypeScript: Express routes (`app.get`, `app.post`, `router.get`), Fastify routes, NestJS decorators (`@Get`, `@Post`)

For each endpoint extract:
- HTTP method (GET, POST, PUT, DELETE, PATCH)
- URL path (including path parameters)
- Request type (body/query/path parameters, DTO class name)
- Response type (DTO class name, status codes)
- API versioning scheme if present (URL path, header, query parameter)
- Which service/controller it belongs to

### Step 3: Generate Management & Observability Endpoints Section

Identify management and observability endpoints and produce the complete `## Management & Observability Endpoints` section:

- Spring Boot Actuator endpoints (`/actuator/health`, `/actuator/info`, `/actuator/metrics`, `/actuator/prometheus`)
- .NET health checks (`/health`, `/healthz`), Swagger UI (`/swagger`)
- Custom metrics annotations: `@Timed` (Micrometer), `[Meter]`, custom metric registrations — note the metric name and which service exposes it

### Step 4: Generate DTOs & Contracts Section

Analyze DTO and contract definitions and produce the complete `## DTOs & Contracts` section:

- Find DTO / request / response model classes (records, POJOs, C# records/classes). List class names and their API role (request body, response, path/query param). Do NOT reproduce full field lists or ORM annotations — those belong in `data-architecture.md`.
- **Distinguish gateway-level DTOs** (aggregation/composition models that combine data from multiple services) from **service-level domain entities** (owned by a single service)
- Note which DTOs are immutable (Lombok `@Value`, Java records, C# records, frozen data classes)
- Identify OpenAPI/Swagger specifications (`openapi.yaml`, `swagger.json`, Springdoc/Swashbuckle annotations)
- Check for protobuf schemas (`.proto` files) or GraphQL schemas
- Note serialization configuration (Jackson, System.Text.Json, custom serializers)

### Step 5: Generate Communication Patterns Section

Identify inter-service and intra-service communication and produce the complete `## Communication Patterns` section:

- **Synchronous**: REST (HttpClient, RestTemplate, WebClient, Feign), gRPC, direct method calls
- **Asynchronous**: Message queues (Kafka, RabbitMQ, Azure Service Bus, SQS), event-driven patterns, pub/sub
- **Resilience patterns**: Circuit breaker (Resilience4j, Polly, Spring Retry), retry policies, timeout configuration, bulkhead patterns — note specific timeout values and fallback behavior
- **Service discovery**: Eureka, Consul, Kubernetes DNS, Azure Service Discovery — note whether services register by logical name or hardcoded URL
- **API gateway**: Spring Cloud Gateway, Ocelot, Kong, custom gateway patterns
- **Gateway aggregation/composition**: Document how the gateway combines responses from multiple backend services (e.g., fetching owner details from one service and visit history from another, then merging them into a single response). Note the composition logic and fallback behavior when a downstream service is unavailable.
- **Client-side load balancing**: Spring Cloud LoadBalancer, Ribbon, or framework-provided balancing
- **Startup dependency chain**: Briefly note the service startup order if it affects API availability. For full details (probes, wait mechanisms, timeouts), refer to `configuration-inventory.md`.
- **Security posture**: Note whether transport security (HTTPS/TLS), authentication (JWT, OAuth2, Basic Auth, Spring Security), or authorization (RBAC, `@PreAuthorize`, role checks) are implemented at the API level. If absent, state it explicitly — e.g., "No authentication or TLS configured; all endpoints are publicly accessible with no authorization checks." Do NOT duplicate CWE security scan findings; focus only on presence or absence at the API contract level.

### Step 6: Generate Service Technology Matrix Section

For each service, identify which cross-cutting capabilities it uses and produce the complete `## Service Technology Matrix` section:

- Web framework (MVC, Reactive/WebFlux, Minimal API)
- Data access (JPA, EF Core, Mongoose, etc.)
- Service discovery (client, server, or none)
- Gateway functionality
- Actuator/health checks
- Caching layer
- Metrics export (Prometheus, Application Insights, etc.)

### Step 7: Generate Service Communication Sequence Section

Create a **Mermaid `sequenceDiagram`** and produce the complete `## Service Communication Sequence` section:
- Show key actors: Client, API Gateway (if present), Controllers, Services, External Services, Message Brokers
- Annotate synchronous calls with solid arrows and asynchronous calls with dashed arrows
- Include request/response types where relevant
- Show error handling paths for critical flows (circuit breaker, retry)
- For gateway aggregation flows, show how multiple downstream calls are composed

Example:

~~~mermaid
sequenceDiagram
    participant Client
    participant Gateway as "API Gateway"
    participant CustSvc as "Customers Service"
    participant VisitSvc as "Visits Service"
    participant DB as "Database"

    Client->>Gateway: GET /api/gateway/owners/1
    Gateway->>CustSvc: GET /owners/1
    CustSvc->>DB: findById(1)
    DB-->>CustSvc: Owner + Pets
    CustSvc-->>Gateway: OwnerDetails(pets=[Pet1,Pet2])
    Gateway->>VisitSvc: GET /pets/visits?petId=1,2
    alt Visits Service Available
        VisitSvc->>DB: findByPetIdIn([1,2])
        DB-->>VisitSvc: Visits list
        VisitSvc-->>Gateway: Visits(items=[...])
    else Circuit Breaker Open
        Gateway-->>Gateway: Fallback - empty visits
    end
    Gateway->>Gateway: Merge visits into pets
    Gateway-->>Client: 200 OwnerDetails + Visits
~~~

### Step 8: Save Output

Save to `.github/modernize/assessment/engines/facts/api-service-contracts.md` with this exact structure:

```
# API & Service Communication Contracts

A brief introduction (1-2 sentences) summarizing the API surface and communication patterns found.

## Service Catalog

[Table: Service | Port | Category | Purpose]

## API Endpoints Inventory

[Table: Service | Method | Path | Request Type | Response Type]

## Management & Observability Endpoints

[Table: Service | Endpoint | Custom Metrics (if any)]

## DTOs & Contracts

[Description of gateway-level DTOs vs service-level entities, immutability, serialization]

## Communication Patterns

[Description of sync/async patterns, gateway aggregation/composition logic, circuit breaker/retry policies with timeout values, service discovery, startup dependency chain, and security posture (authentication/authorization/TLS — or explicit statement that none is configured)]

## Service Technology Matrix

[Table: Service | Web | Data Access | Discovery | Gateway | Actuator | Cache | Metrics]

## Service Communication Sequence

< Mermaid sequenceDiagram here >
```

## Scaling Rules

- If the project has **more than 30 endpoints**, group by service/controller and show representative endpoints per group
- Keep the sequence diagram under **40 participants and messages** to ensure readability and GitHub rendering compatibility
- For multi-module projects, focus on inter-module communication in the sequence diagram and list all endpoints in the table
- Aggregate similar endpoints (e.g., CRUD operations on the same resource) into one table row if needed for brevity
- For the service technology matrix, use checkmarks or short labels; omit columns where no service uses the capability

## Mermaid Syntax Rules

The diagram must parse cleanly under **Mermaid >= 9.x**. Anything outside the legal subset crashes the entire diagram with `Syntax error in text`.

- Use `sequenceDiagram`
- Avoid special characters (`@`, `#`, `$`, `%`, `&`) in participant labels — use plain text or quoted labels
- Use `->>` for synchronous calls and `-->>` for responses/async messages
- Use `participant` with alias syntax for readable labels: `participant Svc as "OrderService"`
- Use `alt`/`else`/`end` blocks to show circuit breaker fallback paths
- Do not use backticks inside node labels

### Line breaks — HARD RULE

- **NEVER use `\n` for line breaks inside participant aliases, messages, or notes.** The literal `\n` escape was removed in modern Mermaid and triggers "Syntax error in text".
- In participant aliases: keep them on a single line, e.g. `participant Svc as "Order Service"` — not `"Order\nService"`.
- In `Note over` / `Note right of`: keep the note on one line, or split into multiple `Note` statements.
- In message arrow labels: keep concise; if you need multiple facts, split into multiple arrows.
- ❌ `participant API as "REST API\n(SubsonicController)"`
- ✅ `participant API as "REST API (SubsonicController)"`

### Self-check before emitting each ```mermaid block

1. Search the block for the two characters `\n` — remove or split the line. Zero `\n` must remain.
2. Confirm every `alt`/`opt`/`loop`/`par` block is closed by `end`.
3. Confirm every quoted alias is on a single line.

## Error Handling

- **Unsupported project type**: Output a single line: `> ERROR: Unsupported project type. This skill supports Java, .NET, JavaScript, and TypeScript projects only.`
- **No API endpoints found**: Output: `> ERROR: No recognized API endpoints found at {workspace-path}. Verify the path is correct.`
- **Insufficient info**: Generate a best-effort document from available data. Add a note: `> Note: Some endpoints or communication patterns could not be fully identified.`

## Success Criteria

- Service catalog table lists all discovered services with ports, categories, and purposes
- API endpoints table lists all discovered endpoints with HTTP method, path, and types
- Management/observability endpoints are cataloged with custom metric names
- Gateway aggregation/composition patterns are documented with fallback behavior
- Service technology matrix shows per-service capabilities
- Communication patterns section describes sync/async patterns, resilience policies, and security posture (authentication, authorization, TLS — explicitly stating if none is configured)
- Mermaid sequence diagram renders correctly showing primary request flow with aggregation and fallback
- File saved to `.github/modernize/assessment/engines/facts/api-service-contracts.md`

# Extraction Signals

Use this reference as a signal checklist while producing the structured architecture artifacts. Do not produce prose inventory reports.

## Signal → artifact map

```text
signal area              write findings into
----------------------   ------------------------------------------------------------
project structure        unit_graph.yaml, shared_modules.yaml, migration_boundary.yaml
state and routing        unit_graph.yaml, bindings.yaml, cross_unit_state.yaml, behavior.yaml
UI components            unit_graph.yaml, bindings.yaml, behavior.yaml, shared_modules.yaml
business logic           behavior.yaml, wire_contracts.yaml, cross_unit_state.yaml
API surface              wire_contracts.yaml
integration points       wire_contracts.yaml, seams.yaml, cross_unit_state.yaml
data model               wire_contracts.yaml, bindings.yaml, shared_modules.yaml, cross_unit_state.yaml
tech stack               bindings.yaml, wire_contracts.yaml, migration_boundary.yaml
```

## Project structure signals

Look for:
- top-level modules, packages, apps, and deployable boundaries
- framework entrypoints: `main`, routes, web descriptors, Vite/Next/GWT config, Struts/Spring config, CLI commands, scheduled jobs
- functional areas and domains
- layer structure when it affects unit boundaries
- generated, build, or vendor directories to exclude from source anchors

Record entrypoints, routes/pages/jobs/CLI/API surfaces, module boundaries, dependencies, exported signatures, shared files/packages, and runtime-reachable files.

## State and routing signals

Look for:
- router config, URL patterns, route guards, redirects
- UI state stores, session/local storage, cookies, request/session attributes, thread/static/framework implicit state
- event handlers that trigger route or state changes
- dynamic route construction and framework conventions

Record route declarations, route params, query params, UI event bindings, framework state bindings, cross-unit state flows, user-visible navigation behavior, redirects, loading/error states, and branch-specific outcomes.

## UI component signals

Look for:
- page/component tree only where it affects unit boundaries or shared module decisions
- event handlers and data flow
- forms, validation, error states, loading states
- visible text/selectors relied on by tests or users

Record UI pages/components that are externally triggerable or unit boundaries, props/events/selectors/template bindings, framework directives, data-testid/test-visible selectors, runtime config, user actions, visible states, conditional rendering, validation/error/loading behavior, side effects, and shared UI utilities/components/hooks/stores.

## Business logic signals

Look for:
- externally triggered behavior in the unit's source anchors and directly called domain/service methods
- conditional paths, validation branches, early returns, redirect/navigation decisions
- writes, notifications, cache/session mutations, audit logs, external calls triggered by behavior
- exceptions, validation failures, fallback paths, user-visible errors, HTTP/status outcomes
- async jobs, polling, transactions, locks, retries, timeouts
- business state written by one unit and read by another

Record each behavior with `source_loc`, `must_preserve`, and target evidence expectations where applicable. Prefer branch-level contracts over prose descriptions. Do not add rewrite priority, target framework suggestions, or implementation approach.

Example shape inside `units/<unit>/behavior.yaml`:

```yaml
unit: order_checkout
branches:
  - source_loc: src/order/CheckoutAction.java:42
    condition: "cart.isEmpty()"
    behavior: "return to cart page with validation message"
    must_preserve: true
side_effects:
  - source_loc: src/order/CheckoutService.java:88
    effect: "creates audit log entry after successful payment authorization"
    must_preserve: true
error_paths:
  - source_loc: src/order/PaymentClient.java:117
    trigger: "payment gateway timeout"
    outcome: "surface retryable checkout error; order remains pending"
    must_preserve: true
```

## API surface signals

Look for:
- REST/SOAP/GraphQL/gRPC routes, methods, params, request bodies, response bodies, status/error contracts
- public RPC/service methods, CLI inputs/outputs, web routes, form posts
- auth/authorization requirements that are part of the wire contract
- DTO serialization names and versioning rules
- existing OpenAPI/Swagger/proto/schema files

For each contract, include source locations and whether the contract is frozen, must be preserved, or may change by user intent.

## Integration point signals

Look for:
- external HTTP/REST/SOAP client calls
- message producers and handlers: Kafka, RabbitMQ, SQS, JMS, etc.
- third-party SDKs: payment, email/SMS, OAuth, analytics
- file transfer/storage calls: S3, FTP/SFTP, NFS
- resilience behavior: timeout, retry, circuit breaker, idempotency, service discovery

Record HTTP/SOAP/gRPC/message/file/SDK contracts, auth, payload shape, retry/error semantics, deliberate partial-migration cuts where one side is frozen, and implicit state created by integrations.

Do not document deployable runtime resources here; build/deploy/runtime topology belongs outside architecture analysis.

## Data model signals

Look for:
- entity/DTO/model classes and their source locations
- table/collection names, key fields, relationships, enum/string-value contracts
- validation rules and serialization names that must appear in the target
- dynamic model access patterns: `get("field")`, maps, reflection

Record persisted schemas, external data contracts, ORM annotations/XML mappings, validation annotations, serialization aliases, framework binding names, shared DTO/entity/base-model classes, and implicit data passed through session/request/thread/static state.

Avoid domain redesign, aggregate decisions, bounded-context decisions, or target schema recommendations.

## Tech stack signals

Look for:
- framework/runtime versions and plugins
- routing/UI/server framework conventions
- build tooling and module packaging only when it affects runtime reachability or migration boundary
- serialization, ORM, messaging, auth, validation, and i18n libraries

Record framework wiring, annotations, XML/config bindings, runtime config, dependency-injection hooks, protocol/framework-specific contracts, relevant source/target idiom guide, and build/runtime constraints that genuinely force boundary expansion.

Do not recommend target stack choices here. Record only existing facts and constraints.

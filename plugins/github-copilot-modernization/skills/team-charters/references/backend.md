# Backend Charter

## Mission

Own the server-side implementation: build the logic that powers the product.

## You Own

- Business logic — service layer, domain rules, use cases, validation
- API implementation — endpoints, request/response handling, error codes
- Application wiring — dependency injection, middleware, filters, interceptors, bootstrap config
- Unit tests for your own code — unit tests are YOUR responsibility, not tester's
- Service-level integration tests — narrow tests that verify your own code's integration points with real dependencies

## Core Principle

**Build from the blueprint.** Read the architect's design artifact before implementing. Follow the naming conventions, layering rules, and API contracts defined there. If the design is ambiguous, ask the architect — don't guess.

## Quality Bar

- Code follows the architect's conventions — naming, layering, patterns
- API contracts match what was specified — endpoints, schemas, error codes
- Unit tests cover business logic, not just happy paths
- Surface contract changes immediately — downstream roles depend on accurate contracts

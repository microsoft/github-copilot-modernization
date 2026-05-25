# Backend Clarification Kit — v1 (skeleton)

Each field is evaluated during the Clarification Gate when backend code is in scope.

> **v1 scope**: covers framework, API contracts, data migration, auth, and SLAs.  
> Future versions will add messaging, observability, multi-tenancy, and caching fields.

---

## Field Definitions

### target.framework
- **Importance**: required
- **Label**: Target backend framework & version
- **Accepted evidence**: explicit name + major version (e.g., "Spring Boot 3.2", "ASP.NET Core 8", "FastAPI 0.110", "Express 5 / Node 22", "NestJS 10")
- **Default if skipped**: ❌ no default — always prompt
- **Why it matters**: determines DI model, middleware stack, build tooling, and which ORM / security modules are compatible

---

### api.contract_preservation
- **Importance**: required
- **Label**: External API contract preservation policy
- **Accepted evidence**: explicit policy string — one of:
  - `"must preserve"` — all existing REST/SOAP/gRPC endpoints, payloads, and status codes unchanged
  - `"can break with versioning"` — new version prefix (e.g., `/v2`) allowed, old routes can be deprecated
  - `"can break"` — no existing clients to protect; full redesign allowed
  - `"partial: <list>"` — specific endpoints must be preserved, list them
- **Default if skipped**: `"must preserve"` (safe default, prevents accidental client breakage)
- **Why it matters**: drives whether adapters / anti-corruption layers are needed and how many tasks involve backward-compat wrappers

---

### data.migration_strategy
- **Importance**: required
- **Label**: Database / data migration approach
- **Accepted evidence**:
  - `"in-place"` — same schema, same DB, alter tables
  - `"dual-write"` — new schema alongside old, sync during transition
  - `"new schema"` — clean data model, ETL from old DB
  - `"no migration"` — DB stays untouched (API only rewrite)
  - `"TBD / assess in research phase"` — defer to Foundation agent
- **Default if skipped**: `"TBD / assess in research phase"` (records as soft gap, Foundation agent will determine)
- **Why it matters**: determines task complexity, rollback strategy, and whether a DBA/data specialist role is needed

---

### auth.framework
- **Importance**: recommended
- **Label**: Authentication & authorization framework
- **Accepted evidence**: library name + version ("Spring Security 6", "Keycloak 24", "Auth0", "Azure AD / Entra ID", "Passport.js", "ASP.NET Identity"), or policy ("preserve existing JWT claims", "federate to existing IdP")
- **Default if skipped**: `"preserve existing auth mechanism; detect from codebase"`
- **Why it matters**: auth integration touches every protected endpoint and is hard to retrofit; must be planned from the start

---

### nfr.sla
- **Importance**: recommended
- **Label**: Non-functional requirements — SLA targets
- **Accepted evidence**: explicit metrics (e.g., "p95 latency < 200ms", "throughput ≥ 500 RPS", "availability 99.9%"), link to existing SLA doc, or "match current production baseline"
- **Default if skipped**: `"match current production baseline; no regression"`
- **Why it matters**: SLA targets gate technology choices (async vs sync, caching layer, DB indexing) and must appear in spec success criteria

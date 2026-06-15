---
name: configuration-inventory
description: Generate comprehensive configuration and externalized settings inventory
---

# Configuration & Externalized Settings Inventory

Analyze the project to produce a comprehensive inventory of all configuration sources, build profiles, runtime profiles, externalized properties, secrets workflows, feature flags, startup dependencies, and framework versions. Save to `.github/modernize/assessment/engines/facts/configuration-inventory.md`.

> Note: This skill produces a comprehensive reference document. For structured findings suitable for automated processing, see `fact-profile-settings`, `fact-environment-variables`, and `fact-xml-configs`.

## Input Parameters

- `workspace-path` (optional): Path to the project to analyze (defaults to current directory)

## Scope Boundaries — Avoid Redundancy with Other Skills

This skill is part of a set of four complementary assessment skills. To avoid content duplication across their output documents, observe these scope rules:

- **Introduction**: Write a 1-2 sentence intro focused on the configuration landscape (number of config sources, profiles, secrets approach). Do NOT restate the application's architecture type, business domain, or API surface.
- **Database architecture details** (entity models, ER diagrams, ORM mappings, caching strategy rationale, repository methods) are owned by the `data-architecture` skill. In the Properties Inventory, list database-related property keys and values as raw configuration entries, but do NOT explain their behavioral implications (e.g., do not explain what `spring.jpa.open-in-view=false` means for lazy loading — that belongs in `data-architecture.md`).
- **API endpoints** are owned by the `api-service-contracts` skill. Do NOT list HTTP endpoints, controller routes, or actuator paths.
- **Business workflows and validation rules** are owned by the `business-workflows` skill. Do NOT describe business processes or entity validation constraints.
- **Entity/domain model listings** are owned by `data-architecture` and `business-workflows`. Do NOT enumerate entity names, fields, or relationships.

## Execution Steps

### Step 1: Generate Configuration Sources Section

Identify all configuration files and sources and produce the complete `## Configuration Sources` section:

- Java (Spring): `application.properties`, `application.yml`, `bootstrap.properties`, `bootstrap.yml` — note that `bootstrap.*` files are distinct from `application.*` (bootstrap configures the config server connection and runs before application context; application configures the app itself)
- .NET: `appsettings.json`, `appsettings.{Environment}.json`, `web.config`, `launchSettings.json`
- JavaScript/TypeScript: `.env`, `.env.local`, `.env.production`, `config/*.js`, `config/*.ts`
- Shared: `docker-compose.yml` environment sections, Kubernetes ConfigMaps/Secrets YAML files
- Config server references: Spring Cloud Config (note the external Git repository URI), Azure App Configuration, AWS AppConfig, Consul KV
- Secret stores: HashiCorp Vault, Azure KeyVault, AWS Secrets Manager references
- External configuration repositories: document the URI/path of any external config repos (e.g., `spring.cloud.config.server.git.uri`)

### Step 2: Generate Build Profiles Section

Identify build-time profiles that affect compilation, packaging, and dependency resolution, and produce the complete `## Build Profiles` section:

- **Java/Maven**: profiles in `pom.xml` (e.g., `springboot`, `buildDocker`, `dev`, `cloud`) — for each, document activation condition (auto, manual `-P`, system property `-Denv=`), purpose, and key dependencies or plugins added
- **Java/Gradle**: build types and flavors in `build.gradle`
- **.NET**: build configurations (Debug, Release), conditional compilation symbols, MSBuild properties
- **JavaScript/TypeScript**: build scripts in `package.json`, webpack/vite/esbuild configurations per environment

For each build profile extract:
- Profile name
- Activation condition (automatic, manual flag, system property, environment variable)
- Purpose (what it enables)
- Key dependencies or plugins added/removed

### Step 3: Generate Runtime Profiles Section

List all runtime profile-specific or environment-specific configuration and produce the complete `## Runtime Profiles` section:

- Java (Spring): Profile-specific files (`application-dev.yml`, `application-prod.yml`), `@Profile` annotations, `spring.profiles.active` settings, combined profile activation (e.g., `mysql,key-vault`)
- .NET: Environment-specific files (`appsettings.Development.json`, `appsettings.Production.json`), `ASPNETCORE_ENVIRONMENT` usage
- JavaScript/TypeScript: `.env.development`, `.env.production`, NODE_ENV-based branching
- Identify profile activation conditions, defaults, and how profiles compose (multiple active profiles)

### Step 4: Generate Properties Inventory Section

For each service/module, catalog all configuration properties and produce the complete `## Properties Inventory` section:

- Property keys with their default values
- Which profiles/environments override each property
- Data types and expected value ranges (where inferable)
- Properties sourced from environment variables (`${ENV_VAR}`, `%ENV_VAR%`)
- Placeholder references and property resolution chain

> Do NOT include JVM startup parameters, `-Xms`/`-Xmx` heap settings, `-D` system properties, container memory/CPU limits, or instance counts here — those belong in the `## Startup Parameters & Resource Requirements` section (Step 5).

### Step 5: Generate Startup Parameters & Resource Requirements Section

Document JVM startup options, runtime parameters, and per-service resource allocations, and produce the complete `## Startup Parameters & Resource Requirements` section:

- JVM heap settings (`-Xms`, `-Xmx`) per service
- System properties passed at startup (`-Dspring.profiles.active=`, `-Dazure.keyvault.uri=`, etc.)
- Docker/container environment variable overrides (`SPRING_PROFILES_ACTIVE`, `ASPNETCORE_ENVIRONMENT`)
- Memory allocation per service (Docker `mem_limit`, Kubernetes `resources.requests/limits`, cloud deployment settings)
- CPU allocation if specified
- Instance count and scaling configuration
- JVM heap settings mapped to service memory allocation (e.g., `-Xms2048m -Xmx2048m` for 2Gi services)

### Step 6: Generate Startup Dependency Chain Section

Map the service startup order and readiness dependencies and produce the complete `## Startup Dependency Chain` section:

- Which services must start before others (e.g., config-server → discovery-server → business services → gateway)
- Health-check/wait mechanisms: `dockerize` wait-for-TCP, Kubernetes readiness probes, Spring Cloud Config retry, Docker Compose `depends_on` with health checks
- Startup timeout configurations
- Service readiness indicators (actuator health endpoints, custom health checks)

### Step 7: Generate Secrets & Sensitive Configuration Section

Flag sensitive configuration entries and document the secrets provisioning workflow, and produce the complete `## Secrets & Sensitive Configuration` section (including the `### Secrets Provisioning Workflow` subsection):

- Database passwords, API keys, connection strings with credentials
- Secret references: KeyVault URIs, Vault paths, encrypted property values
- Entries marked as sensitive by framework conventions (e.g., `spring.datasource.password`)
- **Do NOT output actual secret values** — show the reference path or "[MASKED]" placeholder
- Note encryption methods if present (Jasypt, DPAPI, sealed secrets)

Document how secrets flow through the system (`### Secrets Provisioning Workflow`):
- Secret source: environment variables, Key Vault, Vault, AWS Secrets Manager, sealed secrets
- Identity/access model: managed identities, service principals, RBAC permissions (e.g., "system-assigned managed identity with `get` and `list` permissions on Key Vault")
- Provisioning sequence: how secrets are set up during deployment (e.g., GitHub Actions retrieves service principal credentials → authenticates → creates MySQL secrets → binds to services)
- Which services need which secrets (e.g., data services need MySQL connection strings, all services need config server credentials)

### Step 8: Generate Feature Flags Section

Identify feature toggles and conditional configuration and produce the complete `## Feature Flags` section:

- Feature flag frameworks: Spring Feature Flags, LaunchDarkly, Unleash, .NET FeatureManagement, custom toggles
- Conditional beans/services (`@ConditionalOnProperty`, `@ConditionalOnExpression`)
- A/B testing flags and gradual rollout configurations
- Default values and controlling sources (config file, environment variable, remote service)

### Step 9: Generate Framework & Runtime Versions Section

Catalog the technology stack versions that affect configuration and produce the complete `## Framework & Runtime Versions` section:

- Core framework versions: Spring Boot, Spring Cloud, ASP.NET Core, Node.js, Express
- Target language/runtime version: Java 8/11/17/21, .NET 6/7/8, Node.js 18/20
- Key library versions: Hibernate, EF Core, Resilience4j, Eureka, etc.
- Docker base images and their versions (e.g., `openjdk:11-jre`, `mcr.microsoft.com/dotnet/aspnet:8.0`)
- Build tool versions: Maven, Gradle, MSBuild, npm/yarn/pnpm

### Step 10: Save Output

Save to `.github/modernize/assessment/engines/facts/configuration-inventory.md` with this exact structure:

```
# Configuration & Externalized Settings Inventory

A brief introduction (1-2 sentences) summarizing the configuration landscape.

## Configuration Sources

[Table: Source | Type | Path/Location | Notes]

## Build Profiles

[Table: Profile | Activation | Purpose | Key Dependencies/Plugins]

## Runtime Profiles

[Table: Profile | Activation Method | Config Files | Key Overrides]

## Properties Inventory

[Per-service tables: Property Key | Default | Profiles | Source]

## Startup Parameters & Resource Requirements

[Table: Service | JVM/Runtime Options | Memory | Instance Count]

## Startup Dependency Chain

[Ordered list: Service → waits for → Service, with mechanism (dockerize, health check, etc.)]

## Secrets & Sensitive Configuration

[Table: Secret Reference | Type | Storage (masked)]

### Secrets Provisioning Workflow

[Description of how secrets flow: source → identity/access → binding → services]

## Feature Flags

[Table: Flag Name | Default | Controlled By]

## Framework & Runtime Versions

[Table: Component | Version | Source]
```

## Scaling Rules

- If the project has **more than 100 properties**, group by category (database, messaging, security, etc.) and show representative examples with counts
- For multi-module projects, organize the properties inventory by module/service
- Collapse repetitive property patterns (e.g., 20 similar cache TTL settings) into a summary row with count

## Error Handling

- **Unsupported project type**: Output a single line: `> ERROR: Unsupported project type. This skill supports Java, .NET, JavaScript, and TypeScript projects only.`
- **No configuration files found**: Output: `> ERROR: No recognized configuration files found at {workspace-path}. Verify the path is correct.`
- **Insufficient info**: Generate a best-effort inventory from available data. Add a note: `> Note: Some configuration sources or properties could not be fully identified.`

## Success Criteria

- Configuration sources table lists all discovered config files, external config repos, and secret stores
- Build profiles are documented separately from runtime profiles with activation conditions and purposes
- Runtime profiles are documented with config files and key overrides
- Properties inventory covers all discovered properties with defaults and sources
- Startup parameters and resource requirements are documented per service
- Startup dependency chain shows service boot order with wait mechanisms
- Secrets are identified with references (no actual values exposed) and the provisioning workflow is described
- Feature flags are cataloged with defaults and controlling sources
- Framework and runtime versions are documented
- File saved to `.github/modernize/assessment/engines/facts/configuration-inventory.md`

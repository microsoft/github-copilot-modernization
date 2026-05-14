# DevOps Charter

## Mission

Own CI/CD pipelines, deployment automation, and operational infrastructure. Keep builds green, deployments reliable, and environments ready.

## You Own

- Build system — CI/CD pipelines, build scripts, dependency management
- Containerization — container images, orchestration configs, service manifests
- Middleware provisioning — local dev/test environments for databases, message queues, caches, storage
- Deployment — staging/production pipelines, rollback procedures, release automation
- Runtime readiness — health checks, monitoring, logging, alerting setup
- Infrastructure as Code — cloud resource provisioning

## Core Principle

**Reproducible over clever.** Pinned versions, lockfiles, deterministic builds. If it works on your machine but not in CI, it's broken.

## Quality Bar

- Builds are reproducible — pinned dependencies, explicit runtime versions, no implicit environment assumptions
- Deployment configs are parameterized — no hardcoded secrets, URLs, or environment-specific values
- Missing operational prerequisites are called out — monitoring, secrets, DNS, certificates, not silently skipped

## Communication

- Notify backend or the relevant role on build/deploy blockers immediately
- Ask architect for infrastructure design decisions
- Notify all on deployment pipeline changes that affect the team workflow

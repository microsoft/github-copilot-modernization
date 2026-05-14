---
name: analyzing-architecture
description: |
  Runs deep codebase analysis: architecture patterns, tech stack, data models, integration points, and migration risks. Produces research artifacts consumed by creating-implementation-plan and feature-inventory.
  Triggers: "analyze architecture", "analyze existing application", "analyze the codebase", "codebase architecture analysis", "discover dependencies", "assess migration risks", "run codebase discovery", "document module boundaries", "map action mappings".
  NOT for: knowledge graph generation (use building-java-knowledge-graph), spec writing (use feature-inventory).
---


## Output

All outputs are written under your task's `Artifact path:` (from task metadata). File names:

```
project-structure.md
tech-stack.md
data-model.md
architecture-summary.md
migration-risks.md
infrastructure.md
test-coverage.md
deployment.md
```

(Only relevant files are generated based on selected tasks.)


# Analyzing Architecture

Provides a pool of research tasks for deep codebase analysis during the analysis phase.
Each task's full prompt is in `references/<task-name>.md`.

## ⚡ Dispatch: All Tasks in ONE Parallel Batch

**Do NOT run tasks in phases.** Select all applicable tasks upfront and dispatch them in a single parallel batch using the `task` tool (agent_type: "explore").

### Quick-Select by Project Type

Use the task description and a quick scan of the project root (README, build file, package.json) to classify the project, then select ALL tasks for that type:

| Project Type | Tasks |
|---|---|
| **Java backend migration/upgrade** | `project-structure`, `tech-stack`, `data-model`, `migration-risks`, `architecture-summary`, `api-surface`, `infrastructure`, `test-coverage`, `deployment` (if Dockerfile exists) |
| **Java backend (new feature)** | `project-structure`, `tech-stack`, `data-model`, `architecture-summary`, `api-surface` |
| **Frontend SPA** | `project-structure`, `tech-stack`, `ui-components`, `state-routing`, `build-bundle`, `test-coverage` |
| **Fullstack** | ALL applicable from both backend and frontend |
| **Library/SDK** | `project-structure`, `tech-stack`, `api-surface`, `test-coverage` |

**When in doubt, include the task** — extra analysis is cheap; missing analysis causes bad specs.

### Dispatch Method

For each selected task, load `references/<task-name>.md` to get the full prompt, then dispatch:

```
task(agent_type: "explore", name: "<task-name>", prompt: "<full prompt from reference file>")
```

**Issue ALL task() calls in a single assistant turn** so they run in parallel.

After all explore agents complete, synthesize their findings into the output files.

---

## Task Reference

### Core Tasks (Always Run)

| Task | Reference | Output |
|------|-----------|--------|
| `project-structure` | `references/project-structure.md` | Functional domains, layers, project type |
| `tech-stack` | `references/tech-stack.md` | Frameworks, deps, migration blockers |

### Optional Task Pool

| Task | When Relevant | Reference | Output |
|------|---------------|-----------|--------|
| `data-model` | Project has ORM / entity classes / DB access | `references/data-model.md` | Entity inventory, schema |
| `migration-risks` | Any migration/upgrade task | `references/migration-risks.md` | Risk by module, patterns |
| `architecture-summary` | Knowledge graph exists, or complex inter-module deps | `references/architecture-summary.md` | Arch patterns, coupling |
| `api-surface` | Project exposes REST/GraphQL/gRPC endpoints | `references/api-surface.md` | Endpoint inventory, DTOs |
| `integration-points` | Project calls external services, MQ, cache, 3rd-party APIs | `references/integration-points.md` | External deps, service boundaries |
| `infrastructure` | **Always for migration/upgrade** | `references/infrastructure.md` | DB/MQ/cache deps, test infra |
| `test-coverage` | **Always for migration/upgrade** | `references/test-coverage.md` | Test inventory, portability, gaps |
| `deployment` | Project has Dockerfile/K8s/CI configs | `references/deployment.md` | Container, CI/CD, IaC |
| `ui-components` | Frontend with component-based framework | `references/ui-components.md` | Component tree, design system |
| `state-routing` | Frontend SPA with state management | `references/state-routing.md` | State, routes, data fetching |
| `build-bundle` | Frontend or Node.js with custom build config | `references/build-bundle.md` | Build tool, bundling, optimization |



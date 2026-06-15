# Clarification Questionnaire

Infer answers from available context (assessment report, user prompt, project structure) before asking the user. Only present a question via `ask_user` when the answer cannot be determined. When asking, show all options and mark the default. Record every answer (inferred or user-provided) for inclusion in the plan's "Open Questions & Questionnaire" section.

## Environment Setup

Should the plan include environment/infrastructure provisioning?

* (Default if no infra configuration found) No — no infrastructure provisioning; focus on code migration only
* (Default if infra configuration found) No — use infrastructure/configuration already defined in the repository (for example, existing IaC, deployment manifests, or pipeline config)
* Yes — provision new infrastructure
* Custom — use an existing externally managed environment specified by the user instead of provisioning or repo-defined configuration (ask for resource group, subscription, environment name, or config path)

## Security & CVE Remediation

Should the plan include a security scan and CVE remediation task? This task runs after all upgrade and transform tasks and before deployment to identify and fix known vulnerabilities.

* (Default) Yes — include security/CVE remediation
* No — skip security/CVE remediation
* Custom - user input the security/CVE requirements

## Deployment Target

Which Azure deployment target should the plan use?

* (Default) Azure Container Apps — includes containerization; no separate containerization task needed
* Azure Kubernetes Service — includes containerization; no separate containerization task needed
* Azure App Service
* Azure App Service Managed Instance
* Azure Function App
* Azure Static Web App
* No deployment — migration only, no cloud deployment
* Custom — user-specified target (ask for details)

## Containerization

Should the plan include containerization (Dockerfile generation)? Skip this question if the deployment target already includes containerization (Azure Container Apps or AKS).

* (Default) Yes — generate Dockerfile and container build configuration
* No — skip containerization

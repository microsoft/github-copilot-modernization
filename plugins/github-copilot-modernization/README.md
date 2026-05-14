# GitHub Copilot modernization - Copilot CLI Plugin

Autonomous application modernization using multi-agent orchestration for [GitHub Copilot CLI](https://github.com/github/copilot-cli).

## Overview

This plugin enables autonomous modernization of Java and .NET applications through a multi-agent orchestration system. Just describe what you need — upgrade Java versions, migrate to Azure, fix CVE vulnerabilities, or rearchitect your application — and the orchestrator automatically routes your request through the right workflow:

1. **Assessment**: Analyzes applications to identify modernization opportunities (auto-detects Java or .NET)
2. **Planning**: Generates executable task plans based on assessment results, enterprise policies, and user-defined constraints
3. **Execution**: Routes tasks to specialized agents for parallel execution — including Java upgrades, Azure migrations, security fixes, and structural rewrites

Enterprise modernization intent — target architectures, upgrade standards, guardrails, and compliance policies — can be embedded directly into the workflow through a playbook, ensuring every generated plan aligns with your organization's standards.

## Features

- **Java Upgrades**: Java version upgrades (8 → 11 → 17 → 21), Spring Boot 2.x → 3.x, javax → jakarta migration, deprecated API migration
- **Azure Migration**: Migrate Java and .NET applications to Azure services (Service Bus, Azure SQL, Redis, Key Vault, Application Insights, Managed Identity)
- **CVE & Vulnerability Fixing**: Scan and fix CVE vulnerabilities in Maven and NuGet dependencies, including Log4j, Spring, Jackson, and OWASP dependency analysis
- **Application Rearchitecture**: Structural rewrites such as monolith-to-microservices decomposition, legacy UI modernization (WinForms → React/Angular, JSP → modern SPA), and module extraction
- **.NET Modernization**: Assess and migrate .NET applications to Azure, including NuGet security audits and ASP.NET-to-Azure migrations
- **Enterprise Policy Support**: Embed your organization's modernization intent — target architectures, upgrade standards, guardrails, and compliance policies — directly into the workflow via a playbook
- **Multi-Agent Orchestration**: 3-level agent hierarchy (orchestrator → coordinators → executors) with automatic routing — just describe what you need
- **Parallel Execution**: Executor agents handle tasks concurrently
- **Self-Verification**: Executors implement build, test, and validation checks with retry logic
- **Commit History Preservation**: Detailed per-phase/per-task commits for review

## Getting Started

### Opening Copilot CLI

1. **Download Copilot CLI**: Download from [https://github.com/github/copilot-cli](https://github.com/github/copilot-cli) and follow the installation instructions for your platform.

2. **Navigate to your project**: Open a terminal and navigate to your project directory:
   ```bash
   cd /path/to/your/project
   ```

3. **Start Copilot CLI**:
   ```bash
   copilot
   ```

## Installation

```bash
# Add the marketplace
copilot plugin marketplace add microsoft/github-copilot-modernization

# Install the plugin
copilot plugin install github-copilot-modernization@github-copilot-modernization

# Update the plugin (when a new version is available)
copilot plugin update github-copilot-modernization@github-copilot-modernization
```

## Usage

Start the modernization orchestrator agent:

```bash
copilot --agent=github-copilot-modernization:modernize
```

Or with auto-approval for unattended execution:

```bash
copilot --agent=github-copilot-modernization:modernize --allow-all
```

Once in the CLI, simply ask in natural language:

```
copilot> modernize my application
```

Or be more specific:

```
copilot> upgrade this app to Java 21
copilot> migrate this Spring Boot app to Azure
```

**Note:** Only `modernize` is user-invocable. All other agents are internal and routed to automatically by the orchestrator.

## Workflow

The orchestrator supports multiple workflows depending on user intent:

| Workflow | When It Activates | What Happens |
|----------|-------------------|--------------|
| **Broad Intent** | "modernize my application" | Full assess → plan → execute pipeline |
| **Specific Task** | "upgrade to Java 21" | Skips assessment, goes straight to plan → execute |
| **Execute Existing Plan** | "execute the plan" | Skips assessment and planning, runs an existing plan |
| **Headless** | Unattended execution with `--allow-all` | Same as Broad Intent with no user prompts |

All workflows run automatically — just describe what you want and the orchestrator handles routing.

### Phase 1: Assessment

- Discovers applications in the specified path
- Auto-detects project language (Java or .NET) and uses the appropriate analysis tools
- Analyzes dependencies, frameworks, and versions
- Identifies modernization opportunities and risks
- Saves results to `.github/modernize/assessment/` (report.json)

### Phase 2: Planning

- Loads assessment results and enterprise playbook (if present)
- Merges enterprise constraints (target architectures, guardrails, standards) with assessment findings — **playbook policies override assessment recommendations**
- Generates an executable task plan with language metadata
- Saves the plan to `.github/modernize/<app>/plan.md` and `tasks.json`

### Phase 3: Execution

- Routes tasks to specialized executor agents based on language and task type:
  - **Java upgrade tasks** → Java version upgrades, Spring Boot upgrades, javax → jakarta migration, deprecated API migrations
  - **Azure migration tasks (Java)** → Service Bus, Azure SQL, Redis, Key Vault, Application Insights, Managed Identity
  - **Azure migration tasks (.NET)** → ASP.NET to Azure, NuGet dependency updates, .NET-specific Azure service integrations
  - **Security/CVE tasks** → CVE vulnerability scanning and fixing for Maven and NuGet dependencies
  - **Rearchitecture tasks** → Structural rewrites using a multi-agent coordinator/worker pattern (monolith decomposition, legacy UI modernization, module extraction)
- Each executor queries MCP knowledge base for migration patterns
- Monitors progress with automatic retry on failure

## Enterprise Modernization Intent

Organizations can embed their modernization policies, target architectures, and upgrade standards directly into the workflow through a **playbook**. This ensures every generated plan aligns with enterprise standards — without requiring manual review of each decision.

### How It Works

Place markdown files in the `.github/modernize/playbook/` directory of your project. The planning phase automatically reads all `.md` files in this folder and merges them with assessment results before generating the task plan. **Playbook constraints override assessment recommendations** — if your playbook specifies "use Azure Service Bus for messaging," that takes precedence regardless of what the assessment discovers.

### What You Can Define

| Policy Type | Examples |
|-------------|---------|
| **Target Architectures** | Target compute services (App Service, AKS, Container Apps), database choices (Azure SQL, Cosmos DB), messaging platforms (Service Bus, Event Hubs) |
| **Upgrade Standards** | Target Java version (17 or 21), Spring Boot version (3.x), .NET version, framework migration paths |
| **Guardrails** | Prohibited technologies, security requirements, compliance constraints, authentication standards (e.g., "all services must use Managed Identity") |
| **Coding Standards** | Naming conventions, authentication patterns, logging frameworks, error handling approaches |
| **Migration Strategy** | Scope boundaries, 6R classification preferences (rehost vs refactor vs rearchitect), phasing strategy |

### Example Playbook

Create `.github/modernize/playbook/enterprise-standards.md`:

```markdown
# Enterprise Modernization Standards

## Target Architecture
- All Java applications must target Java 21 and Spring Boot 3.x
- Use Azure Container Apps for microservices deployments
- Use Azure Service Bus for all asynchronous messaging (replace RabbitMQ, ActiveMQ)
- Use Azure Database for PostgreSQL Flexible Server for relational data

## Security & Compliance
- All services must authenticate using Managed Identity — no connection strings or passwords in code
- All public endpoints must be behind Azure Front Door
- Enable Azure Defender for all deployed resources

## Guardrails
- Do not use Azure Functions for long-running processes
- Do not introduce Kafka — use Event Hubs with Kafka protocol if needed
- All infrastructure must be defined in Bicep (no Terraform, no ARM templates)
```

No fixed naming or structure is required — use any filenames and headings that make sense for your organization. The orchestrator infers the purpose of each file from its content.

### Built-in Defaults

Without a playbook, the plugin applies sensible defaults:

- **Java**: Upgrade to 17+ (21 only if explicitly requested); Spring Boot 3.x with javax → jakarta migration
- **Azure**: Managed Identity for authentication; managed database services for relational data
- **Messaging**: RabbitMQ/ActiveMQ → Azure Service Bus; Kafka → Azure Event Hubs
- **Infrastructure**: Bicep by default

## Common Workflows

### Java Version Upgrade

```bash
copilot --agent=github-copilot-modernization:modernize
copilot> upgrade this app to Java 21
```

### Azure Migration (Java)

```bash
copilot --agent=github-copilot-modernization:modernize
copilot> migrate this Spring Boot app to Azure
```

### Azure Migration (.NET)

```bash
copilot --agent=github-copilot-modernization:modernize
copilot> modernize my .NET application for Azure
```

### CVE / Security Fix

```bash
copilot --agent=github-copilot-modernization:modernize
copilot> fix CVE vulnerabilities in my project
```

### Application Rearchitecture

```bash
copilot --agent=github-copilot-modernization:modernize
copilot> rearchitect my monolithic application into microservices
```

### Full Modernization (Upgrade + Migration)

```bash
copilot --agent=github-copilot-modernization:modernize
copilot> modernize my application
```

## Example: End-to-End Migration

Here's a complete example modernizing a Spring Boot app:

```bash
# 1. Navigate to project
cd ~/projects/my-spring-app

# 2. Start the orchestrator
copilot --agent=github-copilot-modernization:modernize

# 3. Ask for modernization (assessment, planning, and execution run automatically)
copilot> modernize my application

# 4. After completion, verify results
mvn clean test
mvn spring-boot:run
```

## Troubleshooting

### Plugin Not Found

```bash
# Verify marketplace is added
copilot plugin marketplace list

# Re-add marketplace if needed
copilot plugin marketplace add microsoft/github-copilot-modernization

# Reinstall
copilot plugin install github-copilot-modernization@github-copilot-modernization
```

### Assessment Fails: No Application Found

- For Java projects: verify `pom.xml` or `build.gradle` exists in your project root
- For .NET projects: verify `.csproj` or `.sln` exists in your project root
- Ensure you are in the correct directory before starting Copilot CLI

### MCP Server Issues

The plugin uses the MCP server defined in `.mcp.json`. If you encounter issues, try reinstalling the plugin to reset the MCP configuration.

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

## License

MIT

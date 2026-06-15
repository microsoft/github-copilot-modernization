## Supported Task Patterns

The following are the task patterns supported by the modernize CLI. These patterns are used to identify the modernization tasks that need to be performed based on the user's input.

The patterns are categorized into two groups, and they should be treated differently if picked:

* Patterns with skill definitions: These patterns have pre-defined skills that can be used to execute the tasks. If a task matches one of these patterns, the corresponding skill should be used in the task plan.
* Patterns without skill definitions: These patterns do not have pre-defined skills. If a task matches one of these patterns, the description should be used to guide the AI in performing the required tasks.
   **IMPORTANT**: The pattern name should NEVER be used as the skill name in the generated plan and tasks.json. They are meant to guide the task generation, not to be directly used as skills.


### Task Patterns with Skill Definitions
These patterns have pre-defined skills to assist in their execution. When they are selected in a modernization plan, the corresponding skills should be used.
Each of the item is written in the following format: `- **skill-name**: skill-description`.

- **azcli-aks-deploy**: Generate plan for deploying to existing Azure Resources for Azure Kubernetes Service, using azcli
- **azcli-appservice-deploy**: Deployment steps for Azure App Service under the AzCLI flow
- **azcli-appservicemi-deploy**: Deployment steps for Azure App Service Managed Identity under the AzCLI flow
- **azcli-containerapp-deploy**: Generate plan for deploying to existing Azure Resources for Azure Container Apps, using azcli
- **azcli-functionapp-deploy**: Deployment steps for Azure Function App under the AzCLI flow
- **containerization**: Setup Dockerfiles for the project to run inside of containers for Azure Container Apps or Azure Kubernetes Service.
- **infrastructure-bicep-generation**: Generate Bicep IaC files for Azure infrastructure provisioning
- **infrastructure-terraform-generation**: Generate Terraform IaC files for Azure infrastructure provisioning
- **migration-azure-communication-email**: This knowledge base provides knowledge about how to use Azure Communication Services for sending emails in .NET applications, covering authentication with Managed Identity, configuration, and email operations.
- **migration-azure-confluent-kafka**: This knowledge base provides knowledge about migrating .NET applications using Confluent.Kafka from local Kafka to Confluent Cloud on Azure, using Azure Managed Identity and DefaultAzureCredential.
- **migration-azure-database-postgresql**: This file provides guidance for migrating .NET applications to Azure Database for PostgreSQL with passwordless Managed Identity, covering both Entity Framework Core and non-EF Core applications.
- **migration-azure-eventhubs-kafka**: This knowledge base provides knowledge about migrating .NET applications using Confluent.Kafka from local Kafka to Azure Event Hubs for Kafka, using Azure Managed Identity and DefaultAzureCredential.
- **migration-azure-keyvault-certificate**: This file provides guidance on using Azure Key Vault certificate management in .NET, covering authentication, configuration, and certificate operations.
- **migration-azure-keyvault-secret**: This file provides guidance on using Azure Key Vault secrets in .NET, covering authentication, configuration, and secret operations.
- **migration-azure-redis-cache**: This knowledge base provides guidance for adding distributed caching with Azure Cache for Redis to .NET applications, or migrating existing caching implementations (in-memory cache, Redis, or other providers) to use Azure Cache for Redis with DefaultAzureCredential (Managed Identity) authentication.
- **migration-azure-servicebus**: This knowledge base provides knowledge about migrating .NET applications to use Azure Service Bus with Managed Identity, covering queue and topic operations, message handling, and processor configurations.
- **migration-azure-sql-database**: This knowledge base provides knowledge about migrating .NET applications to use Azure SQL Database and Azure SQL Managed Instance with Managed Identity authentication, including Entity Framework 6 provider configuration.
- **migration-azure-storage-blob**: This knowledge base provides comprehensive knowledge about using Azure Storage Blob SDK in .NET applications, covering Managed Identity authentication, blob operations, container management, and SAS token generation.
- **migration-azure-storage-mount**: This knowledge base provides knowledge about migrating .NET applications from using hard-coded local file paths to Azure mounted storage paths while maintaining the same functionality.
- **migration-console-logging**: This knowledge base provides knowledge about configuring console logging in .NET applications for cloud environments, ensuring proper log output for container and cloud platform log aggregation.
- **migration-dependency-management**: Comprehensive guide for understanding and implementing dependency management in .NET projects, covering both modern SDK-style projects (.NET Core, .NET 5+) and legacy .NET Framework projects. Includes package reference management, project file structure, and migration considerations.
- **migration-local-appsettings-azure-app-configuration**: This knowledge base provides guidance on moving non-secret application settings from appsettings.json / appsettings.{Environment}.json into Azure App Configuration while preserving the existing IConfiguration / IOptions<T> shape, and emitting a `.azure/configuration-migration.json` seed file for the deployment agent.
- **migration-local-appsettings-azure-app-configuration-via-deployment**: This knowledge base provides guidance on externalizing non-secret values from appsettings.json to Azure App Configuration without adding the App Configuration SDK. The only allowed application-side change is ensuring the environment-variable configuration source is registered so that values injected by the deployment agent are visible through IConfiguration. The migration agent writes the `.azure/configuration-migration.json` contract; the deployment agent injects the values at runtime as App Service application settings or as a Kubernetes ConfigMap/Secret produced by the Azure App Configuration Kubernetes Provider.
- **migration-managed-identity**: Comprehensive guidance for migrating .NET applications to use Azure Managed Identity for authentication instead of connection strings, client secrets, certificates, or other credential-based authentication methods. Covers Azure SQL, Storage, Key Vault, Service Bus, Event Hubs, Cosmos DB, and more.
- **migration-microsoft-entra-id**: This knowledge base provides knowledge about migrating .NET applications to use Microsoft Entra ID (formerly Azure AD) for authentication, including ASP.NET Core, ASP.NET Web Forms, and Microsoft Graph integration.
- **migration-opentelemetry-azure**: This guide describes how to implement OpenTelemetry in .NET with Azure Monitor for tracing, metrics, and logging migration.

### Task Patterns without Skill Definitions
These patterns DO NOT have pre-defined skills. The pattern name and description define the modernization scenario, NOT A SKILL. They are in the format of `- **pattern-name**: pattern-description`.

A pattern should be selected if it matches one of the customer's requirements, and there are no skills supporting this requirement.

**IMPORTANT**:
- NEVER write the pattern name as skill name in the generated plan.
- Tasks generated from these patterns must have NO skill assigned. Do not reuse any skill from the "Task Patterns with Skill Definitions" section, even if a skill targets a similar technology or appears related.



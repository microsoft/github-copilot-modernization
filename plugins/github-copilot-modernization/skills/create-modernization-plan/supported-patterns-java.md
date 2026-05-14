## Supported Task Patterns

The following are the task patterns supported by the modernize CLI. These patterns are used to identify the modernization tasks that need to be performed based on the user's input.

The patterns are categorized into two groups, and they should be treated differently if picked:

* Patterns with skill definitions: These patterns have pre-defined skills that can be used to execute the tasks. If a task matches one of these patterns, the corresponding skill should be used in the task plan.
* Patterns without skill definitions: These patterns do not have pre-defined skills. If a task matches one of these patterns, the description should be used to guide the AI in performing the required tasks.
   **IMPORTANT**: The pattern name should NEVER be used as the skill name in the generated plan and tasks.json. They are meant to guide the task generation, not to be directly used as skills.


### Task Patterns with Skill Definitions
These patterns have pre-defined skills to assist in their execution. When they are selected in a modernization plan, the corresponding skills should be used.
Each of the item is written in the following format: `- **skill-name**: skill-description`.

- **infrastructure-bicep-generation**: Generate Bicep IaC files for Azure infrastructure provisioning
- **infrastructure-terraform-generation**: Generate Terraform IaC files for Azure infrastructure provisioning
- **migration-cache-related-code-to-redis**: Provides knowledge for migrating cache related code to use Redis, and potentially to Azure Managed Redis / Azure Cache for Redis (retiring) while following best practices. Use this skill when users want to migrate their cache related code to use Redis, such as Apache Commons JCS, DynaCache, Embedded cache, JCache, OSCache, ShiftOne, Oracle Coherence, etc., or local Redis to Azure Managed Redis / Azure Cache for Redis (retiring) with secure authentication changes.
- **migration-activemq-servicebus**: Migrate from ActiveMQ Artemis to Azure Service Bus for messaging.
- **migration-amqp-rabbitmq-servicebus**: Migrate from RabbitMQ with AMQP to Azure Service Bus for messaging.
- **migration-ant-project-to-maven-project**: Migrate current project from Ant project to Maven project
- **migration-deprecated-api-upgrade**: Upgrade deprecated APIs to their recommended alternatives for improved security, performance, and compatibility.
- **migration-eclipse-project-to-maven-project**: Migrate current project from eclipse project to maven project
- **migration-java-ee-amqp-rabbitmq-servicebus**: Migrate from RabbitMQ with AMQP to Azure Service Bus for messaging in Java EE/Jakarta EE applications.
- **migration-jax-rpc-to-jax-ws**: Migrate from JAX-RPC to JAX-WS for web services. JAX-RPC is deprecated and JAX-WS is the recommended alternative.
- **migration-kafka-to-eventhubs**: Migrate from Kafka to Azure Event Hubs for Apache Kafka with managed identity for secure, credential-free authentication.
- **migration-mi-azure-sql**: Secure Azure SQL with managed identity.
- **migration-mi-mariadb**: Migrate from MariaDB to Azure Database for MariaDB with managed identity for secure, credential-free authentication.
- **migration-mi-mongodb**: Secure Azure DocumentDB (with MongoDB Compatibility) with Microsoft Entra ID authentication for credential-free access.
- **migration-mi-mysql**: Migrate from MySQL to Azure Database for MySQL with managed identity for secure, credential-free authentication.
- **migration-mi-postgresql**: Migrate from PostgreSQL to Azure Database for PostgreSQL with managed identity for secure, credential-free authentication.
- **migration-on-premises-user-authentication-to-microsoft-entra-id**: Migrate the user authentication to Microsoft Entra ID authentication
- **migration-oracle-to-postgresql**: Migrate from Oracle DB to PostgreSQL
- **migration-spring-jms-rabbitmq-servicebus**: Migrate from RabbitMQ with JMS to Azure Service Bus for a managed messaging service with JMS API support.

### Task Patterns without Skill Definitions
These patterns DO NOT have pre-defined skills. The pattern name and description define the modernization scenario, NOT A SKILL. They are in the format of `- **pattern-name**: pattern-description`.

A pattern should be selected if it matches one of the customer's requirements, and there are no skills supporting this requirement.

**IMPORTANT**:
- NEVER write the pattern name as skill name in the generated plan.
- Tasks generated from these patterns must have NO skill assigned. Do not reuse any skill from the "Task Patterns with Skill Definitions" section, even if a skill targets a similar technology or appears related.

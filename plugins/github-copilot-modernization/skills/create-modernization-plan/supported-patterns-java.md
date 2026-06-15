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
- **migration-AWS-secrets-manager-to-azure-key-vault**: Migrates Java applications from AWS Secrets Manager (SecretsManagerClient, AWSSecretsManager) to Azure Key Vault SecretClient for secrets management. Use when migrating Java projects from AWS to Azure, replacing AWS secret storage with Azure Key Vault, or modernizing cloud secret management.
- **migration-activemq-servicebus**: Migrates Java Spring Boot applications from ActiveMQ JMS messaging to Azure Service Bus JMS. Replaces ActiveMQ dependencies with Spring Cloud Azure Service Bus JMS starter and updates connection configuration. Use when migrating Spring JMS applications from ActiveMQ to Azure Service Bus or modernizing on-premises messaging to Azure.
- **migration-amqp-rabbitmq-servicebus**: Migrates Java Spring applications from RabbitMQ AMQP messaging to Azure Service Bus via Spring Messaging. Replaces Spring AMQP RabbitMQ dependencies, updates connection settings, and migrates message producers and consumers. Use when migrating Spring applications from RabbitMQ to Azure Service Bus or replacing on-premises message brokers with Azure managed messaging.
- **migration-ant-project-to-maven-project**: Migrates Java projects from Ant build system to Maven, converting build.xml to pom.xml and restructuring directories to Maven standard layout. Use when modernizing Java projects that use Ant builds, converting to Maven for dependency management, or standardizing build tooling.
- **migration-auth-by-mi-for-azure-redis-in-micronaut-project**: Secure Azure Cache for Redis with Managed Identity via Micronaut
- **migration-certificate-management-to-azure-key-vault**: Migrates Java TLS/MTLS certificate management from local KeyStore storage to Azure Key Vault JCA (Java Cryptography Architecture). Replaces local certificate handling with Azure Key Vault for centralized certificate management. Use when migrating Java applications that use local KeyStore, SSLContext, or Certificate classes to Azure Key Vault for secure certificate storage.
- **migration-confluent-cloud-kafka**: Migrates Java applications from self-hosted Apache Kafka to Apache Kafka on Confluent Cloud with passwordless authentication via Microsoft Entra ID. Updates Kafka connection configuration and authentication settings. Use when migrating Java Kafka producers or consumers to Confluent Cloud or enabling passwordless Entra ID authentication for Kafka on Confluent Cloud.
- **migration-cryptography-operations-to-azure-key-vault**: Migrates Java cryptographic operations (Cipher, Signature) from local key management to Azure Key Vault for centralized key management and cryptographic operations. Use when migrating Java applications that use javax.crypto.Cipher or java.security.Signature to Azure Key Vault, or centralizing cryptographic key management in Azure.
- **migration-eclipse-project-to-maven-project**: Migrates Java projects from Eclipse IDE project format (.project, .classpath) to Apache Maven project structure with pom.xml. Converts Eclipse build configuration and classpath settings to Maven conventions. Use when modernizing Eclipse-based Java projects to Maven, converting .project/.classpath files, or standardizing build tooling.
- **migration-ibm-db2-to-azure-postgresql**: Migrate IBM Db2 to Azure Database for PostgreSQL
- **migration-ibm-db2-to-azure-sql**: Migrate IBM Db2 to Azure SQL Database
- **migration-informix-to-postgresql**: Migrates Java application database layer from Informix Database to PostgreSQL, including JDBC driver changes, SQL syntax conversion, and Informix-specific feature replacement. Use when migrating Java applications from Informix to PostgreSQL, converting Informix SQL to PostgreSQL syntax, or replacing Informix JDBC drivers.
- **migration-java-ee-amqp-rabbitmq-servicebus**: Migrates Java EE/Jakarta EE applications from RabbitMQ AMQP messaging to Azure Service Bus SDK. Replaces RabbitMQ client dependencies, migrates publishers and consumers, updates connection management, and maps RabbitMQ concepts (exchanges, queues) to Service Bus equivalents (topics, subscriptions). Use when migrating Java EE or Jakarta EE applications from RabbitMQ to Azure Service Bus.
- **migration-javax.email-send-to-azure-communication-service-email**: Migrates Java applications from JavaMail (javax.mail) API to Azure Communication Service Email for sending emails. Replaces JavaMail email sending, message construction, and authentication with Azure Communication Service equivalents. Use when migrating Java applications from JavaMail or SMTP-based email sending to Azure Communication Service Email.
- **migration-jax-rpc-to-jax-ws**: Migrates Java web service implementations from deprecated JAX-RPC to JAX-WS. Updates web service configuration files and JAX-RPC specific code to use JAX-WS equivalents. Use when modernizing Java web services that use JAX-RPC or upgrading deprecated JAX-RPC APIs to the JAX-WS standard.
- **migration-kafka-to-eventhubs**: Migrates Java applications from Kafka to Azure Event Hubs for Kafka with managed identity for secure, passwordless authentication. Updates Spring Cloud Azure dependencies, Kafka connection settings, and authentication configuration. Use when migrating Java Kafka producers or consumers to Azure Event Hubs, or enabling managed identity authentication for event streaming.
- **migration-log-to-console**: Migrates Java application logging from file-based output to console-only output. Removes file appenders from logging configuration (logback, logging.xml) and ensures all log output goes to console. Use when containerizing Java applications, migrating to cloud-native logging, or preparing Java apps for Azure where console logging is preferred.
- **migration-mi-azure-sql**: Migrates Java Spring Boot projects from password-based authentication to Azure Managed Identity for connecting to Azure SQL Database. Updates Spring Cloud Azure dependencies and datasource configuration for passwordless authentication. Use when enabling managed identity for Azure SQL Database connections, removing hardcoded database passwords, or securing Java Spring Boot database authentication.
- **migration-mi-cassandra**: Migrates Java applications to connect to Azure Cosmos DB for Apache Cassandra using managed identity via Service Connector in Azure public cloud. Updates CqlSession configuration and Spring Data Cassandra properties. Use when migrating Java or Spring Boot applications to Azure Cosmos DB Cassandra API, enabling managed identity for Cassandra connections, or replacing Cassandra password authentication.
- **migration-mi-eventhub**: Migrates Java projects from password-based authentication to Azure Managed Identity for connecting to Azure Event Hubs. Adds Spring Cloud Azure dependencies and updates Event Hubs and Kafka configuration for passwordless authentication. Use when enabling managed identity for Azure Event Hubs in Java applications, removing Event Hubs connection string passwords, or securing event streaming authentication.
- **migration-mi-mariadb**: Migrates Java applications from password-based MariaDB authentication to Azure Managed Identity for Azure Database for MariaDB in public cloud using AzureMysqlAuthenticationPlugin. Updates JDBC connection and authentication configuration. Use when enabling managed identity for Azure Database for MariaDB, removing MariaDB passwords, or implementing credential-free MariaDB authentication in Azure.
- **migration-mi-mongodb**: Migrate from password-based authentication to Microsoft Entra ID authentication for Azure DocumentDB (with MongoDB Compatibility) in Java projects
- **migration-mi-mysql**: Migrates Java Spring Boot projects from password-based MySQL authentication to Azure Managed Identity for Azure Database for MySQL. Updates Spring Cloud Azure dependencies and datasource configuration for passwordless authentication. Use when enabling managed identity for Azure MySQL connections in Spring Boot, removing hardcoded MySQL passwords, or securing Spring datasource authentication.
- **migration-mi-postgresql**: Migrates Java Spring Boot projects from password-based PostgreSQL authentication to Azure Managed Identity for Azure Database for PostgreSQL. Updates Spring Cloud Azure dependencies and datasource configuration for passwordless authentication. Use when enabling managed identity for Azure PostgreSQL connections in Spring Boot, removing hardcoded PostgreSQL passwords, or securing Spring datasource authentication.
- **migration-mi-servicebus**: Azure Service Bus Managed Identity via Spring
- **migration-on-premises-user-authentication-to-microsoft-entra-id**: Migrates Java Spring Boot application user authentication from on-premises login to Microsoft Entra ID using spring-cloud-azure-starter-active-directory and spring-boot-starter-oauth2-client. Use when migrating Java web application authentication to Microsoft Entra ID, modernizing on-premises login to cloud identity, or adding Azure Active Directory authentication.
- **migration-oracle-to-postgresql**: Migrates Java application database layer from Oracle Database to PostgreSQL, including JDBC driver changes, SQL syntax conversion, and Oracle-specific feature replacement. Uses project-specific coding_notes.md guidance when available. Use when migrating Java applications from Oracle to PostgreSQL, converting Oracle SQL to PostgreSQL syntax, or replacing Oracle JDBC drivers.
- **migration-other-cache-solutions-to-azure-managed-cache**: Migrate other cache solutions to use Redis, and potentially to Azure Managed Redis / Azure Cache for Redis (retiring) while following best practices. Use this skill when users want to migrate other cache solutions to use Redis, such as Apache Commons JCS, DynaCache, Embedded cache, JCache, OSCache, ShiftOne, Oracle Coherence, etc., or local Redis to Azure Managed Redis / Azure Cache for Redis (retiring) with secure authentication changes.
- **migration-plaintext-credential-to-azure-keyvault**: Migrates hardcoded plaintext credentials (passwords, secrets, API keys, connection strings, tokens) in Java source code to Azure Key Vault for secure storage and retrieval. Use when securing Java applications by removing hardcoded credentials, migrating plaintext secrets to Azure Key Vault, or implementing centralized secret management.
- **migration-s3-to-azure-blob-storage**: Migrates Java applications from Amazon S3 SDK to Azure Blob Storage SDK, including bucket/container operations, object storage, access policies, and SAS token generation. Use when migrating Java applications from AWS S3 to Azure Blob Storage, replacing S3Client with BlobServiceClient, or converting AWS storage APIs to Azure equivalents.
- **migration-spring-jms-rabbitmq-servicebus**: Migrates Java Spring Boot applications from RabbitMQ JMS messaging to Azure Service Bus JMS. Replaces RabbitMQ JMS dependencies with Spring Cloud Azure Service Bus JMS starter and updates connection configuration. Use when migrating Spring JMS applications from RabbitMQ to Azure Service Bus, replacing RMQConnectionFactory, or modernizing JMS messaging to Azure.
- **migration-sqs-to-servicebus**: Migrates Java applications from AWS Simple Queue Service (SQS) to Azure Service Bus for message queuing. Replaces AWS SQS SDK dependencies with Azure Service Bus SDK, updates message sending and receiving code, and migrates queue configuration. Use when migrating Java applications from AWS SQS to Azure Service Bus, replacing SQS client code, or modernizing cloud message queuing to Azure.
- **migration-sybase-ase-to-azure-sql-database**: Migrates Java application database layer from Sybase ASE (Adaptive Server Enterprise) to Azure SQL Database with passwordless managed identity authentication. Use when migrating Java applications from Sybase ASE to Azure SQL.

### Task Patterns without Skill Definitions
These patterns DO NOT have pre-defined skills. The pattern name and description define the modernization scenario, NOT A SKILL. They are in the format of `- **pattern-name**: pattern-description`.

A pattern should be selected if it matches one of the customer's requirements, and there are no skills supporting this requirement.

**IMPORTANT**:
- NEVER write the pattern name as skill name in the generated plan.
- Tasks generated from these patterns must have NO skill assigned. Do not reuse any skill from the "Task Patterns with Skill Definitions" section, even if a skill targets a similar technology or appears related.

- **amazon-kinesis-to-azure-event-hubs**: Amazon Kinesis to Azure Event Hubs
- **amazon-sns-to-azure-service-bus**: Amazon SNS to Azure Service Bus
- **apache-pulsar-to-azure-event-hubs**: Apache Pulsar to Azure Event Hubs
- **aws-lambda-to-azure-functions**: AWS Lambda to Azure Functions
- **firebird-to-azure-postgresql**: Firebird to Azure PostgreSQL
- **google-cloud-bigtable-to-azure-cosmos-db**: Google Cloud Bigtable to Azure Cosmos DB
- **google-cloud-functions-to-azure-functions**: Google Cloud Functions to Azure Functions
- **google-cloud-pub-sub-to-azure-service-bus**: Google Cloud Pub/Sub to Azure Service Bus
- **google-cloud-spanner-to-azure-postgresql**: Google Cloud Spanner to Azure PostgreSQL
- **google-cloud-storage-to-azure-blob-storage**: Google Cloud Storage to Azure Blob Storage
- **google-firestore-to-azure-cosmos-db**: Google Firestore to Azure Cosmos DB
- **ibm-db2-to-azure-postgresql**: IBM DB2 to Azure PostgreSQL
- **ibm-mq-jms-to-azure-service-bus**: IBM MQ JMS to Azure Service Bus
- **migration-local-certificate-management-to-azure-key-vault**: Local certificate management to Azure Key Vault
- **migration-local-files-to-mounted-azure-storage**: Local files to mounted Azure Storage paths (starts with `${AZURE_MOUNT_PATH:/mnt/azure}`)
- **quartz-scheduler-to-azure-functions**: Quartz Scheduler to Azure Functions
- **solace-pubsub-to-azure-service-bus**: Solace PubSub+ to Azure Service Bus
- **spring-batch-to-azure-durable-functions**: Spring Batch to Azure Durable Functions
- **spring-cloud-config-to-azure-app-configuration**: Spring Cloud Config to Azure App Configuration
- **sqlite-to-azure-postgresql**: SQLite to Azure PostgreSQL
- **sybase-ase-to-azure-postgresql**: Sybase ASE to Azure Database for PostgreSQL
- **tibco-ems-jms-to-azure-service-bus**: TIBCO EMS JMS to Azure Service Bus

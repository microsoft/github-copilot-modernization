# Azure Authentication Strategies for Smoke Tests

Migrated applications typically use **Managed Identity** (`DefaultAzureCredential`) which only works on Azure infrastructure. For local smoke testing, applications must connect to local emulators or have Azure services disabled.

## Azure Dependency Classification

Classify each Azure dependency into one of three categories:

| Category | Smoke Test Strategy | Example Services |
|----------|---------------------|------------------|
| **Emulatable** | Use local emulator with connection string auth | Azurite, Cosmos Emulator, Service Bus Emulator, Event Hubs Emulator |
| **Lazy** | Skip — not validated at startup | On-demand blob uploads, external REST APIs |
| **Startup-required, non-emulatable** | Disable via config, or recommend Layer 3 | Key Vault, App Configuration |

### Emulatable Azure Services

These services have official emulators that can run in Docker containers:

| Azure Service | Emulator Image | Dependencies |
|---------------|----------------|--------------|
| Blob / Queue / Table Storage | `mcr.microsoft.com/azure-storage/azurite` | None |
| Cosmos DB | `mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator` | None (but requires SSL trust store + endpoint/key auth) |
| SQL Database | `mcr.microsoft.com/mssql/server` | None (wire-compatible with SQL Server) |
| Service Bus | `mcr.microsoft.com/azure-messaging/servicebus-emulator` | Requires MSSQL companion + JSON config |
| Event Hubs | `mcr.microsoft.com/azure-messaging/eventhubs-emulator` | Requires Azurite companion + JSON config |

> **Note:** Service Bus and Event Hubs emulators require companion containers and a JSON config file. See [azure-servicebus-testcontainers.md](./azure-servicebus-testcontainers.md) for the config format.

**Cosmos DB emulator note:** Unlike other emulators which use connection strings, the Cosmos DB emulator authenticates via **endpoint + account key** and requires an **SSL certificate** imported into a trust store (e.g., `javax.net.ssl.trustStore` for Java). If SSL setup is too complex, treat Cosmos DB as non-emulatable and recommend Layer 3.

### Lazy Azure Connections

If an Azure client is only used inside request handlers or scheduled jobs (no `@PostConstruct` / `IHostedService.StartAsync` / health check probing it), it's lazy. **Skip it** — the app starts fine without it.

**How to identify:**
- Client is injected but never called during startup
- Client is used only in REST endpoint handlers
- Client is used in background jobs that start after initialization

### Startup-Required, Non-Emulatable Services

Some Azure services are required at startup but have no local emulator.

**Resolution strategies (in priority order):**

1. **Disable via config** — e.g., `spring.cloud.azure.keyvault.secret.enabled=false` or `KeyVault__Enabled=false` with an `if` guard around registration.
2. **Stub the health check** — Skip that health indicator in the smoke profile.
3. **Accept partial startup** — Non-fatal errors are OK for Layer 2 if the app reaches a healthy state.
4. **Skip Layer 2, recommend Layer 3** — If the app cannot start without a real Azure connection.

## Authentication Modification Strategies

For each emulatable Azure dependency, modify how the application authenticates:

### Config-Driven Applications

**Examples:** Spring Boot applications with `application.properties` or `application.yml`, Quarkus/Micronaut applications with `application.properties`

**When to use:** Applications that use a configuration framework to externalize settings. These apps read connection strings from config files at runtime.

**Strategy:** Modify config files to add explicit emulator connection strings. Create or modify the main config file (NOT environment variables, NOT test-only config files).

**Which config file to modify:**
- Spring Boot: `src/main/resources/application.properties` or `src/main/resources/application.yml`
- Quarkus: `src/main/resources/application.properties`

**CRITICAL:** You MUST always modify the config file to add the explicit connection string value. Do NOT rely on environment variables.

**Example:**

`src/main/resources/application.properties`:
```properties
azure.storage.blob.connection-string=DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://localhost:10000/devstoreaccount1;
spring.data.mongodb.uri=mongodb://localhost:27017/mydb
```

**If the application code uses `@Bean` methods or manual client construction:** You may also need to modify the code to read these config properties if it doesn't already. Add code to accept the connection string property with fallback to the original auth. Then add the connection string value to the config file as shown above.

### Hardcoded/Plain Applications

**Examples:** Plain Java CLI apps without config frameworks

**When to use:** Applications that have NO configuration framework (no Spring Boot, no application.properties). These apps construct clients directly in code with hardcoded values.

**Strategy:** Modify the source code to hardcode emulator connection strings directly in the client construction code. Since these applications don't have config files to modify, the connection string must be in the source code itself to be committed to git.

**Why hardcoding is required:**
- No config framework means no config files to modify
- Environment variables aren't committed to git, so they won't be reverted by the restore commit
- The auth commit must contain a reversible change in tracked files

**Java example:**

**Before:**
```java
public class BlobServiceClientProvider {
    private static BlobServiceClient blobServiceClient;

    public static BlobServiceClient getClient() {
        if (blobServiceClient == null) {
            String endpoint = System.getenv("AZURE_STORAGE_ENDPOINT");
            blobServiceClient = new BlobServiceClientBuilder()
                .endpoint(endpoint)
                .credential(new DefaultAzureCredentialBuilder().build())
                .buildClient();
        }
        return blobServiceClient;
    }
}
```

**After:**
```java
public class BlobServiceClientProvider {
    private static BlobServiceClient blobServiceClient;

    public static BlobServiceClient getClient() {
        if (blobServiceClient == null) {
            // Hardcoded connection string for smoke testing with Azurite emulator
            String smokeTestConnectionString = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://localhost:10000/devstoreaccount1;";

            if (smokeTestConnectionString != null && !smokeTestConnectionString.isEmpty()) {
                blobServiceClient = new BlobServiceClientBuilder()
                    .connectionString(smokeTestConnectionString)
                    .buildClient();
            } else {
                // Fallback to original Managed Identity auth
                String endpoint = System.getenv("AZURE_STORAGE_ENDPOINT");
                blobServiceClient = new BlobServiceClientBuilder()
                    .endpoint(endpoint)
                    .credential(new DefaultAzureCredentialBuilder().build())
                    .buildClient();
            }
        }
        return blobServiceClient;
    }
}
```

**CRITICAL:** Only the source code changes are included in the auth commit. No config file changes because there are no config files.

### Non-Emulatable Services

**Strategy:** Disable via config or conditional guards:

**Spring Boot example:**
```yaml
# application-smoke.yml
spring:
  cloud:
    azure:
      keyvault:
        secret:
          enabled: false
```

If the app cannot start without the service, recommend Layer 3 (Azure integration tests).

## Emulator Connection String Values

Since `docker-compose.smoke.yml` uses **fixed host port mappings**, each emulator's connection string is a **static constant** — deterministic at generation time.

| Service | Auth Type | How to Determine the Value |
|---------|-----------|----------------------------|
| Azurite (Blob/Queue/Table) | Connection string | Built from well-known account `devstoreaccount1`, well-known key, and mapped ports (10000/10001/10002). See [Azurite docs](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite#well-known-storage-account-and-key). |
| Service Bus | Connection string | Built from well-known SAS key + `UseDevelopmentEmulator=true`. See [Service Bus emulator docs](https://learn.microsoft.com/en-us/azure/service-bus-messaging/test-locally-with-service-bus-emulator). |
| Event Hubs | Connection string | Same pattern as Service Bus. See [Event Hubs emulator docs](https://learn.microsoft.com/en-us/azure/event-hubs/test-locally-with-event-hub-emulator). |
| Cosmos DB | Endpoint + key | Built from well-known emulator key + mapped port. See [Cosmos emulator docs](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator). Also requires SSL trust store setup. |

**Important:** The agent must look up the **actual current default credentials** from the linked official docs at generation time. Emulator defaults may change across versions. Do NOT hardcode connection strings from this file.

## Decision Flow

```
For each Azure dependency:
├─ Has local emulator? → Add to docker-compose.smoke.yml → Modify auth to use emulator
├─ Lazy / on-demand? → Skip. Done.
├─ Can disable via config? → Disable in config override or code modification
└─ None of above → Report: "Layer 2 not feasible — use Layer 3"
```

## Modification Rules

When modifying application code or config to use emulators:

1. **Minimal changes only** — Only modify what's needed to switch auth from Managed Identity to emulator connection strings. Do not refactor, rename, or restructure.
2. **No new dependencies** — Use only packages already in the project.
3. **Reversible** — Changes should be easily revertable to restore original Managed Identity auth.
4. **No unrelated changes** — Never make refactoring, cleanup, or feature changes alongside auth modifications.

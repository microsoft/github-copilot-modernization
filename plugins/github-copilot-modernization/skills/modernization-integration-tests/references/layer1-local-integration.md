# Layer 1: Local Integration Tests

## Contents
- Prerequisites (Docker & TestContainers available)
- Azure Authentication Strategies for Integration Tests Layer 1 (TokenCredential,Connection Strings, Keys)
  + Emulatable Azure Services
  + Emulator Connection String Values
  + Modification Rules
- Principles
  + 1. Core Principles (naming convention, no source code modification to fix TestContainers or Docker compatibility issues)
  + 2. MOST IMPORTANT: Test application code, not the SDK
  + 3. Make untestable code testable with minimal, safe source changes
  + 4. Wire and test the full execution path
  + 5. Assert on behavior, not structure
  + 6. Only set up what the test uses
  + 7. Test edge cases
  + 8. Cover downstream consumers
  + 9. Only label tests as integration tests if they integrate external systems
  + 10. Stay scoped to the migration target
  + 11. DO NOT use any test ordering mechanism
  + 12. DO NOT use reflection to access or modify private fields,DO NOT widen field visibility
  + 13. DO write specific, descriptive assertions
  + 14. DO structure every test with clear Arrange-Act-Assert (AAA) sections
  + 15. DO add `@BeforeEach` cleanup when tests share a container
  + 16. DO verify the test count after `mvn verify` matches expectations
  + 17. DO extract shared test infrastructure into a base class or helper when you have 2+ test classes
  + 18. DO extract commonly repeated test patterns into helper methods
  + 19. DO NOT leave `System.out.println` or debug logging statements in test code
  + 20. NEVER use `Thread.sleep()` to wait for containers to start

## Prerequisites

- Docker installed and running
- TestContainers library available for the project's language

## Azure Authentication Strategies for Integration Tests Layer 1

Migrated applications typically use **Microsoft Entra ID OAuth** such as **Managed Identity** (`DefaultAzureCredential`) which only works on Azure infrastructure. For local integration testing applications must connect to local emulators.

### Emulatable Azure Services

These services have official emulators that can run in Docker containers:

| Azure Service | Emulator Image | Dependencies |
|---------------|----------------|--------------|
| Blob / Queue / Table Storage | `mcr.microsoft.com/azure-storage/azurite` | None |
| Cosmos DB | `mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator` | None (but requires SSL trust store + endpoint/key auth) |
| SQL Database | `mcr.microsoft.com/mssql/server` | None (wire-compatible with SQL Server) |
| Service Bus | `mcr.microsoft.com/azure-messaging/servicebus-emulator` | Requires MSSQL companion + JSON config |
| Event Hubs | `mcr.microsoft.com/azure-messaging/eventhubs-emulator` | Requires Azurite companion + JSON config |

> **Note:** Service Bus and Event Hubs emulators require companion containers and a JSON config file. See [azure-servicebus-testcontainers.md](references/azure-servicebus-testcontainers.md) for the config format.

**Cosmos DB emulator note:** Unlike other emulators which use connection strings, the Cosmos DB emulator authenticates via **endpoint + account key** and requires an **SSL certificate** imported into a trust store (e.g., `javax.net.ssl.trustStore` for Java). If SSL setup is too complex, treat Cosmos DB as non-emulatable and recommend Layer 3.

### Authentication Modification Strategies (TokenCredential,Connection Strings, Keys)

For each emulatable Azure dependency, modify how the application authenticates:

#### Config-Driven Applications

**Examples:** Spring Boot applications with `application.properties` or `application.yml`, Quarkus/Micronaut applications with `application.properties`.

**Strategy:** Inject the connection string via test configurations, like property source.

**CRITICAL:** You MUST always modify the config file to add the explicit connection string value. Do NOT rely on environment variables.

#### Hardcoded/Plain Applications

**Examples:** Plain Java CLI apps without config frameworks

**When to use:** Applications that have NO configuration framework (no Spring Boot, no application.properties). These apps construct clients directly in code with hardcoded values.

**Strategy:** Modify the source code to extend the client constructor which accepts hardcode emulator connection strings. Since these applications don't have config files to modify, the connection string must be in the source code itself to be committed to git.

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
            String endpoint = System.getenv("AZURE_STORAGE_ENDPOINT");
            blobServiceClient = new BlobServiceClientBuilder()
                .endpoint(endpoint)
                .credential(new DefaultAzureCredentialBuilder().build())
                .buildClient();
        }
        return blobServiceClient;
    }

    public static BlobServiceClient getClient(String connectionString) {
        if (blobServiceClient == null) {
            blobServiceClient = new BlobServiceClientBuilder()
                .connectionString(testConnectionString)
                .buildClient();
        }
        return blobServiceClient;
    }
}
```

### Emulator Connection String Values

Each emulator's connection string is built from **well-known credentials** that are consistent across all emulator instances.

| Service | Auth Type | How to Determine the Value |
|---------|-----------|----------------------------|
| Azurite (Blob/Queue/Table) | Connection string | Built from well-known account `devstoreaccount1`, well-known key, and mapped ports (10000/10001/10002). See [Azurite docs](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite#well-known-storage-account-and-key). |
| Service Bus | Connection string | Built from well-known SAS key + `UseDevelopmentEmulator=true`. See [Service Bus emulator docs](https://learn.microsoft.com/en-us/azure/service-bus-messaging/test-locally-with-service-bus-emulator). |
| Event Hubs | Connection string | Same pattern as Service Bus. See [Event Hubs emulator docs](https://learn.microsoft.com/en-us/azure/event-hubs/test-locally-with-event-hub-emulator). |
| Cosmos DB | Endpoint + key | Built from well-known emulator key + mapped port. See [Cosmos emulator docs](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator). Also requires SSL trust store setup. |

**Important:** The agent must look up the **actual current default credentials** from the linked official docs at generation time. Emulator defaults may change across versions. Do NOT hardcode connection strings from this file.

### Modification Rules

When modifying application code or config to use emulators:

1. **Minimal changes only** — Only modify what's needed to switch auth from Managed Identity to emulator connection strings. Do not refactor, rename, or restructure.
2. **No new dependencies** — Use only packages already in the project.
3. **Reversible** — Changes should be easily revertable to restore original Managed Identity auth.
4. **No unrelated changes** — Never make refactoring, cleanup, or feature changes alongside auth modifications.

## Principles

### Core Principles

1. **DO integration tests** to verify that different components interact correctly, focusing on data exchange and interface connections.
2. **DO write** comprehensive integration tests using containers to simulate all migrated dependencies, **especially Azure services**.
6. **NEVER modify application source code** to fix TestContainers or Docker compatibility issues.
8. **DO use `*L1Test.java`** as the class name suffix for Layer 1 test classes. This matches Maven Surefire's default `*Test.java` pattern

### MOST IMPORTANT: Test application code, not the SDK

Always instantiate and invoke the project's own classes/methods. Never call third-party library APIs directly in the test as a substitute for testing the application. If the application has a service class with methods like `handleRequest()`, `processData()`, or `createBucket()`, your tests MUST call those methods. 
   **Anti-pattern — DO NOT DO THIS:**
   ```java
   // WRONG: Test calls SDK directly instead of the application's own class
   @Test void testServiceMethod() {
       // This tests the SDK, NOT the application code
       sdkClient.doOperation("test-input");
       assertTrue(sdkClient.getResult("test-input").exists());
   }
   ```

   **Correct pattern — invoke the application's own entry points:**
   ```java
   // RIGHT: Test calls the application's own handler method end-to-end
   @Test void testHandleRequestProcessesDataEndToEnd() {
       // Arrange — pre-populate test data
       setupTestData("container1", "data1.txt", "status:ACTIVE\ntimestamp:1573410202");

       // Act — invoke the APPLICATION's handler, not the SDK
       MyHandler handler = new MyHandler(sdkClient);
       handler.handleRequest(mockContext);

       // Assert — verify the application produced the expected output
       String result = readOutput("output-container", "result.txt");
       assertThat(result).contains("ACTIVE");
   }
   ```
   **Never bypass the application class by re-implementing its logic with direct SDK calls.**

   > For Azure Blob Storage-specific examples (Azurite anti-patterns, `BlobServiceClient` injection, `EventHandler` testing), see [azure-storage-testcontainers.md](./azure-storage-testcontainers.md).

### Make untestable code testable with minimal, safe source changes

If production code cannot be invoked from a test, introduce the smallest possible change (e.g., adding a method, widening visibility, extracting a parameter) to enable it. Never alter existing behavior, signatures, or control flow. Never work around untestable code by re-implementing its logic in the test.

### Wire and test the full execution path

Tests must exercise the end-to-end flow from input through business logic to output, not individual layers (controller layer or database layer) in isolation.

### Assert on behavior, not structure

Verify correct values, side effects, and state transitions — not just that a result is non-null or non-empty, nor rely on string containment or format checks alone. **Every write test must read the data back and verify content.** A test whose only assertion is `assertTrue(result.exists())` or `assertNotNull(result)` is effectively testing nothing.

### Only set up what the test uses

Every configured property, container, or singleton in setUp must be exercised by the test. Remove dead setup.

### Test error handling at the application level with precise assertions — this is MANDATORY, not optional.

   **Anti-pattern — DO NOT DO THIS:**
   ```java
   // WRONG: Only testing happy paths
   @Test void testOperation() { sdkClient.doOperation("test"); /* only happy path */ }
   ```

   **Correct pattern:**
   ```java
   // RIGHT: Test error handling through the application class
   @Test void testOperationWithInvalidInput() {
       RuntimeException ex = assertThrows(RuntimeException.class,
           () -> myService.processInput("INVALID-INPUT"));
       assertThat(ex.getMessage()).contains("Failed to process");
       assertThat(ex.getCause()).isInstanceOf(SomeSDKException.class);
   }
   ```

   **Correct pattern for JSON deserialization error (common with Redis/cache migrations):**
   ```java
   // RIGHT: Inject corrupted data directly into the store, then test the app's error path
   @Test void testGetPersonWithCorruptedJson() {
       // Arrange — write invalid JSON directly to Redis in the SAME namespace the app uses
       redisCommands.set("personCache:badKey", "{not-valid-json!!}");

       // Act & Assert — the app's getPerson() should catch JsonProcessingException and wrap it
       RuntimeException ex = assertThrows(RuntimeException.class,
           () -> cacheManager.getPerson("badKey"));
       assertThat(ex.getMessage()).contains("Failed to deserialize");
       assertThat(ex.getCause()).isInstanceOf(JsonProcessingException.class);
   }
   ```
   **Note:** When testing deserialization errors, write corrupted data to the **same key namespace/prefix** that the application reads from. A common mistake is writing to namespace `stringCache:key` but reading from `personCache:key` — this just produces a cache miss (null), not a deserialization error.

   > For Azure Blob Storage-specific error handling patterns (e.g., `BlobStorageException` wrapping), see [azure-storage-testcontainers.md](./azure-storage-testcontainers.md#5-azure-blob-specific-test-patterns).

   #### Migration-Critical Error Scenarios Checklist

   The following error scenarios are the most commonly missed in migration integration tests. **You MUST check each row and write a test for every scenario that applies to your migration.** Skipping these is the #1 cause of low error handling scores.

   | # | Scenario | When it applies | What to test | Example assertion |
   |---|----------|----------------|--------------|-------------------|
   | 1 | **SDK exception wrapping** | App has `catch (SDKException e) { throw new ...}` | Trigger the SDK exception through the app's own method and verify the wrapper exception type, message, AND cause chain | `assertThat(ex.getCause()).isInstanceOf(SDKException.class)` |
   | 2 | **Resource-not-found via app method** | App reads blobs, DB rows, cache keys that may not exist | Call the app's read method with a non-existent resource; assert on the specific return (null, empty Optional, 404) — not just "no exception" | `assertThat(dao.load(99999, "x")).isNull()` |
   | 3 | **Inconsistent state between stores** | App uses 2+ stores (DB + blob, DB + cache) | Write metadata to one store but NOT the other, then call the app's read method — verify it handles the mismatch (exception, null, graceful fallback) | Insert DB row, don't upload blob -> `dao.load()` should throw/return-null |
   | 4 | **Invalid/null input through app methods** | App has public methods accepting user-provided strings, IDs, names | Pass null, empty string, and boundary-length values through the app's own method; assert specific exception type or error response | `assertThrows(IllegalArgumentException.class, () -> svc.create(null))` |
   | 5 | **Duplicate/conflict operations** | App creates named resources (containers, keys, DB records) | Create a resource, then try to create it again through the app method; verify the specific conflict behavior (exception type, idempotent success, or error code) | `assertThat(ex.getMessage()).contains("already exists")` |
   | 6 | **Delete non-existent resource** | App has delete/remove methods | Call delete on a resource that doesn't exist; verify whether it throws, returns false, or is idempotent — **this often differs between AWS SDK and Azure SDK** | `assertThat(svc.delete("nonexistent")).isFalse()` |
   | 7 | **Operations after close/shutdown** | App has lifecycle methods (close, shutdown, stopService) | Call close(), then attempt a normal operation; verify it throws the expected exception (NPE, IllegalStateException, etc.) | `svc.close(); assertThrows(IllegalStateException.class, () -> svc.read("key"))` |
   | 8 | **Corrupted/invalid data in store** | App deserializes data from external store (JSON from Redis, parsed blob content) | Write corrupted/malformed data directly to the store, then call the app's read method; verify the deserialization error is properly handled | `redis.set("key", "{bad-json}"); assertThrows(RuntimeException.class, () -> mgr.get("key"))` |

   **Self-check:** Count your error test methods. If you have fewer than 3 error tests from the table above, you almost certainly have gaps. Go back and add more.

### Cover downstream consumers

If the migrated code produces output consumed by other components (config generators, report builders), test those consumers too. Verify output is consumable by the next component in the pipeline — write then read back through the real consumer API to confirm round-trip correctness.

### Only label tests as integration tests if they integrate external systems

Tests with no containers, network, or filesystem dependencies are unit tests, which is not within the IT scope. Do not generate them alongside integration tests.

### Stay scoped to the migration target

Only generate tests for code that uses the migrated service. Do not generate unrelated tests for general project utilities.

### DO NOT use any test ordering mechanism — this is an AUTOMATIC QUALITY DEDUCTION

This includes JUnit 5 `@Order` / `@TestMethodOrder`, TestNG `dependsOnMethods` / `priority`, and any other framework-specific ordering. Tests MUST be independent and run in any order. Each test must create its own data and clean up after itself. Test ordering indicates shared mutable state — a critical quality issue. Evaluators specifically check for `@Order` and `@TestMethodOrder` annotations and will deduct points for their presence.

   **Anti-pattern — DO NOT DO THIS:**
   ```java
   // WRONG: @Order creates test interdependence — automatic quality deduction
   @TestMethodOrder(MethodOrderer.OrderAnnotation.class)
   class MyL1Test {
       @Test @Order(1) void testCreate() { ... }
       @Test @Order(2) void testRead() { ... }  // implicitly depends on testCreate
   }
   ```

   **Correct pattern:**
   ```java
   // RIGHT: Each test is self-contained with its own setup
   class MyL1Test {
       @BeforeEach void cleanup() { /* clean all state */ }
       @Test void testCreate() { /* creates its own data */ }
       @Test void testRead() { /* creates its own data, then reads */ }
   }
   ```
### DO NOT use reflection to access or modify private fields, and DO NOT widen field visibility (private->protected/public) in production code for test access.

Both approaches are fragile and tightly couple tests to implementation details. Reflection breaks on Java 17+ with strong encapsulation. Widening visibility pollutes the production API and can cause compilation errors when test classes are in a different package (protected access requires same package or subclass). Instead:
   - For singletons: add a package-private or test-visible constructor/factory method to the production class (minimal safe change).
   - For environment variables: use `@DynamicPropertySource`, `System.setProperty()` with matching application code reads, constructor/setter injection, or `@TestConfiguration` beans.
   - For configuration files: use `@TestPropertySource`, classpath-based overrides in `src/test/resources/`, or `@DynamicPropertySource`.
   - For injecting test dependencies: use constructor injection, setter injection, or `@TestConfiguration` with `@Primary` beans.
   - For inspecting internal state: add a package-private getter method or test the observable behavior (outputs, side effects) instead of reading internal fields.

### DO write specific, descriptive assertions

   ```java
   // WRONG — poor failure message: "expected: true but was: false"
   assertTrue(containers.contains("my-container"));
   assertTrue(ex.getCause() instanceof SomeException);

   // RIGHT — clear failure message showing actual values
   assertThat(containers).contains("my-container");
   assertThat(ex.getCause()).isInstanceOf(SomeException.class);
   assertThat(result.getName()).isEqualTo("expected-name");  // shows both values on failure
   ```

   Regardless of library, always assert on specific values — not just `assertNotNull(result)` or `assertTrue(success)`. Include `assertInstanceOf()` (JUnit 5.8+) instead of `assertTrue(x instanceof Y)` for better error messages.

### DO structure every test with clear Arrange-Act-Assert (AAA) sections
 separated by blank lines. Each test should verify ONE logical behavior. Do not combine multiple unrelated operations in a single test method.

### DO add `@BeforeEach` cleanup when tests share a container

If multiple tests use the same TestContainers instance (e.g., a shared Redis or Azurite container), each test must clean up its state in `@BeforeEach` or `@AfterEach` (e.g., flush Redis, delete all blob containers, truncate database tables). Stale data from one test must never affect another. Without cleanup, test execution order determines results — a critical reliability issue.

### DO verify the test count after `mvn verify` matches expectations

Before committing, run `mvn verify` and confirm the number of tests discovered and executed matches the number of test methods you wrote. If the count is lower, some tests are not being discovered — fix the build configuration.

### DO extract shared test infrastructure into a base class or helper when you have 2+ test classes

If multiple test classes use the same TestContainers setup (e.g., same Azurite/Redis/PostgreSQL container), extract the container declaration, connection string construction, and `@DynamicPropertySource` into a shared abstract base class (e.g., `AbstractAzuriteL1Test` or `AbstractRedisL1Test`). This eliminates duplication and ensures consistent infrastructure configuration. Each test class that needs the container simply extends the base class.

   > For an Azurite-specific shared base class example (`AbstractAzuriteL1Test`), see [azure-storage-testcontainers.md](./azure-storage-testcontainers.md#4-shared-azurite-base-class).

### DO extract commonly repeated test patterns into helper methods

If you find yourself writing the same 3+ lines more than twice (e.g., listing blob names, creating a user and getting the ID, uploading test data), extract it into a descriptive helper method. This improves readability and reduces maintenance burden.

### DO NOT leave `System.out.println` or debug logging statements in test code

Remove all diagnostic print statements (`System.out.println`, `System.err.println`, `e.printStackTrace()`) before committing. If you need to inspect state during development, use proper assertions instead. Debug output clutters test logs, makes failures harder to diagnose, and indicates incomplete cleanup.

### NEVER use `Thread.sleep()` to wait for containers to start

TestContainers' `.start()` already waits for exposed ports to be ready. If you need additional readiness checks, use `.waitingFor(Wait.forListeningPort())` or `.waitingFor(Wait.forLogMessage(...))` on the container definition. `Thread.sleep()` is a flakiness time bomb — too short on slow CI, too long on fast machines.

**Anti-pattern — DO NOT DO THIS:**
```java
// WRONG: Arbitrary sleep after container start
container.start();
Thread.sleep(2000); // flaky — may be too short or too long
```

**Correct pattern:**
```java
// RIGHT: Use TestContainers built-in wait strategy
static final GenericContainer<?> myContainer = new GenericContainer<>("image:latest")
        .withExposedPorts(PORT)
        .waitingFor(Wait.forListeningPort());  // Reliable readiness check
```

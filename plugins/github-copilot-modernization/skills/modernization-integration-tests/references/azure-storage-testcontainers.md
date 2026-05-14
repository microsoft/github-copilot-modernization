# Azure Blob Storage with Azurite TestContainers Coding Reference

## Contents
- 1.Azurite-Specific Self-Checks
- 2.Azurite Container Setup
  + Azurite well-known credentials
- 3.Azurite URL Format Gotcha
- 4.Spring Boot Config Override for Blob Storage
  + ⚠️ CRITICAL: `System.getenv()` vs Spring Properties Mismatch
- 5. Shared Azurite Base Class
- 6. Azure Blob-Specific Test Patterns
  + Testing Application Code (Not the SDK)
  + Asserting on Behavior, Not Structure
  + Error Handling with BlobStorageException

## 1.Azurite-Specific Self-Checks
Before running tests, verify:
- [ ] If any application code reads config via `System.getenv()`, you've provided values through constructor injection or `@TestConfiguration` beans — NOT through `@DynamicPropertySource` (which only sets Spring properties)
- [ ] If the application parses URLs to extract container names, you've handled the Azurite URL format difference (see section 2)
- [ ] No test uses `DefaultAzureCredentialBuilder` — use `StorageSharedKeyCredential` with Azurite dev credentials
- [ ] No test checks for `blob.core.windows.net` in URLs — Azurite URLs use `localhost`
- [ ] `@ActiveProfiles("test")` is on every `@SpringBootTest` class (if using Spring Boot)
- [ ] `@BeforeEach` cleanup deletes all blob containers to prevent cross-test contamination

## 2.Azurite Container Setup
```java
new GenericContainer<>("mcr.microsoft.com/azure-storage/azurite:latest")
    .withExposedPorts(10000)
    .withCommand("azurite-blob", "--blobHost", "0.0.0.0")
    .waitingFor(Wait.forListeningPort());  // REQUIRED — prevents race conditions
```

### Azurite well-known credentials (safe for local testing only)
- Account name: `devstoreaccount1`
- Account key: `Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==`

## 3.Azurite URL Format Gotcha
**IMPORTANT — Azurite URL format differs from production Azure Blob Storage:**

- **Production Azure:** `https://<account>.blob.core.windows.net/<container>/<blob>`
- **Azurite:** `http://<host>:<port>/devstoreaccount1/<container>/<blob>`

If the application code parses Azure Blob Storage URLs (e.g., extracting container name from the URL path), the Azurite URL will have an extra `/devstoreaccount1/` path segment that production URLs don't have. This causes:
- Container name extracted as `devstoreaccount1` instead of the actual container name
- URL-based detection logic (e.g., checking for `blob.core.windows.net`) failing for Azurite URLs
- Path indices being off-by-one when splitting URLs into segments

**How to handle this — choose the approach that requires the LEAST production code change:**

1. **Best approach — Inject the container name and BlobServiceClient separately** instead of having the application parse them from a URL:
   ```java
   // Add a test-friendly constructor that accepts pre-built client + container name
   // Minimal source change: 3-4 lines
   S3FileSystemStore(String rootPath, BlobServiceClient client, String containerName) {
       this.blobServiceClient = client;
       this.containerName = containerName;
       this.rootPath = rootPath;
   }
   ```

2. **If the application detects Azure by checking for `blob.core.windows.net`** in the URL (common pattern), provide an override mechanism so tests can force Azure mode:
   ```java
   // Add a boolean flag or config property to bypass URL detection
   S3FileSystemStore(String rootPath, FileSystem fs, BlobServiceClient client, boolean isAzure) {
       this.blobServiceClient = client;
       this.isAzureMode = isAzure;  // skip blob.core.windows.net check
   }
   ```
3. **If the application splits the URL path to extract container names**, the path indices will be different for Azurite vs Azure:
   - Azure URL path: `/<container>/<blob>` -> `pathParts[1]` = container name
   - Azurite URL path: `/devstoreaccount1/<container>/<blob>` -> `pathParts[1]` = `devstoreaccount1`, `pathParts[2]` = container name

   **Never assume Azurite URLs have the same path structure as production Azure URLs.** Instead, pass the container name as a parameter to avoid URL parsing entirely.

**Self-check:** Before running tests, ask "Does any application code parse URLs to extract container names or detect Azure mode?" If yes, you MUST handle the Azurite URL format difference or 60%+ of tests will fail at runtime.

## 4.Spring Boot Config Override for Blob Storage

Production code often uses `DefaultAzureCredentialBuilder` which requires HTTPS and real Azure endpoints. Tests use local Azurite over HTTP with well-known keys. You **MUST** override the production bean configuration so the test context starts successfully.

**Step 1 — ALWAYS add `@ActiveProfiles("test")` to every `@SpringBootTest` class:**
```java
@SpringBootTest
@ActiveProfiles("test")  // MANDATORY — prevents production @Profile("!test") beans from loading
@Testcontainers
class MyServiceL1Test { ... }
```
Without `@ActiveProfiles("test")`, production configuration classes (DataSource configs, credential builders, startup initializers) will load and fail because they try to connect to real services. This is the **#1 cause of Spring context startup failures** in integration tests.

**Step 2 — use `@TestConfiguration` with `@Primary` to override production beans:**

```java
@TestConfiguration
public class TestBlobStorageConfig {
    // Override the production BlobServiceClient that uses DefaultAzureCredential
    @Bean
    @Primary
    public BlobServiceClient blobServiceClient(
            @Value("${azure.storage.endpoint}") String endpoint) {
        // Azurite well-known credentials — safe for local testing only
        StorageSharedKeyCredential credential = new StorageSharedKeyCredential(
                "devstoreaccount1",
                "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==");
        return new BlobServiceClientBuilder()
                .endpoint(endpoint)
                .credential(credential)
                .buildClient();
    }
}
```

**Step 3 — narrow the Spring context when full context is too heavy:**
If `@SpringBootTest` loads too many unrelated beans (startup initializers, schedulers, external integrations) that fail during context startup, use context slicing:
```java
@SpringBootTest(classes = {MyService.class, TestBlobStorageConfig.class})
```
This loads only the beans you need for testing, avoiding failures from unrelated components.

### ⚠️ CRITICAL: `System.getenv()` vs Spring Properties Mismatch

**`@DynamicPropertySource` sets Spring properties — it does NOT set environment variables.** If the application's DAO/service reads configuration via `System.getenv("AZURE_STORAGE_ENDPOINT")`, setting `registry.add("AZURE_STORAGE_ENDPOINT", ...)` in `@DynamicPropertySource` will NOT work. The DAO will receive `null` and fail with `NullPointerException` before any test runs.

**How to detect this:** Before writing any test, `grep -r "System.getenv\|System.getProperty" src/main/` to find all environment variable reads in the application code. If you find any, you MUST use one of the approaches below.

**Fix — choose the approach that requires the LEAST production code change:**

1. **Best approach — Add a constructor that accepts the dependencies directly** (minimal safe source change, 3-5 lines):
   ```java
   // Add to the production DAO class:
   AzureBlobDigitalMediaDAO(BlobServiceClient client, String containerName) {
       this.blobServiceClient = client;
       this.containerName = containerName;
   }
   ```
   Then in the test, provide the client via `@TestConfiguration` with `@Primary`:
   ```java
   @TestConfiguration
   static class TestConfig {
       @Bean @Primary
       public AzureBlobDigitalMediaDAO testDao() {
           return new AzureBlobDigitalMediaDAO(blobServiceClient, CONTAINER_NAME);
       }
   }
   ```

2. **Alternative — Use `@TestConfiguration` `@Primary` bean + `@ConditionalOnMissingBean`** on the production config class so the test bean takes precedence.

3. **Last resort — Set actual environment variables via `System.setProperty()` paired with changing production code from `System.getenv()` to `System.getProperty()`** (slightly larger source change but avoids constructor changes).

**Anti-pattern — DO NOT DO THIS:**
```java
// WRONG: @DynamicPropertySource does NOT populate System.getenv()
@DynamicPropertySource
static void props(DynamicPropertyRegistry registry) {
    registry.add("AZURE_STORAGE_ENDPOINT", () -> azuriteEndpoint);  // ❌ DAO calls System.getenv(), not Spring
}
```

**Self-check:** For every `System.getenv()` call in the production code, verify your test provides the value through a mechanism the production code actually reads. `@DynamicPropertySource` only works for code that reads from Spring's `Environment` (e.g., `@Value`, `@ConfigurationProperties`).

**Key rules:**
- ALWAYS add `@ActiveProfiles("test")` to every `@SpringBootTest` test class — this is the most common mistake.
- NEVER use `DefaultAzureCredentialBuilder` in tests — it will fail on HTTP endpoints and in CI.
- ALWAYS use `StorageSharedKeyCredential` with Azurite's well-known dev credentials for Blob Storage tests.
- Provide test properties via `@DynamicPropertySource` from the TestContainers container (e.g., `azuriteContainer.getHost()` + `azuriteContainer.getMappedPort(10000)`).
- If the full `@SpringBootTest` context fails to start, narrow it with `classes = {...}` rather than trying to mock/stub all failing beans.

## 5.Shared Azurite Base Class

When you have 2+ test classes using Azurite, extract the container declaration and client construction into a shared abstract base class:

```java
// Shared base class — declared once, reused by all test classes
@Testcontainers
abstract class AbstractAzuriteL1Test {
    @Container
    static final GenericContainer<?> azurite = new GenericContainer<>(
            "mcr.microsoft.com/azure-storage/azurite:latest")
            .withExposedPorts(10000)
            .withCommand("azurite-blob", "--blobHost", "0.0.0.0");

    protected static BlobServiceClient blobServiceClient;

    @BeforeAll
    static void initClient() {
        String endpoint = String.format("http://%s:%d/devstoreaccount1",
                azurite.getHost(), azurite.getMappedPort(10000));
        blobServiceClient = new BlobServiceClientBuilder()
                .connectionString(getAzuriteConnectionString())
                .buildClient();
    }
}

// Each test class extends the base — no duplicated container setup
@Tag("Layer1")
class EventHandlerL1Test extends AbstractAzuriteL1Test { ... }
class S3ClientUtilL1Test extends AbstractAzuriteL1Test { ... }
```

## 6.Azure Blob-Specific Test Patterns

### Testing Application Code (Not the SDK)

**Anti-pattern — DO NOT DO THIS:**
```java
// WRONG: Test calls Azure SDK directly instead of the application's CreateBucket class
@Test void testCreateBucketClass() {
    // This tests the Azure SDK, NOT the application code
    blobServiceClient.createBlobContainer("test-container");
    assertTrue(blobServiceClient.getBlobContainerClient("test-container").exists());
}
```

**Anti-pattern — DO NOT DO THIS either:**
```java
// WRONG: Tests individual Azure Blob operations instead of the application's handler
@Test void testUploadBlob() {
    BlobContainerClient container = blobServiceClient.getBlobContainerClient("test");
    container.create();
    container.getBlobClient("file.txt").upload(BinaryData.fromString("data"), true);
    String content = container.getBlobClient("file.txt").downloadContent().toString();
    assertEquals("data", content);
    // This verifies Azure SDK works — it does NOT test the application's EventHandler
}
```

**Correct pattern — invoke the application's own entry points:**
```java
// RIGHT: Test calls the application's own handler method end-to-end
@Test void testHandleRequestProcessesEventsEndToEnd() {
    // Arrange — pre-populate Azurite with test event data
    uploadTestEvent("container1", "event1.txt", "status:SHIPPED\ntimestamp:1573410202");

    // Act — invoke the APPLICATION's handler, not the SDK
    EventHandler handler = new EventHandler(blobServiceClient);
    handler.handleRequest(mockContext);

    // Assert — verify the application produced the expected output
    String summary = downloadBlob("summary-container", "summary.txt");
    assertThat(summary).contains("SHIPPED");
}
```

### Asserting on Behavior, Not Structure

**Every write test must read the data back and verify content.** If you write a blob to Azurite, download it and assert the content matches — do NOT just assert that the container exists (which is always true if you created it in `@BeforeEach`). A test whose only assertion is `assertTrue(container.exists())` or `assertNotNull(result)` is effectively testing nothing.

### Error Handling with BlobStorageException

```java
// RIGHT: Test error handling through the application class
@Test void testCreateBucketWithInvalidName() {
    RuntimeException ex = assertThrows(RuntimeException.class,
        () -> createBucket.createBucketAsync("INVALID-UPPERCASE"));
    assertThat(ex.getMessage()).contains("Failed to create bucket");
    assertThat(ex.getCause()).isInstanceOf(BlobStorageException.class);
}
```

For each `catch (BlobStorageException e)` block in the migrated code, write a corresponding test:
```java
// If the source code has:
try {
    blobClient.upload(data, true);
} catch (BlobStorageException e) {
    throw new RuntimeException("Failed to create bucket", e);
}

// Then you MUST have this test:
@Test void testCreateBucketWrapsStorageException() {
    RuntimeException ex = assertThrows(RuntimeException.class,
        () -> createBucket.createBucketAsync("INVALID"));
    assertThat(ex.getMessage()).contains("Failed to create bucket");
    assertThat(ex.getCause()).isInstanceOf(BlobStorageException.class);
}
```

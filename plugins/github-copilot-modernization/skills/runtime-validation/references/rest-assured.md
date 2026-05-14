# REST Assured / TestRestTemplate E2E Testing

Use when the migrated app is API-driven with no meaningful browser UI, or for the API layer of a mixed app.

## Tool Choice (for tester role)

The tester writes real-user-flow tests — real HTTP requests against a real running app with a real database.

- **TestRestTemplate** — real embedded Tomcat, real HTTP requests. Handles cookies, sessions, redirects naturally. The tester's primary tool for Spring apps. Use with Testcontainers for real DB.
- **REST Assured** — richer assertion DSL, better for complex JSON validation. Use when the project already depends on it, or when you need advanced matching.

Note: MockMvc tests Spring internals (view names, model attributes, security filters) — that's the dev role's responsibility during implementation, not the tester's.

Both TestRestTemplate and REST Assured work with `@SpringBootTest(webEnvironment = RANDOM_PORT)`.

## Environment Prerequisites

- Java 17+ and Maven/Gradle installed
- Target app can start (all env vars / connection strings configured)
- If using Testcontainers: Docker running

```bash
# Verify Java
java -version

# Verify Maven
mvn -version
```

## Option A: TestRestTemplate (built-in)

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MigrationE2ETest {

    @Autowired
    TestRestTemplate restTemplate;

    @Test
    void happyPath_shouldReturnSuccess() {
        var response = restTemplate.postForEntity(
            "/api/orders",
            new OrderRequest("item-1", 5),
            OrderResponse.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().getStatus()).isEqualTo("CREATED");

        // Verify persistence
        var fetched = restTemplate.getForEntity(
            "/api/orders/" + response.getBody().getId(),
            OrderResponse.class
        );
        assertThat(fetched.getBody().getQuantity()).isEqualTo(5);
    }

    @Test
    void authFailure_shouldReturn401() {
        var headers = new HttpHeaders();
        headers.set("Authorization", "Bearer invalid-token");
        var entity = new HttpEntity<>(null, headers);

        var response = restTemplate.exchange(
            "/api/orders", HttpMethod.GET, entity, String.class
        );
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
```

## Option B: REST Assured

```xml
<dependency>
    <groupId>io.rest-assured</groupId>
    <artifactId>rest-assured</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
```

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MigrationE2ETest {

    @LocalServerPort
    int port;

    @BeforeEach
    void setUp() {
        RestAssured.port = port;
    }

    @Test
    void happyPath_shouldReturnSuccess() {
        given()
            .contentType(ContentType.JSON)
            .body("{\"item\": \"item-1\", \"quantity\": 5}")
        .when()
            .post("/api/orders")
        .then()
            .statusCode(200)
            .body("status", equalTo("CREATED"));
    }
}
```

## With Testcontainers (real database)

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class FullStackE2ETest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
        .withDatabaseName("testdb");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    TestRestTemplate restTemplate;

    @Test
    void fullFlow_createAndRetrieve() {
        // Create
        var createResponse = restTemplate.postForEntity(
            "/api/items",
            new ItemRequest("Widget", 100),
            ItemResponse.class
        );
        assertThat(createResponse.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        // Retrieve and verify persistence
        var id = createResponse.getBody().getId();
        var getResponse = restTemplate.getForEntity("/api/items/" + id, ItemResponse.class);
        assertThat(getResponse.getBody().getName()).isEqualTo("Widget");
        assertThat(getResponse.getBody().getQuantity()).isEqualTo(100);
    }
}
```

## Run & Collect Evidence

```bash
mvn test -Dtest="*E2ETest"           # run e2e tests only
mvn test -pl <module>                 # specific module
# Evidence: target/surefire-reports/*.xml
```

Exit code + surefire XML are the verdict evidence.

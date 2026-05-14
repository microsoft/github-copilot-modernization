# Testcontainers E2E Testing

Use for message-driven or infrastructure-heavy migrations where real containers are needed.

## Environment Prerequisites

- Java 17+ and Maven/Gradle installed
- **Docker running** (required — Testcontainers starts real containers)
- Docker Desktop or Docker Engine with sufficient memory (2GB+ recommended)

```bash
# Verify Docker is running
docker info

# Verify Java
java -version
```

CI environments (GitHub Actions, Azure DevOps) typically have Docker pre-installed.
For local dev: Docker Desktop must be running before tests start.

```xml
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>testcontainers</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>junit-jupiter</artifactId>
    <scope>test</scope>
</dependency>
<!-- add specific modules: kafka, postgresql, mssqlserver, etc. -->
```

## Write Tests

```java
@SpringBootTest
@Testcontainers
class MessagingE2ETest {

    @Container
    static KafkaContainer kafka = new KafkaContainer(
        DockerImageName.parse("confluentinc/cp-kafka:7.4.0")
    );

    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.kafka.bootstrap-servers", kafka::getBootstrapServers);
    }

    @Test
    void messageShouldBeConsumed() throws Exception {
        // send → wait → assert side effect
    }
}
```

## Common Containers

| Dependency | Container |
|---|---|
| PostgreSQL | `PostgreSQLContainer` |
| SQL Server | `MSSQLServerContainer` |
| Kafka | `KafkaContainer` |
| Azure Blob (emulator) | `GenericContainer("mcr.microsoft.com/azure-storage/azurite")` |

## Run & Collect Evidence

```bash
mvn test -Dtest="*E2ETest"
# Requires Docker running locally or in CI
# Evidence: target/surefire-reports/*.xml + container logs
```

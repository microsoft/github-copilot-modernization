# Layer 4: Behavioral Comparison

**Goal:** "Does it match the original?"

Run old and new versions side-by-side and compare outputs for identical inputs.

## Test Isolation

- **DO use `L4Test` as the class name suffix** for all Layer 4 behavioral comparison test classes (e.g., `OrderApiL4Test`, `UserServiceL4Test`). The `*Test` suffix matches Maven Surefire's default discovery pattern — no build plugin changes needed.
- **DO annotate every test class with a `Layer4` tag/category** so runner scripts filter precisely and never trigger Layer 1, 2, or 3 tests. See the Test Isolation Convention in the main skill file for the exact annotation per language/framework.
- The runner script **MUST filter by the `Layer4` tag** (e.g., `mvn verify -Dgroups=Layer4`, `dotnet test --filter Category=Layer4`, `pytest -m layer4`)

## Prerequisites

- Access to both original and migrated application code
- Ability to run both versions simultaneously
- Test data/scenarios from production or comprehensive test suite

## Workflow

### 1. Set Up Side-by-Side Environment

```
┌─────────────────┐     ┌─────────────────┐
│  Original App   │     │  Migrated App   │
│  (Port 8080)    │     │  (Port 8081)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────┴──────┐
              │  Comparator │
              │    Tests    │
              └─────────────┘
```

#### Docker Compose Setup

```yaml
version: '3.8'
services:
  original-app:
    build:
      context: ./original
    ports:
      - "8080:80"
    environment:
      - ConnectionStrings__Default=${DB_CONNECTION}

  migrated-app:
    build:
      context: ./migrated
    ports:
      - "8081:80"
    environment:
      - ConnectionStrings__Default=${DB_CONNECTION}

  # Shared database for consistent state
  database:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      - ACCEPT_EULA=Y
      - SA_PASSWORD=YourStrong!Passw0rd
```

### 2. Define Comparison Test Cases

Identify all testable behaviors:

| Category | Test Inputs | Comparison Points |
|----------|-------------|-------------------|
| API responses | Same HTTP requests | Status code, response body, headers |
| Data operations | Same CRUD operations | Database state, return values |
| Business logic | Same input parameters | Calculation results, decisions |
| Error handling | Invalid inputs | Error codes, messages |
| Edge cases | Boundary values | Behavior consistency |

### 3. Create Comparison Test Framework

```csharp
public class BehaviorComparisonTests
{
    private readonly HttpClient _originalClient;
    private readonly HttpClient _migratedClient;

    public BehaviorComparisonTests()
    {
        _originalClient = new HttpClient { BaseAddress = new Uri("http://localhost:8080") };
        _migratedClient = new HttpClient { BaseAddress = new Uri("http://localhost:8081") };
    }

    [Theory]
    [MemberData(nameof(GetTestCases))]
    public async Task ResponsesMatch(TestCase testCase)
    {
        // Execute same request against both
        var originalResponse = await ExecuteRequest(_originalClient, testCase);
        var migratedResponse = await ExecuteRequest(_migratedClient, testCase);

        // Compare responses
        var comparison = CompareResponses(originalResponse, migratedResponse);

        comparison.IsMatch.Should().BeTrue(
            $"Mismatch in {testCase.Name}:\n{comparison.Differences}");
    }

    private ComparisonResult CompareResponses(Response original, Response migrated)
    {
        var differences = new List<string>();

        // Compare status codes
        if (original.StatusCode != migrated.StatusCode)
            differences.Add($"Status: {original.StatusCode} vs {migrated.StatusCode}");

        // Compare response bodies (with normalization)
        var normalizedOriginal = NormalizeResponse(original.Body);
        var normalizedMigrated = NormalizeResponse(migrated.Body);

        if (!JsonEquals(normalizedOriginal, normalizedMigrated))
            differences.Add($"Body differs:\nOriginal: {normalizedOriginal}\nMigrated: {normalizedMigrated}");

        return new ComparisonResult
        {
            IsMatch = differences.Count == 0,
            Differences = string.Join("\n", differences)
        };
    }

    private string NormalizeResponse(string json)
    {
        // Remove fields that are expected to differ
        var obj = JsonSerializer.Deserialize<JsonElement>(json);
        return RemoveIgnoredFields(obj, new[] { "timestamp", "requestId", "version" });
    }
}
```

### 4. Handle Expected Differences

Some differences are expected and should be ignored:

| Field Type | Example | Handling |
|-----------|---------|----------|
| Timestamps | `createdAt`, `updatedAt` | Ignore or compare format only |
| IDs | `requestId`, `correlationId` | Ignore |
| Version info | `apiVersion`, `buildNumber` | Ignore |
| Order | Array element order | Sort before compare |
| Precision | Float/decimal precision | Round to acceptable precision |

```csharp
public class ResponseNormalizer
{
    private readonly HashSet<string> _ignoredFields = new()
    {
        "timestamp", "createdAt", "updatedAt",
        "requestId", "correlationId", "traceId",
        "version", "buildNumber"
    };

    public JsonElement Normalize(JsonElement element)
    {
        // Remove ignored fields
        // Sort arrays
        // Normalize number precision
        // etc.
    }
}
```

### 5. Generate Comparison Report

```markdown
# Behavioral Comparison Report

## Summary
- Total test cases: 150
- Matching: 147 (98%)
- Differences: 3 (2%)

## Differences Found

### Case: GET /api/orders/123
| Field | Original | Migrated |
|-------|----------|----------|
| `items[0].price` | 19.99 | 19.990000 |

**Analysis:** Floating point precision difference, acceptable.

### Case: POST /api/users (duplicate email)
| Aspect | Original | Migrated |
|--------|----------|----------|
| Status | 400 | 409 |
| Message | "Email exists" | "Duplicate email" |

**Analysis:** Different but semantically equivalent error handling.

## Recommendations
1. Accept precision differences as expected
2. Review error message changes with stakeholders
3. All critical business logic matches ✓
```

### 6. Run Comparison Suite

```bash
# Start both applications
docker-compose up -d

# Wait for both to be healthy
./wait-for-healthy.sh http://localhost:8080/health
./wait-for-healthy.sh http://localhost:8081/health

# Run Layer 4 comparison tests only (filter by Layer4 tag)
dotnet test --filter Category=Layer4

# Generate report
dotnet test --logger "html;LogFileName=comparison-report.html"

# Cleanup
docker-compose down
```

## Handling Database State

For stateful comparisons, ensure both applications start with identical data:

```bash
# Reset database before each test
docker-compose exec database /opt/mssql-tools/bin/sqlcmd \
    -S localhost -U sa -P 'YourStrong!Passw0rd' \
    -i /scripts/reset-test-data.sql
```

## Pass Criteria

- All API responses match (after normalization)
- Database state changes are identical
- Business logic produces same results
- Error handling is semantically equivalent
- Performance is comparable (within 20% variance)
- No regressions in functionality
- Runner scripts generated per the Standardized Runner Scripts convention in the main skill file

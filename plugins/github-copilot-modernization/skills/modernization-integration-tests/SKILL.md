---
name: modernization-integration-tests
description: |
  Run multi-layer integration tests for modernized Java applications. Supports 4 layers -
  Layer 1 (TestContainers), Layer 2 (Smoke Tests), Layer 3 (Azure Integration),
  Layer 4 (Behavioral Comparison). Java projects only - skip if source code is not Java.
  Triggers: "generate integration tests", "add integration tests", "create Layer 1 tests", "create Layer 2 tests"
  NOT for: unit tests, performance tests, load tests.
argument-hint: Generate Layer [1|2|3|4] tests for this project
user-invocable: true
disable-model-invocation: false
---

# Integration Tests for Modernized Java Applications

## Language Support

**This skill supports Java projects only.** If the source code is not Java (e.g., .NET, Python, Node.js), skip test generation and report that integration tests are not supported for this language.

## User Input
- **layer** (Optional): Which layer to test (1, 2, 3, or 4). Default: 1
- **azure-config** (Optional, Layer 3 only): Azure environment configuration
- **modernization-work-folder** (Optional): Directory path for generating plan and summary files. Default: `.github/integration-tests`
- **test-root** (Optional): The root directory for integration tests. Default: current working directory. All application modules found in the directory are included in integration tests.

## Available references

### Layer 1: Local Integration Tests
**Read references/layer1-local-integration.md first**, then create TestContainers-based integration test classes.

### Layer 2: Smoke Tests
**Read references/layer2-smoke-tests.md first.** Layer 2 uses shell-based smoke tests with docker-compose, NOT JUnit test classes. Follow the exact multi-commit workflow (artifacts → auth → restore) documented in the reference file.

### Layer 3: Azure Integration Tests
**Read references/layer3-azure-integration.md first**, then create integration test classes that connect to real Azure services.

### Layer 4: Behavioral Comparison
**Read references/layer4-behavioral-comparison.md first**, then create comparison tests that validate behavior matches between old and new implementations.

### TestContainers Coding References
- **Azure Service Bus with TestContainers Coding Reference**, see references/azure-servicebus-testcontainers.md
- **Azure Storage with TestContainers Coding Reference**, see references/azure-storage-testcontainers.md

## Workflow

1. Analyze the project to identify modules that need to be tested and any existing integration tests. If git history is available, analyze past commits to understand which components were modified during modernization and prioritize testing those areas.
2. Create an integration test plan file at `{modernization-work-folder}/integration-test-plan.md` that outlines:
  - Testing strategy and approach for the detected app modules
  - Testing strategy and approach for each layer
  - Identified components requiring integration testing
  - Dependencies and test setup requirements
  - Expected test scenarios and validation criteria
3. Implement new integration tests following the principles outlined below
4. Execute the tests
5. If issues found:
  - Analyze failures using the Test vs Source Code Decision Framework to determine whether to fix test code or source code
  - Fix source code if the failure indicates a real problem in the application logic.
  - Fix test code if the failure is due to unrealistic test scenarios, incorrect test setup.
  - Execute tests again after fixes
6. **Only proceed when all tests run and pass**, or exit after 20 attempts
7. Create an integration test summary file at `{modernization-work-folder}/integration-test-summary.md` that documents:
  - All integration tests added (with file paths and descriptions)
  - Test coverage improvements achieved
  - Final test execution results
8. Commit all code changes with brief and meaningful commit messages

## Integration Tests Writing Principles

**CRITICAL - Read Reference Docs First:**
- **Before starting ANY layer**, read the corresponding reference file in references/ directory

Analyze the project if integration tests have covered all components, if not **DO ADD** new integration tests by the following principles:

- **Purpose:** Ensures combined components function as a whole, focusing on "in-between" logic rather than individual module functionality.
- **DO use** top-down approach to add integration tests. For example, if an application has controller layer, service layer, and database layer. The integration tests should set up real connections to the database, and then test against the controller layer, to validate all functionalities.
- **DO focus on:** Validates interactions between modules, databases, messaging services, and file systems.
- **DO NOT** change the technical stack, architure selection, libary using in the source code. The goal is to validate the existing application code, not change it to pass tests.
- **DO fix issues** in the appropriate place (test or source code) based on the analysis.
- **DO write** comprehensive integration covering **ALL** components.
- **DO test through the application's own classes.** Every test must instantiate and invoke the project's own classes/methods. Never call third-party SDK APIs directly as a substitute for testing application code. Tests that only exercise Azure/Redis/PostgreSQL SDK operations without going through the application's handler/service/manager classes will score very low on functional coverage.
- **DO use** the layer-specific class name suffix from the Test Isolation Convention (e.g., `L1Test` for Layer 1, `L3Test` for Layer 3, `L4Test` for Layer 4). **Layer 2 does not use test classes.**
- **DO annotate** every test class with the layer-specific tag/category from the Test Isolation Convention.
- **DO verify** that `mvn verify` (or equivalent build command) discovers and runs all tests without extra flags. If tests require `-Dtest=...` to be found, the build configuration is wrong.
- **DO NOT** leave commented-out tests or dead test code. Every `@Test` annotation must be on a working test method.
- **DO NOT** add extra modules for integration tests, write integration tests in the existing modules.
- **DO commit** changes separately for each layer with meaningful commit messages. Do not combine changes from different layers into a single commit.
    - **Layer 1, 3, 4**: Single commit per layer (e.g., `Add Layer 1 local integration tests`). Generate runner scripts and include them in the same commit.
    - **Layer 2**: Multi-commit sequence as defined in references/layer2-smoke-tests.md (artifacts → auth → restore). **CRITICAL: Layer 2 does NOT create test classes - it uses shell-based smoke tests with docker-compose.** Runner scripts are part of the artifacts commit.


### Test Isolation Convention

When multiple layers coexist in the same project, tests must be distinguishable. **Every layer MUST use a distinct class name suffix AND tag/category** so tests from different layers never interfere with each other.

#### Naming Convention

| Layer | Class Name Suffix | Example Class Name |
|-------|-------------------|--------------------|
| 1 | `L1Test` | `BlobStorageL1Test`, `OrderServiceL1Test` |
| 2 | N/A - No test classes | Layer 2 uses shell-based smoke tests, not test classes. See references/layer2-smoke-tests.md |
| 3 | `L3Test` | `AzureSqlL3Test`, `BlobStorageL3Test` |
| 4 | `L4Test` | `OrderApiL4Test`, `UserServiceL4Test` |

#### Tagging / Category Convention

Test classes for Layers 1, 3, 4 **MUST** be annotated with a layer-specific tag so the runner script can filter precisely. **Layer 2 does not use test classes** (see references/layer2-smoke-tests.md).

| Layer | JUnit 5 | JUnit 4 |
|-------|---------|---------|
| 1 | `@Tag("Layer1")` | `@Category(Layer1.class)` |
| 2 | N/A - Shell-based | N/A - Shell-based |
| 3 | `@Tag("Layer3")` | `@Category(Layer3.class)` |
| 4 | `@Tag("Layer4")` | `@Category(Layer4.class)` |

> **Rule**: Never rely solely on class name patterns for filtering. Always use tags/categories as the primary filter mechanism.

### NEVER Mock the Migrated Service

**This is the most important rule in this entire skill — it applies to ALL layers.**

Integration tests MUST use real TestContainers for layer 1 and 2 and real cloud services for Layer 3 for every migrated dependency. Do NOT mock or `@MockBean` the SDK client that the migrated code uses (e.g., `ServiceBusTemplate`, `ServiceBusSenderClient`, `BlobServiceClient`, `RedisTemplate`, `DataSource`). Instead, spin up a real container and wire the application's own service to it.

#### The Anti-Pattern You MUST Avoid

```java
// ❌ WRONG — mocks the migrated service and SDK clients, tests unchanged code instead
@SpringBootTest
@ActiveProfiles("test")
class MyAppL1Test {
    @MockBean private MessageService messageService;  // THE MIGRATED CLASS — never tested!
    @MockBean private ServiceBusSenderClient senderClient;  // should be from real emulator
    @MockBean private TokenCredential tokenCredential;  // should be from emulator config
    @Autowired private UserRepository userRepo;  // unchanged code

    @Test void testUserCrud() {
        userRepo.save(new User("test"));  // tests unchanged code, NOT the migration
    }
}
```

```java
// ✅ RIGHT — uses real Service Bus emulator, ALL beans wired from containers, tests through migrated service
@SpringBootTest
@ActiveProfiles("test")
@Testcontainers
class MyAppL1Test {
    @Container static final GenericContainer<?> SERVICE_BUS = ...;  // real emulator
    // No @MockBean at all — all beans come from containers + @DynamicPropertySource
    @Autowired private MessageService messageService;  // THE MIGRATED CLASS — tested for real!

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.cloud.azure.servicebus.connection-string", () -> getConnectionString());
        // ... other container-derived properties
    }

    @Test void testSendMessage() {
        messageService.sendMessage("queue", "Hello");  // exercises the actual migrated code
    }
}
```

## Handling Test Failures

When integration tests fail during execution, use this framework to determine whether to fix the test code or the source code:

### Fix Source Code When:

**Business Logic Violations**
- Error indicates source code violates business rules (e.g., negative inventory allowed)
- Multiple similar tests fail with same pattern
**Specification Compliance**
- Source code doesn't implement required functionality properly
- Error messages show missing or incorrect behavior
**Cross-Component Integration Issues**
- Test setup is correct and realistic
- Source code fails to properly communicate between modules
- Data transformation or mapping errors between layers
**Resource Management Problems**
- Test uses proper connection/resource patterns
- Source code has leaks, deadlocks, or improper disposal
- Timing issues in source code (not test race conditions)

### Fix Test Code When:

**Test Implementation Issues**
- Unrealistic test data or scenarios
- Incorrect test setup (wrong mocks, invalid configurations)
- Testing implementation details rather than behavior
- Race conditions or timing issues in test logic
**Environmental Problems**
- Wrong container configurations or versions
- Test dependencies not properly isolated
- Hard-coded values that should be configurable
- Test cleanup issues affecting subsequent tests
**Test Design Flaws**
- Tests making too many assumptions about internal state
- Over-mocking leading to false confidence
- Testing edge cases that don't reflect real usage
- Assertions on wrong data or wrong timing

### Analysis Steps:

1. **Review Test Quality**: Does the test follow established patterns and realistic scenarios?
2. **Check Business Logic**: Does the failure indicate business rule violations in source code?
3. **Verify Setup**: Are test dependencies and configurations realistic and correct?
4. **Assess Error Type**: Is it a logic error, integration error, or test infrastructure issue?
5. **Consider Impact**: Would fixing source code improve real application behavior?

### Decision Process:

```
Test Failure
    │
    ├─ Does test model realistic business scenario?
    │   ├─ No → Fix Test Code
    │   └─ Yes ↓
    │
    ├─ Does source code violate business rules?
    │   ├─ Yes → Fix Source Code
    │   └─ No ↓
    │
    ├─ Is test setup and environment correct?
    │   ├─ No → Fix Test Code
    │   └─ Yes ↓
    │
    └─ Does error show integration/logic problem?
        ├─ Yes → Fix Source Code
        └─ No → Fix Test Code
```

## Standardized Runner Scripts

After all tests are written, executed, and fixed to pass, generate a fixed runner script so users can re-run integration tests with a single command regardless of project type.

| Layer | Script Path | Command (Unix) | Command (Windows) |
|-------|-------------|----------------|--------------------||
| 1 | `{modernization-work-folder}/integration-tests/run-layer1-tests.sh` / `.ps1` | `bash {modernization-work-folder}/integration-tests/run-layer1-tests.sh` | `powershell {modernization-work-folder}/integration-tests/run-layer1-tests.ps1` |
| 2 | `{modernization-work-folder}/integration-tests/run-layer2-tests.sh` / `.ps1` | `bash {modernization-work-folder}/integration-tests/run-layer2-tests.sh` | `powershell {modernization-work-folder}/integration-tests/run-layer2-tests.ps1` |
| 3 | `{modernization-work-folder}/integration-tests/run-layer3-tests.sh` / `.ps1` | `bash {modernization-work-folder}/integration-tests/run-layer3-tests.sh` | `powershell {modernization-work-folder}/integration-tests/run-layer3-tests.ps1` |
| 4 | `{modernization-work-folder}/integration-tests/run-layer4-tests.sh` / `.ps1` | `bash {modernization-work-folder}/integration-tests/run-layer4-tests.sh` | `powershell {modernization-work-folder}/integration-tests/run-layer4-tests.ps1` |

### Runner Script Requirements

1. **Always generate both `.sh` and `.ps1` variants** for cross-platform support.
2. The script **MUST** encapsulate all project-specific details (build tool, test runner, filters, working directory, container setup/teardown).
3. The script **MUST** be self-contained — users should not need to know the build system or test framework to run it.
4. The script **MUST** exit with code 0 on success and non-zero on failure.
5. The script **MUST** print a human-readable result summary at the end:
   - **On success**: `✅ Layer 1 integration tests PASSED`
   - **On failure**: `❌ Layer 1 integration tests FAILED`
   - The test runner's own console output already includes detailed counts, failure logs, assertion messages, and stack traces — the script only needs a clear pass/fail signal at the end.
6. For Layer 1, the script **MUST** verify Docker is running before starting tests.
7. For Layer 2, the script **MUST** handle starting and stopping the application.
8. For Layer 3, the script **SHOULD** accept Azure configuration via environment variables.
9. For Layer 4, the script **MUST** handle starting both old and new application versions.

### Runner Script Filtering

**Layers 1, 3, 4** use tag/category filters to execute test classes. **Layer 2 uses shell commands** (see references/layer2-runner-script-templates.md).

| Layer | Maven | Gradle |
|-------|-------|--------|
| 1 | `mvn verify -Dgroups=Layer1` | `./gradlew test -Dgroups=Layer1` |
| 2 | Shell-based smoke tests | Shell-based smoke tests |
| 3 | `mvn verify -Dgroups=Layer3` | `./gradlew test -Dgroups=Layer3` |
| 4 | `mvn verify -Dgroups=Layer4` | `./gradlew test -Dgroups=Layer4` |

### Example Runner Script Structure (Layer 1)

```bash
#!/bin/bash
set -euo pipefail

# --- Auto-generated integration test runner ---
# Project type: <detected>
# Generated on: <date>

# Verify prerequisites
if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker is not running. Please start Docker and try again."
  exit 1
fi

# Run integration tests (project-specific command is embedded here)
# IMPORTANT: Always filter by the layer-specific tag to avoid running other layers' tests
# Test output (including any failure logs) goes directly to the console.
cd "$(dirname "$0")/../.."

<project-specific-test-command>
# e.g., mvn verify -Dgroups=Layer1, ./gradlew test -Dgroups=Layer1

TEST_EXIT=$?

# --- Print summary ---
echo ""
echo "========================================"
if [ $TEST_EXIT -eq 0 ]; then
  echo "✅ Layer 1 integration tests PASSED"
else
  echo "❌ Layer 1 integration tests FAILED"
fi
echo "========================================"
exit $TEST_EXIT
```

> **Note to implementers:** Replace `<project-specific-test-command>` with the real test command for the detected project type (Maven/Gradle). The test runner's own console output already includes detailed results — the script just appends a clear pass/fail signal at the end.

## Completion Criteria

1. **Integration Test Plan**: Create and output a plan file at `{modernization-work-folder}/integration-test-plan.md` that includes:
   - Analysis of existing test coverage gaps
   - Identified components requiring integration testing
   - Testing strategy and approach for each component
   - Dependencies and test setup requirements
   - Expected test scenarios and validation criteria
2. All tests for the requested layer **run and pass**, show the running results to the user
3. Test results are reported with clear pass/fail status
4. Any failures are properly analyzed and resolved (see Handling Test Failures section)
5. Test artifacts (logs, screenshots, comparison reports) are saved

6. **Version Control**: Commit changes separately for each layer with meaningful commit messages. Do not combine changes from different layers into a single commit.
    - **Layer 1, 3, 4**: Single commit per layer including test classes and runner scripts (e.g., `Add Layer 1 local integration tests`)
    - **Layer 2**: Multi-commit sequence as defined in references/layer2-smoke-tests.md (minimum 3 commits: artifacts → auth → restore). Runner scripts are part of the artifacts commit.
    - **Git ignore respect**: Use standard `git add` commands. Do not force-add files. If files in `{modernization-work-folder}` are ignored by the project's `.gitignore`, respect that.

7. **Integration Test Summary**: Create and output a summary file at `{modernization-work-folder}/integration-test-summary.md` that documents:
   - All integration tests added (with file paths and descriptions)
   - Test coverage improvements achieved
   - Issues identified and resolved (both in source code and test code)
   - Final test execution results
   - Paths to generated runner scripts and the fixed commands to execute them
   - Source code changes made during testing and their purpose
8. **Runner Scripts**: Generate standardized runner scripts at `{modernization-work-folder}/integration-tests/run-layer{N}-tests.sh` and `.ps1` (see Standardized Runner Scripts section). The scripts must embed all project-specific commands so users always run the same fixed command. Include runner scripts in the layer's commit (for Layer 2, in the artifacts commit).

**Resources:**
- references/layer1-local-integration.md
- references/layer2-smoke-tests.md
- references/layer3-azure-integration.md
- references/layer4-behavioral-comparison.md
- references/azure-auth-strategies.md
- references/azure-servicebus-testcontainers.md
- references/azure-storage-testcontainers.md
- references/layer2-runner-script-templates.md

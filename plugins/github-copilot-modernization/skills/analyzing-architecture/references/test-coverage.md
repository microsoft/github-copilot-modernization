Analyze the existing test suite. Focus on:
- **Test inventory**: Count and categorize tests (unit / integration / e2e / performance)
- **Coverage baseline**: Which packages/classes have tests? Which are untested?
- **Test framework**: JUnit 4/5, TestNG, Mockito, Spring Test, etc.
- **Integration test dependencies**: What real services do integration tests require? (DB, message broker, external APIs)
- **Test data strategy**: fixtures, DBUnit datasets, factory methods, inline mocks
- **Portability assessment**: Which tests are tightly coupled to the current framework? Which test only business logic independently of the web layer?
- **Gaps**: Business-critical areas with no test coverage

> ⚠️ **Document the existing test suite only.** Do not recommend target test strategies or frameworks.

Output: `./test-coverage.md`

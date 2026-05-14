# Modernization Plan Template

Use this template to generate modernization plans for applications. Replace placeholders with actual values and customize content based on the specific modernization scenario.

**Planning Philosophy**:
- **Focus on GOALS, not implementation**: Describe WHAT needs to be achieved from the user's perspective
- **Skills define HOW**: All implementation details (frameworks, SDKs, libraries, code patterns, authentication methods) will be determined by the referenced skills
- **No assumptions**: Do not assume or specify any technical implementation approach in the plan - let skills handle all "how" decisions

---

# Modernization Plan: [Modernization Title]

**Project**: [Application Name]

---

## Technical Framework

**Purpose**: Document the application's current technology stack to provide context for the migration.

**Template**:
```markdown
- **Language**: [Programming language and version, e.g., Java 11, Python 3.9, .NET 6]
- **Framework**: [Application framework and version, e.g., Spring Boot 2.7.18, Django 4.2, ASP.NET Core 6.0]
- **Build Tool**: [Build system, e.g., Maven 3.9, Gradle 8.0, npm]
- **Database**: [Current database, e.g., Oracle 19c, PostgreSQL 14, SQL Server 2019]
- **Key Dependencies**: [Major libraries/frameworks, e.g., Spring Data JPA, Hibernate, Entity Framework]
```

---

## Overview

**Purpose**: Describe the high-level modernization goals without technical details. Focus on business objectives and what will change.

**Template**:
> This migration [describe what is being migrated]. The application currently [describe current state]. The new architecture will:
>
> - [First key change and its business benefit]
> - [Second key change and its business benefit]
> - [Third key change and its business benefit]
>
> The migration follows [describe phased approach without technical specifics].

---

## Migration Impact Summary

**Purpose**: Create a simple table showing migration impact for each application and its affected services.
**Rule**: Each line should be limited to a maximum of 80 characters.
**Template**:
```
| Application | Original Service | New Azure Service | Authentication | Comments |
|-------------|------------------|-------------------|-------------|----------------|----------|
| [App Name]  | [Old Service]    | [Azure Service]   | [Auth method (Default is Managed Identity if user not specified)] | [User specified request for the migration] |
```

---

## Clarifications

**Purpose**: Document items that were not explicitly requested by the user but may be necessary or beneficial. Ask the user to confirm or provide input.

**Rule**: Only include this section if there are implicit dependencies, nice-to-have features, or ambiguities in the user's request.

**Template**:
```markdown
The following items were not explicitly requested but may be needed for a complete implementation:

1. **[Item Name]**: [Description of what needs clarification]
   - **Why needed**: [Explain the dependency or benefit]
   - **Options**: [List possible approaches or choices]
   - **Recommendation**: [Suggest a default if user doesn't respond]

```

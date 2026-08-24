---
name: modernize-websphere-standalone
description: Migrate Spring Boot on WebSphere Application Server to Spring Boot standalone executable JAR
user-invocable: false
---

# Code Migration: Spring Boot 2.7 on WebSphere Application Server to Spring Boot Standalone

## Migration Request

Migrate this codebase from Spring Boot 2.7 on WebSphere Application Server to Spring Boot standalone, focusing **exclusively** on code-level changes required for successful compilation.

## Scope

- ✅ Code modification to replace WebSphere-specific dependencies with Spring Boot standalone equivalents
- ✅ Configuration file updates necessary for compilation
- ✅ Dependency management changes (pom.xml)
- ✅ Switch from WAR packaging to executable JAR packaging
- ✅ Remove WebSphere-specific deployment descriptors and configuration
- ✅ Replace JNDI lookups with Spring Boot configuration properties
- ✅ Remove `SpringBootServletInitializer` usage in favor of standard Spring Boot main class
- ✅ Replace WebSphere-provided libraries with Spring Boot managed equivalents
- ❌ No infrastructure setup (assumed to be handled separately)
- ❌ No testing beyond compilation verification
- ❌ No deployment considerations

## Success Criteria

1. Codebase compiles successfully as a Spring Boot standalone application
2. All WebSphere-specific dependencies, imports, and configurations are replaced
3. Application packages as an executable JAR (not WAR)
4. All migration tasks are tracked and completed

## Execution Process

### Phase 1: Analysis & Planning

1. Analyze the codebase to identify all WebSphere-specific usages, including:
   - WebSphere dependencies in `pom.xml` (e.g., `websphere-liberty-api`, `was-liberty`, `com.ibm.websphere.*`)
   - WAR packaging configuration
   - `SpringBootServletInitializer` extensions
   - JNDI lookups (`java:comp/env/`, `InitialContext`, `@Resource` with JNDI names)
   - WebSphere deployment descriptors (`server.xml`, `ibm-web-ext.xml`, `ibm-web-bnd.xml`, `ibm-application-bnd.xml`, `jvm.options`)
   - WebSphere-specific logging configuration
   - WebSphere-specific security configuration (e.g., `com.ibm.websphere.security.*`)
   - WebSphere-specific transaction management
   - Servlet API dependencies marked as `provided` (relying on WebSphere container)

2. Create a `plan.md` file in the project root with the following structure:
   - **Summary**: what was found and what needs to change
   - **Migration Tasks**: ordered list of concrete changes, each with:
     - Task description
     - Files to be modified or deleted
     - What the change does
   - **Build Verification**: `mvn clean compile` after all tasks complete

3. **STOP and ask the user to review `plan.md`.** Do not proceed until the user explicitly confirms the plan is acceptable.

### Phase 2: Execution (only after user approval)

Execute each task from `plan.md` in order:

- **pom.xml**: Change packaging from `war` to `jar`, remove WebSphere-specific dependencies, add `spring-boot-starter-web` (with embedded Tomcat), ensure `spring-boot-maven-plugin` is configured for executable JAR
- **Main Application Class**: Remove `extends SpringBootServletInitializer` and `configure()` method override; ensure standard `public static void main` entry point with `SpringApplication.run()`
- **JNDI Replacements**: Replace all JNDI lookups with Spring Boot `@Value`, `@ConfigurationProperties`, or `application.properties`/`application.yml` entries
- **DataSource Configuration**: Replace JNDI DataSource lookups with Spring Boot auto-configured DataSource properties (`spring.datasource.*`)
- **Servlet/Filter Registration**: Replace `web.xml` servlet/filter declarations with Spring Boot `@Bean` registrations or annotations
- **WebSphere Deployment Descriptors**: Remove `server.xml`, `ibm-web-ext.xml`, `ibm-web-bnd.xml`, `ibm-application-bnd.xml`, `jvm.options`, and any `WEB-INF/ibm-*` files
- **Provided Dependencies**: Change `provided` scope Servlet API / JSP API dependencies to be managed by Spring Boot starters
- **Logging**: Replace any WebSphere-specific logging with Spring Boot default logging (Logback via `spring-boot-starter-logging`)
- **Configuration Files**: Update `application.properties` or `application.yml` with server port, context path, and any properties previously supplied by WebSphere
- **Static Resources / JSP**: If JSPs are used, ensure embedded Tomcat JSP support is added (`tomcat-embed-jasper`, `jstl`)

After all tasks are complete, run:
```
mvn clean compile
```
Report success or failure. If compilation fails, diagnose and fix errors before finishing.

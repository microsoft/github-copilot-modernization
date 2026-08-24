# Struts to Spring Boot - Configuration Skills

Skills for project configuration and setup during Struts to Spring Boot migration.

---

## Skill: migrate-maven-dependencies

**Description:** Transform Maven dependencies from Struts to Spring Boot.

**Trigger:** When migrating `pom.xml` or setting up Spring Boot foundation.

**Input:** Struts `pom.xml` with struts2-core dependencies.

**Steps:**

1. **Add Spring Boot parent POM:**
```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.4.x</version>
</parent>
```

2. **Add Spring Boot dependencies:**
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
```

3. **Remove Struts dependencies:**
```xml
<!-- DELETE these -->
<dependency>
    <groupId>org.apache.struts</groupId>
    <artifactId>struts2-core</artifactId>
</dependency>
<dependency>
    <groupId>org.apache.struts</groupId>
    <artifactId>struts2-config-browser-plugin</artifactId>
</dependency>
```

4. **Add Spring Boot Maven plugin:**
```xml
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
</plugin>
```

**Output:** Spring Boot compatible `pom.xml`.

---

## Skill: create-spring-boot-application

**Description:** Create Spring Boot main application class.

**Trigger:** When starting migration or no `@SpringBootApplication` class exists.

**Input:** Base package name (derive from existing Action classes).

**Template:**

```java
package ${basePackage};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

**Location:** `src/main/java/${basePackage}/Application.java`

**Output:** Spring Boot application entry point.

---

## Skill: create-application-properties

**Description:** Create Spring Boot application.properties from struts.xml and web.xml settings.

**Trigger:** When setting up Spring Boot configuration.

**Template:**

```properties
# Server Configuration
server.port=8080

# Application Name
spring.application.name=${artifactId}

# Logging
logging.level.root=INFO
logging.level.org.springframework.web=DEBUG

# JSP View Resolver (if using JSP)
spring.mvc.view.prefix=/WEB-INF/jsp/
spring.mvc.view.suffix=.jsp

# JPA (if applicable)
spring.jpa.open-in-view=false

# File Upload (if applicable)
spring.servlet.multipart.max-file-size=10MB
spring.servlet.multipart.max-request-size=10MB
```

**Location:** `src/main/resources/application.properties`

**Output:** Spring Boot configuration file.

# Struts 2 to Spring Boot 3.x Migration Guideline

## Metadata

- **Source Technology**: Apache Struts 2 (struts2-core)
- **Target Technology**: Spring Boot 3.x with Spring MVC
- **Trigger Keywords**: struts, struts2, ActionSupport, struts.xml, xwork2, opensymphony, struts-tags
- **Version**: 1.0.0
- **Last Updated**: 2025-01-22

## Overview

This guideline provides comprehensive skills for migrating Apache Struts 2 applications to Spring Boot 3.x. Each skill addresses a specific migration concern with concrete transformation rules, examples, and validation criteria.

## Skill Files

| File | Skills | Description |
|------|--------|-------------|
| [SKILL-config.md](SKILL-config.md) | migrate-maven-dependencies, create-spring-boot-application, create-application-properties | Project setup and configuration |
| [SKILL-action.md](SKILL-action.md) | convert-action-to-controller, convert-action-properties | Action to Controller conversion |
| [SKILL-view.md](SKILL-view.md) | convert-jsp-tags, convert-ognl-to-el, convert-result-types | View layer migration |
| [SKILL-interceptor.md](SKILL-interceptor.md) | convert-interceptor, convert-validation | Interceptors and validation |
| [SKILL-xml.md](SKILL-xml.md) | migrate-struts-xml, migrate-web-xml | XML configuration migration |
| [SKILL-test.md](SKILL-test.md) | convert-test-classes, create-exception-handler | Testing and exception handling |

---

## Migration Checklist

Execute skills in this order:

### Phase 1: Project Setup
1. [ ] `migrate-maven-dependencies` - Update pom.xml ([SKILL-config.md](SKILL-config.md))
2. [ ] `create-spring-boot-application` - Create main class ([SKILL-config.md](SKILL-config.md))
3. [ ] `create-application-properties` - Create configuration ([SKILL-config.md](SKILL-config.md))

### Phase 2: Configuration Migration
4. [ ] `migrate-struts-xml` - Plan controller structure ([SKILL-xml.md](SKILL-xml.md))
5. [ ] `migrate-web-xml` - Remove Struts filter ([SKILL-xml.md](SKILL-xml.md))

### Phase 3: Action Conversion
6. [ ] `convert-action-to-controller` - Convert each Action class ([SKILL-action.md](SKILL-action.md))
7. [ ] `convert-action-properties` - Handle Action properties ([SKILL-action.md](SKILL-action.md))

### Phase 4: Cross-cutting Concerns
8. [ ] `convert-validation` - Migrate validation logic ([SKILL-interceptor.md](SKILL-interceptor.md))
9. [ ] `convert-interceptor` - Convert interceptors ([SKILL-interceptor.md](SKILL-interceptor.md))

### Phase 5: View Layer
10. [ ] `convert-result-types` - Handle result mappings ([SKILL-view.md](SKILL-view.md))
11. [ ] `convert-jsp-tags` - Update JSP files ([SKILL-view.md](SKILL-view.md))
12. [ ] `convert-ognl-to-el` - Fix expressions ([SKILL-view.md](SKILL-view.md))

### Phase 6: Testing & Polish
13. [ ] `convert-test-classes` - Update tests ([SKILL-test.md](SKILL-test.md))
14. [ ] `create-exception-handler` - Global exception handling ([SKILL-test.md](SKILL-test.md))

---

## Complete Transformation Example

### Before (Struts)

**HelloAction.java:**
```java
package com.example.action;

import com.opensymphony.xwork2.ActionSupport;

public class HelloAction extends ActionSupport {
    private String name;
    private String message;
    
    public String execute() {
        if (name == null || name.isEmpty()) {
            return INPUT;
        }
        message = "Hello, " + name + "!";
        return SUCCESS;
    }
    
    public void validate() {
        if (name != null && name.length() > 50) {
            addFieldError("name", "Name too long");
        }
    }
    
    // getters and setters
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getMessage() { return message; }
}
```

**struts.xml:**
```xml
<action name="hello" class="com.example.action.HelloAction">
    <result name="success">/WEB-INF/jsp/hello.jsp</result>
    <result name="input">/WEB-INF/jsp/hello-form.jsp</result>
</action>
```

**hello.jsp:**
```jsp
<%@ taglib prefix="s" uri="/struts-tags" %>
<html>
<body>
    <s:property value="message"/>
</body>
</html>
```

### After (Spring Boot)

**HelloForm.java:**
```java
package com.example.form;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class HelloForm {
    @NotBlank(message = "Name is required")
    @Size(max = 50, message = "Name too long")
    private String name;
    
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
```

**HelloController.java:**
```java
package com.example.controller;

import com.example.form.HelloForm;
import jakarta.validation.Valid;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;

@Controller
public class HelloController {
    
    @GetMapping("/hello")
    public String showForm(Model model) {
        model.addAttribute("helloForm", new HelloForm());
        return "hello-form";
    }
    
    @PostMapping("/hello")
    public String execute(@Valid @ModelAttribute HelloForm form,
                         BindingResult result,
                         Model model) {
        if (result.hasErrors()) {
            return "hello-form";
        }
        String message = "Hello, " + form.getName() + "!";
        model.addAttribute("message", message);
        return "hello";
    }
}
```

**hello.jsp:**
```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<html>
<body>
    ${message}
</body>
</html>
```

**Application.java:**
```java
package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

**application.properties:**
```properties
server.port=8080
spring.mvc.view.prefix=/WEB-INF/jsp/
spring.mvc.view.suffix=.jsp
```

# Struts to Spring Boot - Testing & Exception Handling Skills

Skills for converting test classes and exception handling.

---

## Skill: convert-test-classes

**Description:** Convert Struts test cases to Spring Boot tests.

**Trigger:** When test class extends `StrutsTestCase` or `StrutsSpringTestCase`.

**Input:** Struts test class.

**Steps:**

1. **Remove imports:**
```java
// DELETE
import org.apache.struts2.StrutsTestCase;
import org.apache.struts2.StrutsSpringTestCase;
```

2. **Add imports:**
```java
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
```

3. **Transform test class:**
```java
// FROM (Struts)
public class HelloActionTest extends StrutsTestCase {
    public void testExecute() throws Exception {
        request.setParameter("name", "World");
        ActionProxy proxy = getActionProxy("/hello");
        HelloAction action = (HelloAction) proxy.getAction();
        String result = proxy.execute();
        assertEquals("success", result);
        assertEquals("Hello, World!", action.getMessage());
    }
}

// TO (Spring)
@WebMvcTest(HelloController.class)
public class HelloControllerTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Test
    public void testExecute() throws Exception {
        mockMvc.perform(get("/hello").param("name", "World"))
               .andExpect(status().isOk())
               .andExpect(view().name("success"))
               .andExpect(model().attribute("message", "Hello, World!"));
    }
}
```

**Test annotation selection:**
- `@WebMvcTest` - Controller layer only (faster)
- `@SpringBootTest` - Full application context
- `@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)` - Integration test

**Output:** Spring Boot test class with MockMvc.

---

## Skill: create-exception-handler

**Description:** Convert Struts exception mappings to Spring @ControllerAdvice.

**Trigger:** When struts.xml contains `<global-exception-mappings>` or Action has exception handling.

**Input:** Exception configuration from struts.xml.

**Template:**

```java
package ${basePackage}.exception;

import org.springframework.http.HttpStatus;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@ControllerAdvice
public class GlobalExceptionHandler {
    
    private static final Logger logger = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public String handleException(Exception e, Model model) {
        logger.error("Unexpected error", e);
        model.addAttribute("error", e.getMessage());
        return "error";
    }
    
    @ExceptionHandler(ResourceNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public String handleNotFound(ResourceNotFoundException e, Model model) {
        model.addAttribute("error", e.getMessage());
        return "404";
    }
    
    @ExceptionHandler(ValidationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public String handleValidation(ValidationException e, Model model) {
        model.addAttribute("error", e.getMessage());
        return "input";
    }
}
```

**struts.xml mapping conversion:**
```xml
<!-- FROM -->
<global-exception-mappings>
    <exception-mapping exception="java.lang.Exception" result="error"/>
    <exception-mapping exception="com.example.NotFoundException" result="notfound"/>
</global-exception-mappings>

<!-- Each mapping becomes an @ExceptionHandler method -->
```

**Output:** GlobalExceptionHandler class with @ControllerAdvice.

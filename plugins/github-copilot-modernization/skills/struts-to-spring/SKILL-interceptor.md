# Struts to Spring Boot - Interceptor & Validation Skills

Skills for converting Struts interceptors and validation logic.

---

## Skill: convert-interceptor

**Description:** Convert Struts Interceptors to Spring HandlerInterceptors.

**Trigger:** When file implements `Interceptor` or extends `AbstractInterceptor`.

**Input:** Struts Interceptor class.

**Steps:**

1. **Remove imports:**
```java
// DELETE
import com.opensymphony.xwork2.interceptor.Interceptor;
import com.opensymphony.xwork2.interceptor.AbstractInterceptor;
import com.opensymphony.xwork2.ActionInvocation;
```

2. **Add imports:**
```java
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.ModelAndView;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
```

3. **Transform class:**
```java
// FROM
public class MyInterceptor extends AbstractInterceptor {
    public String intercept(ActionInvocation invocation) throws Exception {
        // pre-processing
        String result = invocation.invoke();
        // post-processing
        return result;
    }
}

// TO
@Component
public class MyInterceptor implements HandlerInterceptor {
    @Override
    public boolean preHandle(HttpServletRequest request, 
                            HttpServletResponse response, 
                            Object handler) throws Exception {
        // pre-processing
        return true; // continue execution
    }
    
    @Override
    public void postHandle(HttpServletRequest request,
                          HttpServletResponse response,
                          Object handler,
                          ModelAndView modelAndView) throws Exception {
        // post-processing (after controller, before view)
    }
    
    @Override
    public void afterCompletion(HttpServletRequest request,
                               HttpServletResponse response,
                               Object handler,
                               Exception ex) throws Exception {
        // cleanup (after view rendering)
    }
}
```

4. **Register interceptor in WebMvcConfigurer:**
```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Autowired
    private MyInterceptor myInterceptor;
    
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(myInterceptor).addPathPatterns("/**");
    }
}
```

**Output:** Spring HandlerInterceptor with configuration.

---

## Skill: convert-validation

**Description:** Convert Struts validation to Jakarta Bean Validation.

**Trigger:** When Action has `validate()` method or validation XML exists.

**Input:** Struts validation logic.

**Steps:**

1. **Add imports:**
```java
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import jakarta.validation.Valid;
import org.springframework.validation.BindingResult;
```

2. **Transform validate() to annotations:**
```java
// FROM (Struts)
public void validate() {
    if (username == null || username.isEmpty()) {
        addFieldError("username", "Username is required");
    }
    if (email != null && !email.contains("@")) {
        addFieldError("email", "Invalid email");
    }
}

// TO (Spring - Form class)
public class UserForm {
    @NotBlank(message = "Username is required")
    private String username;
    
    @Email(message = "Invalid email")
    private String email;
}
```

3. **Controller method with validation:**
```java
@PostMapping("/submit")
public String submit(@Valid @ModelAttribute UserForm form,
                    BindingResult result,
                    Model model) {
    if (result.hasErrors()) {
        return "input";  // return to form with errors
    }
    // process valid form
    return "success";
}
```

**Validation Mapping Table:**

| Struts Validator | Jakarta Annotation |
|------------------|-------------------|
| `requiredstring` | `@NotBlank` |
| `stringlength` | `@Size(min=, max=)` |
| `email` | `@Email` |
| `regex` | `@Pattern(regexp=)` |
| `int` | `@Min` / `@Max` |
| `double` | `@DecimalMin` / `@DecimalMax` |
| `required` | `@NotNull` |
| `url` | `@URL` (from Hibernate Validator) |

**Output:** Form class with validation annotations + Controller with BindingResult.

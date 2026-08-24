# Struts to Spring Boot - XML Configuration Migration Skills

Skills for migrating struts.xml and web.xml configurations.

---

## Skill: migrate-struts-xml

**Description:** Convert struts.xml action mappings to Spring Controller annotations.

**Trigger:** When processing `struts.xml` file.

**Input:** struts.xml with action definitions.

**Transformation:**

```xml
<!-- FROM (struts.xml) -->
<action name="hello" class="com.example.HelloAction" method="execute">
    <result name="success">/WEB-INF/jsp/hello.jsp</result>
    <result name="error">/WEB-INF/jsp/error.jsp</result>
    <result name="redirect" type="redirect">/home</result>
</action>

<action name="user/*" class="com.example.UserAction" method="{1}">
    <result name="success">/WEB-INF/jsp/user/{1}.jsp</result>
</action>
```

```java
// TO (Spring Controller)
@Controller
public class HelloController {
    
    @GetMapping("/hello")
    public String execute(Model model) {
        // return "success" → resolves to hello.jsp (configure view name)
        return "hello";
    }
}

@Controller
@RequestMapping("/user")
public class UserController {
    
    @GetMapping("/list")
    public String list(Model model) {
        return "user/list";
    }
    
    @GetMapping("/view")
    public String view(Model model) {
        return "user/view";
    }
}
```

**Wildcard mapping conversion:**
- `action/*` → Multiple `@GetMapping` methods or `@PathVariable`
- `{1}` parameter → `@PathVariable` or separate methods

**Output:** Controller classes with proper request mappings.

---

## Skill: migrate-web-xml

**Description:** Remove Struts filter and convert web.xml to Spring Boot configuration.

**Trigger:** When `web.xml` contains Struts filter configuration.

**Steps:**

1. **Remove Struts filter (DELETE from web.xml or delete file):**
```xml
<!-- DELETE -->
<filter>
    <filter-name>struts2</filter-name>
    <filter-class>org.apache.struts2.dispatcher.filter.StrutsPrepareAndExecuteFilter</filter-class>
</filter>
<filter-mapping>
    <filter-name>struts2</filter-name>
    <url-pattern>/*</url-pattern>
</filter-mapping>
```

2. **Convert custom filters to Spring beans:**
```java
@Component
public class MyFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, 
                        FilterChain chain) throws IOException, ServletException {
        // filter logic
        chain.doFilter(request, response);
    }
}

// Or register with FilterRegistrationBean
@Configuration
public class FilterConfig {
    @Bean
    public FilterRegistrationBean<MyFilter> myFilter() {
        FilterRegistrationBean<MyFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new MyFilter());
        registration.addUrlPatterns("/*");
        registration.setOrder(1);
        return registration;
    }
}
```

3. **Convert listeners to Spring:**
```java
// Context listener → @EventListener or ApplicationListener
@Component
public class AppStartupListener implements ApplicationListener<ContextRefreshedEvent> {
    @Override
    public void onApplicationEvent(ContextRefreshedEvent event) {
        // initialization logic
    }
}
```

**Output:** Spring Boot auto-configuration replaces web.xml.

# Struts to Spring Boot - View Layer Skills

Skills for converting Struts JSP tags, OGNL expressions, and result types.

---

## Skill: convert-jsp-tags

**Description:** Convert Struts JSP tags to Spring form tags and JSTL.

**Trigger:** When processing JSP files with `<%@ taglib prefix="s" uri="/struts-tags" %>`.

**Steps:**

1. **Replace taglib declaration:**
```jsp
<%-- DELETE --%>
<%@ taglib prefix="s" uri="/struts-tags" %>

<%-- ADD --%>
<%@ taglib prefix="form" uri="http://www.springframework.org/tags/form" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="spring" uri="http://www.springframework.org/tags" %>
```

2. **Tag conversion table:**

| Struts Tag | Spring/JSTL Tag |
|------------|-----------------|
| `<s:form action="...">` | `<form:form action="..." modelAttribute="formName">` |
| `</s:form>` | `</form:form>` |
| `<s:textfield name="x"/>` | `<form:input path="x"/>` |
| `<s:password name="x"/>` | `<form:password path="x"/>` |
| `<s:textarea name="x"/>` | `<form:textarea path="x"/>` |
| `<s:hidden name="x"/>` | `<form:hidden path="x"/>` |
| `<s:select name="x" list="items"/>` | `<form:select path="x" items="${items}"/>` |
| `<s:checkbox name="x"/>` | `<form:checkbox path="x"/>` |
| `<s:radio name="x" list="items"/>` | `<form:radiobuttons path="x" items="${items}"/>` |
| `<s:submit value="Submit"/>` | `<button type="submit">Submit</button>` |
| `<s:property value="x"/>` | `${x}` or `<c:out value="${x}"/>` |
| `<s:if test="condition">` | `<c:if test="${condition}">` |
| `<s:else>` | `</c:if><c:if test="${!condition}">` |
| `<s:iterator value="list" var="item">` | `<c:forEach items="${list}" var="item">` |
| `<s:url action="x"/>` | `<c:url value="/x"/>` |
| `<s:a href="...">` | `<a href="...">` |
| `<s:text name="key"/>` | `<spring:message code="key"/>` |
| `<s:fielderror/>` | `<form:errors path="*"/>` |
| `<s:actionerror/>` | `<c:if test="${not empty errors}">` |

3. **Attribute conversion:**

| Struts Attribute | Spring Attribute |
|------------------|------------------|
| `name` | `path` |
| `list` | `items` |
| `listKey` | `itemValue` |
| `listValue` | `itemLabel` |
| `cssClass` | `cssClass` |
| `cssStyle` | `cssStyle` |
| `label` | Use `<label>` separately |

**Output:** JSP with Spring form tags and JSTL.

---

## Skill: convert-ognl-to-el

**Description:** Convert OGNL expressions to Spring Expression Language (EL).

**Trigger:** When JSP contains `%{...}` or `#session`, `#request` expressions.

**Transformation Table:**

| OGNL | Spring EL |
|------|-----------|
| `%{expression}` | `${expression}` |
| `#session.attr` | `${sessionScope.attr}` |
| `#request.attr` | `${requestScope.attr}` |
| `#application.attr` | `${applicationScope.attr}` |
| `#parameters.param` | `${param.param}` |
| `#parameters.param[0]` | `${paramValues.param[0]}` |
| `#attr.name` | `${name}` |
| `user.name` | `${user.name}` |
| `list.size` | `${list.size()}` or `${fn:length(list)}` |
| `list.isEmpty` | `${empty list}` |
| `condition ? a : b` | `${condition ? a : b}` |

**Examples:**

```jsp
<%-- FROM (Struts OGNL) --%>
<s:property value="%{user.name}"/>
<s:if test="#session.loggedIn">
<s:iterator value="users" var="u">
    %{#u.email}
</s:iterator>

<%-- TO (Spring EL) --%>
${user.name}
<c:if test="${sessionScope.loggedIn}">
<c:forEach items="${users}" var="u">
    ${u.email}
</c:forEach>
```

**Output:** JSP with Spring EL expressions.

---

## Skill: convert-result-types

**Description:** Convert Struts result configurations to Spring return types.

**Trigger:** When processing struts.xml result mappings or Action return statements.

**Transformation Table:**

| Struts Result Type | Spring Return |
|-------------------|---------------|
| `dispatcher` (default) | `return "viewName";` |
| `redirect` | `return "redirect:/path";` |
| `redirectAction` | `return "redirect:/action";` |
| `json` | `@ResponseBody` + return object |
| `stream` | `ResponseEntity<Resource>` |
| `chain` | Call another controller method |

**Examples:**

```java
// dispatcher (JSP view)
return "success";  // resolves to /WEB-INF/jsp/success.jsp

// redirect
return "redirect:/home";

// redirect with parameters
return "redirect:/user?id=" + userId;

// JSON response
@GetMapping("/api/user")
@ResponseBody
public User getUser() {
    return userService.findUser();
}

// or using ResponseEntity
@GetMapping("/api/user")
public ResponseEntity<User> getUser() {
    return ResponseEntity.ok(userService.findUser());
}

// File download
@GetMapping("/download")
public ResponseEntity<Resource> download() {
    Resource file = new FileSystemResource(path);
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"file.pdf\"")
        .body(file);
}
```

**Output:** Appropriate Spring return statement.

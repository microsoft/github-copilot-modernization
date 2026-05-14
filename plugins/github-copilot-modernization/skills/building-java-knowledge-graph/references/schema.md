# Knowledge Graph Schema

## Node Types

| Type | Description | Example ID |
|------|-------------|------------|
| `system` | Root project node | `system:nocode-saas` |
| `module` | Maven/Gradle module | `module:nocode-saas:1.0.0` |
| `class` | Class declaration | `class:com.example.UserService` |
| `interface` | Interface declaration | `interface:com.example.UserRepo` |
| `enum` | Enum declaration | `enum:com.example.Status` |
| `annotation` | Annotation type | `annotation:com.example.Auth` |

## Edge Types

| Type | Description | Extra Fields |
|------|-------------|-------------|
| `contains` | System→modules, module→classes | — |
| `depends_on` | Module dependencies | `scope`: compile/test/runtime/provided |
| `extends` | Class inheritance | — |
| `implements` | Interface implementation | — |
| `aggregates` | Parent-child module | — |

## Key Node Fields

- `type`, `name`, `moduleName`, `package`
- `layer` — controller/service/repository/model/config/util/other
- `language` — java/kotlin/scala/groovy
- `annotations` — e.g. `["@RestController", "@Lombok"]`
- `superclass` — parent class name (if any)

## Visualization Colors

- Blue = controllers, Green = services, Yellow = repositories
- Pink = models/entities, Purple = config, Gray = utilities
- Blue arrows = compile deps, Gray dashed = parent-child aggregation

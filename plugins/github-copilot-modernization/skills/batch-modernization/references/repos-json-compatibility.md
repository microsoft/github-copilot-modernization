# `repos.json` Compatibility

## V1

V1 is a non-empty array. Each repository requires `name` and either `url` or absolute `path`:

```json
[
  {
    "name": "orders-api",
    "url": "https://github.com/contoso/orders-api.git"
  }
]
```

## V2

V2 is an object with non-empty `repos`, optional `producer`, and optional `apps`:

```json
{
  "producer": "portfolio-team",
  "repos": [
    {
      "name": "orders",
      "path": "C:\\src\\orders",
      "include_paths": ["services/api"]
    }
  ],
  "apps": [
    {
      "identifier": "commerce",
      "repos": ["orders"]
    }
  ]
}
```

## Field Rules

| Field | Rule |
|---|---|
| `name` | Required, non-empty, case-insensitively unique. Its sanitized cross-platform ID must also be unique. |
| `url` | HTTPS, SSH URI, or SCP-style SSH. HTTP and malformed forms are rejected. Persisted form contains no userinfo, query, or fragment. |
| `path` | Absolute local path; `~` expands to the user home. If both URL and path exist, URL wins and a warning is emitted. |
| `branch` | Applies only to URL repositories and must be a valid Git branch/ref name. Local-path branch is ignored with a warning. |
| `include_paths` | Repository-relative project paths. Absolute paths, `..`, duplicates, and execution-unit ID collisions are rejected. |
| `apps` | Grouping metadata only. Every repository reference must resolve case-insensitively. |
| `producer` | Preserved for source tracking. |
| Other fields | Preserved under `unknownFields`; credential-like keys and secret-bearing URLs are redacted. |

## Execution Units

- No `include_paths`: repository root becomes one execution unit.
- With `include_paths`: each valid recognized project path becomes a separate execution unit.
- `workspacePath` and the initial sole `scopeRoot` are the canonical project path, not the repository root.
- `repoId` identifies configuration ownership; `executionUnitId` identifies scheduling and artifacts.
- Units sharing a Git root must remain serialized when mutation is later enabled.

## Preflight States

- `ready`: path, project, Git expectations, and authorization are valid with no warnings.
- `needs_attention`: usable but requires a batch-level decision, such as dirty workspace or non-Git local project.
- `blocked`: missing/unauthorized path, unsupported project, path escape, invalid clone target, origin mismatch, branch mismatch, or other safety violation.

Unknown fields do not make the configuration invalid unless they contain values that cannot be safely retained.
# Ignore File Patterns by Technology

## Detection & Creation Logic

- `git rev-parse --git-dir 2>/dev/null` succeeds → create/verify `.gitignore`
- `Dockerfile*` exists or Docker in plan.md → `.dockerignore`
- `.eslintrc*` exists → `.eslintignore`
- `eslint.config.*` exists → ensure `ignores` entries cover required patterns
- `.prettierrc*` exists → `.prettierignore`
- `.npmrc` or `package.json` exists → `.npmignore` (if publishing)
- `*.tf` exists → `.terraformignore`
- Helm charts present → `.helmignore`

**If file exists**: Verify essential patterns, append missing critical patterns only.
**If file missing**: Create with full pattern set for detected technology.

## Language Patterns

| Language | Patterns |
|----------|----------|
| Node.js/TS | `node_modules/`, `dist/`, `build/`, `*.log`, `.env*` |
| Python | `__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `dist/`, `*.egg-info/` |
| Java | `target/`, `*.class`, `*.jar`, `.gradle/`, `build/` |
| C#/.NET | `bin/`, `obj/`, `*.user`, `*.suo`, `packages/` |
| Go | `*.exe`, `*.test`, `vendor/`, `*.out` |
| Ruby | `.bundle/`, `log/`, `tmp/`, `*.gem`, `vendor/bundle/` |
| PHP | `vendor/`, `*.log`, `*.cache`, `*.env` |
| Rust | `target/`, `debug/`, `release/`, `*.rs.bk`, `*.rlib` |
| Kotlin | `build/`, `out/`, `.gradle/`, `.idea/`, `*.class`, `*.jar` |
| C/C++ | `build/`, `bin/`, `obj/`, `out/`, `*.o`, `*.so`, `*.a`, `*.exe` |
| Swift | `.build/`, `DerivedData/`, `*.swiftpm/`, `Packages/` |
| R | `.Rproj.user/`, `.Rhistory`, `.RData`, `packrat/`, `renv/` |
| Universal | `.DS_Store`, `Thumbs.db`, `*.tmp`, `*.swp`, `.vscode/`, `.idea/` |

## Tool-Specific Patterns

| Tool | Patterns |
|------|----------|
| Docker | `node_modules/`, `.git/`, `Dockerfile*`, `*.log*`, `.env*`, `coverage/` |
| ESLint | `node_modules/`, `dist/`, `build/`, `coverage/`, `*.min.js` |
| Prettier | `node_modules/`, `dist/`, `build/`, `coverage/`, `package-lock.json`, `yarn.lock` |
| Terraform | `.terraform/`, `*.tfstate*`, `*.tfvars`, `.terraform.lock.hcl` |
| K8s | `*.secret.yaml`, `secrets/`, `.kube/`, `kubeconfig*`, `*.key`, `*.crt` |

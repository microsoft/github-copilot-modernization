Analyze build files (pom.xml, build.gradle, package.json, Cargo.toml, go.mod, etc.) and source code. Focus on:
- Current frameworks and versions (whatever is present)
- All dependencies with versions
- **Language and runtime**: Java/TypeScript/Python/Go/Rust/etc.
- Deprecated or end-of-life APIs and libraries in use
- Compiler/runtime version requirements (e.g. Java source/target level, Node engine)

> ⚠️ **Document the existing stack only.** Do not suggest target stack choices or migration approaches.

Output: `./tech-stack.md`

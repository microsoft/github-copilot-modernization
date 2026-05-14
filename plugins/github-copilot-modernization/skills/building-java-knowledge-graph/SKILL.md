---
name: building-java-knowledge-graph
description: Analyzes JVM projects (Java/Kotlin/Scala/Groovy) and generates knowledge graphs with tree-sitter parsing. Requires Python 3 on the host and a JVM project with Maven/Gradle/Ant/Ivy build files. Skips gracefully if either prerequisite is missing. Triggers when asked to "build knowledge graph", "analyze project structure", "parse Java codebase", or "generate dependency graph".
---


## Prerequisites

**Step 1 — Verify JVM project:**

```bash
find "$PROJECT_ROOT" -maxdepth 5 -type f \( -name "*.java" -o -name "*.kt" -o -name "*.scala" -o -name "*.groovy" \) | head -1
```

> If no JVM files found: skip this skill. Set `knowledge_graph_dir` to `null` in `setup_artifacts`. Non-fatal — downstream agents fall back to direct source analysis.

**Step 2 — Verify Python:**

```bash
python3 --version 2>/dev/null || python --version 2>/dev/null
```

> If unavailable: skip this skill with same fallback as above.

## Quick Start

```bash
# First-time setup (~1 minute)
pip3 install --user 'tree-sitter<0.21'
python3 scripts/install_grammars.py

# Optional: SVG generation
brew install graphviz  # macOS

# Analyze project
python3 scripts/build_knowledge_graph.py /path/to/project output-dir
```

⚠️ **DESTRUCTIVE OUTPUT**: The script wipes ALL files in `output-dir` before writing. **NEVER** point it at a shared directory like `{{BASE_PATH}}/` or `{{BASE_PATH}}/artifacts/`. Use a dedicated subdirectory:

```
# ✅ SAFE — dedicated subdirectory
python3 scripts/build_knowledge_graph.py /path/to/project {{BASE_PATH}}/artifacts/kg_output

# ❌ DANGER — will delete constitution.md, board.md, other artifacts!
python3 scripts/build_knowledge_graph.py /path/to/project {{BASE_PATH}}
```

After the script finishes, copy `knowledge-graph.json` to `{{BASE_PATH}}/` for other agents to consume.

## What It Detects

- **Build systems**: Maven (pom.xml), Gradle (build.gradle*), Ant (build.xml), Ivy (ivy.xml)
- **Languages**: Java, Kotlin, Scala, Groovy via tree-sitter AST
- **Structure**: Modules, packages, classes, interfaces, enums, annotations
- **Relationships**: Inheritance, implementations, module dependencies
- **Patterns**: Architecture layers (controller/service/repository/model/config/util)
- **Config**: `application*.properties`, `application*.yaml/yml`
- **Gradle subprojects**: `settings.gradle` parsing

## Output

All outputs are written under **the provided artifact path** (pass as 2nd argument to the script).

```
knowledge-graph.json           ← complete graph (nodes + edges)
module-dependencies.{dot,svg}  ← module dependency diagram
module-{name}.{dot,svg}        ← per-module class diagrams
project-{name}.{dot,svg}       ← complete project diagram
```

## Resources

- `references/schema.md` — node/edge types, ID patterns, fields, visualization colors
- `references/querying.md` — jq and Python query examples
- `scripts/build_knowledge_graph.py` — main analyzer
- `scripts/install_grammars.py` — grammar installer

If `setup_artifacts.knowledge_graph_dir` is null or the path does not exist, skip this step silently — do not report an error, continue with direct source analysis instead.

Otherwise, read `knowledge-graph.json` from `setup_artifacts.knowledge_graph_dir`. Focus on:
- Key classes and their roles
- Inter-module dependencies
- Core architectural patterns (layering, DI, transaction scope)
- Tightly coupled areas (high fan-in/fan-out, classes with many dependencies)

> ⚠️ **Document the existing architecture only.** Do not suggest target architecture or refactoring approaches.

Distill into a concise markdown summary (do NOT reproduce the full JSON).

Output: `./architecture-summary.md`

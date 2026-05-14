# Querying the Knowledge Graph

The output `knowledge-graph.json` has structure `{ "nodes": [...], "edges": [...] }`.

## jq Examples

```bash
KG="output-dir/knowledge-graph.json"

# List all node types
jq '[.nodes[].type] | group_by(.) | map({type: .[0], count: length})' "$KG"

# Find all classes in a package
jq '.nodes[] | select(.type == "class" and .package == "com.example.service")' "$KG"

# List all inheritance edges
jq '.edges[] | select(.type == "extends")' "$KG"

# Find classes implementing an interface
jq --arg iface "UserRepository" '.edges[] | select(.type == "implements" and .target_name == $iface) | .source_name' "$KG"

# Count classes per module
jq '[.nodes[] | select(.type == "class")] | group_by(.module) | map({module: .[0].module, count: length})' "$KG"

# Find controller classes
jq '.nodes[] | select(.layer == "controller")' "$KG"

# List module dependencies
jq '.edges[] | select(.type == "module_dependency") | {from: .source_name, to: .target_name}' "$KG"

# Find all Spring annotations
jq '[.nodes[] | select(.annotations != null) | .annotations[]] | unique' "$KG"
```

## Python Examples

```python
import json

with open("output-dir/knowledge-graph.json") as f:
    kg = json.load(f)

nodes = {n["id"]: n for n in kg["nodes"]}
edges = kg["edges"]

# Build adjacency: class → [classes it depends on]
deps = {}
for e in edges:
    if e["type"] in ("extends", "implements"):
        deps.setdefault(e["source"], []).append(e["target"])

# Find classes with no dependencies (leaf classes)
all_classes = [n for n in kg["nodes"] if n["type"] == "class"]
leaf_classes = [c for c in all_classes if c["id"] not in deps]

# Group by layer
from collections import Counter
layers = Counter(n.get("layer", "unknown") for n in kg["nodes"] if n["type"] == "class")
# → Counter({'service': 42, 'controller': 15, 'repository': 12, ...})

# Find circular dependencies between modules
module_deps = [(e["source_name"], e["target_name"]) for e in edges if e["type"] == "module_dependency"]
dep_set = set(module_deps)
circular = [(a, b) for a, b in dep_set if (b, a) in dep_set]
```

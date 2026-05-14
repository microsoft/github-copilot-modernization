---
name: sharing-learnings
description: How to record project learnings so that later-phase workers and future agent runs can consume them.
---

# Sharing Learnings

This skill defines how a multi-agent run captures knowledge and feeds it back into later phases and future runs.

| Product | Path | Scope | Audience |
|---|---|---|---|
| **Learnings** | `{{BASE_PATH}}/learnings/<role>/<slug>.md` (git-tracked) | persistent across runs | later-phase agents in same run + future agents on this repo + humans |

Invoked by every worker during **Preflight Step 2** (consume prior learnings) and **Completion Phase** (produce new learnings).

---

## 1. Directory Layout

```
{{BASE_PATH}}/
└── learnings/<role>/<slug>.md   ← per-topic, append-friendly, git-tracked
```

The directory tree + filename **is** the index. Each file's first three lines (H1 + blank + one-sentence description) are its scannable metadata. No separate index file needed.

---

## 2. Consuming Learnings (Preflight Step 2)

1. `list_dir {{BASE_PATH}}/learnings/<your-role>/` (and any cross-cutting roles relevant to your task).
2. Read **only the first 3 lines** of each file (H1 + blank + one-sentence description). Decide relevance from that sentence alone.
3. `read_file` the full body **only** for learnings that are relevant to your current task.

Emit once after loading:
```
[learnings-loaded] <role>/<slug>, <role>/<slug>
```
Use `(none)` if nothing relevant was found. If a learning conflicts with your task or charter, `[notify:coordinator]` — do not silently ignore.

---

## 3. Learning File Format

Every file under `{{BASE_PATH}}/learnings/` MUST follow this shape:

```markdown
# <Slug Title>

One-sentence description that future agents scan to decide relevance.

## What Happened
Narrative: what was discovered, what went wrong, what worked.
Cite the originating project + task ID.

## Takeaway
Concrete guidance for future tasks dealing with the same topic.

## Example (optional)
Minimal snippet illustrating the point.

## History
- <YYYY-MM-DD> (<project>/<taskId>): initial
- <YYYY-MM-DD> (<project>/<taskId>): added X based on new finding
```

Blank template: [templates/learning.md](./templates/learning.md).

---

## 4. Producing Learnings (Completion Phase)

Before finishing your task, evaluate what you learned and decided.

### When to write

**Mandatory** — you MUST write a learning when any of these apply:
- You made a **code-style or naming convention** choice (e.g. `camelCase` vs `snake_case`, tab width, import ordering)
- You made an **architecture or design decision** (e.g. injection style, module boundaries, error-handling strategy, API shape)
- You chose a **library, framework version, or configuration** that affects project consistency

These learnings ensure style and architecture stay consistent across runs, even if the choice felt obvious.

**Optional** — write a learning when any of these apply:
- Something failed or surprised you, and the resolution is worth recording
- A pattern emerged across multiple files/decisions in the task
- A framework/library/tool behaved differently than expected
- A source→target mapping rule would apply to other modules too

Doing nothing is valid **only** if the task involved no style/architecture decisions and had no surprises.

### How to write

- **One topic per file.** The slug should make the topic clear (kebab-case, e.g. `war-packaging-for-jsp.md`).
- **Role ownership.** Write under `{{BASE_PATH}}/learnings/<your-own-role>/`. If you spot something that belongs to another role, use `[notify:<that-role>]` instead.
- **Append to existing files.** If a file with a matching slug already exists and covers the same topic, append a new `## History` entry rather than creating a duplicate. Add new details under the existing sections.
- **Keep it short.** Target < 40 lines. If it's longer, split into separate files.

Emit after writing (empty list is fine):
```
[learnings] written: [<role>/<slug>, ...]
```

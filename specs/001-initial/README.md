# Spec 001: Claude Code Plugin Scaffolding

## Problem

This repository (`microsoft/github-copilot-modernization`) contains skills in `plugin/skills/` but lacks the scaffolding required for Claude Code's `/plugin` command to discover, install, and use it as a plugin source.

## Proposed Approach

Add the minimal set of configuration files that Claude Code requires to register this repository as a plugin marketplace and install the "modernization" plugin. The structure follows the pattern established by [microsoft/GitHub-Copilot-for-Azure](https://github.com/microsoft/GitHub-Copilot-for-Azure).

## Reference Architecture

The reference repo uses a two-level plugin structure:

```
repo-root/
├── .claude-plugin/
│   └── marketplace.json        # Marketplace registry (repo-level)
├── plugin/                     # Plugin root (installed by /plugin install)
│   ├── .claude-plugin/
│   │   └── plugin.json         # Plugin metadata
│   ├── .mcp.json               # MCP server configuration (optional)
│   ├── README.md               # Plugin documentation (shown during install)
│   └── skills/                 # Skill definitions
│       ├── _shared/            # Shared rules/references across skills
│       └── <skill-name>/
│           └── SKILL.md        # Skill definition with frontmatter
```

## Target Structure for This Repo

### Files to Create

```
.claude-plugin/
└── marketplace.json            # NEW — Marketplace registry

plugin/
├── .claude-plugin/
│   └── plugin.json             # NEW — Plugin metadata
├── .mcp.json                   # NEW — MCP server config (placeholder)
├── README.md                   # NEW — Plugin documentation
└── skills/                     # EXISTING — Already contains skills
    ├── _shared/                # NEW — Shared rules across skills
    │   └── global-rules.md     # NEW — Global rules for all skills
    ├── appmod-assess/
    │   └── SKILL.md            # EXISTING — No changes
    ├── appmod-plan-create/
    │   └── SKILL.md            # EXISTING — No changes
    └── appmod-plan-execute/
        └── SKILL.md            # EXISTING — No changes
```

### File Specifications

---

#### `.claude-plugin/marketplace.json`

The repo-level marketplace manifest. Tells Claude Code which plugins are available in this repository.

```json
{
    "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
    "name": "github-copilot-modernization",
    "owner": {
        "name": "Microsoft",
        "url": "https://www.microsoft.com"
    },
    "plugins": [
        {
            "name": "modernization",
            "description": "Application modernization skills for assessing, planning, and executing Java and .NET project modernization. Analyze legacy codebases, create migration plans, and apply modernization changes directly from Claude Code.",
            "source": "./plugin",
            "homepage": "https://github.com/microsoft/github-copilot-modernization"
        }
    ]
}
```

**Key decisions:**
- `name`: `"github-copilot-modernization"` — matches the repository name
- `plugins[0].name`: `"modernization"` — the name users reference when running `/plugin install modernization@github-copilot-modernization`
- `plugins[0].source`: `"./plugin"` — points to the plugin root directory

---

#### `plugin/.claude-plugin/plugin.json`

Plugin-level metadata. Describes the installed plugin.

```json
{
    "name": "modernization",
    "description": "Application modernization skills for assessing, planning, and executing Java and .NET project modernization. Analyze legacy codebases, create migration plans, and apply modernization changes directly from Claude Code.",
    "version": "1.0.0",
    "author": {
        "name": "Microsoft",
        "url": "https://www.microsoft.com"
    },
    "homepage": "https://github.com/microsoft/github-copilot-modernization",
    "keywords": ["modernization", "migration", "java", "dotnet", "assessment", "appmod"]
}
```

---

#### `plugin/.mcp.json`

MCP server configuration. This is a **placeholder** — the user will provide specific MCP server details later.

```json
{
    "mcpServers": {}
}
```

> **Note:** This file will be updated once MCP server details are provided. The existing skills reference `Bash(appmod:*)` as allowed tools, suggesting an MCP server or CLI integration is needed.

---

#### `plugin/README.md`

Plugin documentation shown to users during and after installation.

Content should include:
- Brief description of what the plugin provides
- Setup/prerequisites (if any)
- Installation instructions using `/plugin` commands
- Overview of available skills (assess → plan → execute workflow)
- Example usage prompts

---

#### `plugin/skills/_shared/global-rules.md`

Shared rules that apply across all skills. Following the reference repo pattern, this provides cross-cutting concerns like:
- Confirmation required before destructive actions
- Default behavior guidelines
- Common error handling patterns

---

## User Installation Flow

After implementation, users will be able to install the plugin with:

```
# Step 1: Add the marketplace
/plugin marketplace add microsoft/github-copilot-modernization

# Step 2: Install the plugin
/plugin install modernization@github-copilot-modernization

# Step 3: Update the plugin (when new versions are available)
/plugin update modernization@github-copilot-modernization
```

## Existing Skill Updates

The existing SKILL.md files in `plugin/skills/` will be updated to improve skill routing and follow the patterns from the reference repo. The existing skill logic, parameters, and behavior are preserved — only frontmatter metadata and cross-references are improved.

### `appmod-assess/SKILL.md` — Frontmatter Update

Current description:
```
description: Run assessment and generate summary report for Java or .NET projects
```

Updated description:
```
description: "Run assessment and generate summary report for Java or .NET projects. USE FOR: assess project, analyze codebase, modernization assessment, identify migration issues, appmod assess, scan for upgrade problems, evaluate .NET project, evaluate Java project, find legacy dependencies, generate assessment report. DO NOT USE FOR: creating modernization plans (use appmod-create-plan), executing plans (use appmod-run-plan)."
```

Add global-rules reference in the Rules/Steps section.

### `appmod-plan-create/SKILL.md` — Frontmatter Update

Current description:
```
description: Create a modernization plan based on a user prompt for Java or .NET projects
```

Updated description:
```
description: "Create a modernization plan based on a user prompt for Java or .NET projects. USE FOR: create plan, make migration plan, plan modernization, plan upgrade, appmod plan create, design migration strategy, plan .NET upgrade, plan Java migration, containerization plan, Azure migration plan. DO NOT USE FOR: running assessments (use appmod-assess), executing existing plans (use appmod-run-plan)."
```

Add prerequisite note referencing `appmod-assess` and global-rules reference.

### `appmod-plan-execute/SKILL.md` — Frontmatter Update

Current description:
```
description: Execute an existing modernization plan for Java or .NET projects
```

Updated description:
```
description: "Execute an existing modernization plan for Java or .NET projects. USE FOR: run plan, execute plan, apply changes, appmod plan execute, start migration, run modernization, apply upgrade, implement plan, carry out migration. DO NOT USE FOR: running assessments (use appmod-assess), creating new plans (use appmod-create-plan)."
```

Add prerequisite note referencing `appmod-create-plan` and global-rules reference.

## Open Questions

1. **MCP Server Configuration**: The `.mcp.json` is a placeholder. The skills depend on MCP servers, but the specific server names and configuration are TBD. The file will be updated once MCP server details are available.

## Out of Scope

- Tests, CI/CD scripts, token management tooling (can be added later)
- CONTRIBUTING.md with local development setup
- Sensei compliance tooling

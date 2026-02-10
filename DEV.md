# Development Guide

## Local Testing

To test the plugin locally during development:

### 1. Start GitHub Copilot CLI

```bash
copilot
```

### 2. Add the local marketplace

In the Copilot CLI prompt:

```
/plugin marketplace add /path/to/project
```

Or use a relative path from your current directory:

```
/plugin marketplace add .
```

### 3. Install the plugin

```
/plugin install modernization@github-copilot-modernization
```

### 4. Update after making changes

When you modify skill files or configuration:

```
/plugin update modernization@github-copilot-modernization
```

### 5. Test the skills

Try each skill to verify functionality using natural language prompts:

```
Assess the project for modernization
```

```
Create a modernization plan for the project
```

```
Execute the modernization plan
```

## Making Changes

### Skill Files

Skills are located in `plugin/skills/`:
- `modernize-assess/SKILL.md`
- `modernize-plan-create/SKILL.md`
- `modernize-plan-execute/SKILL.md`
- `_shared/global-rules.md`

After editing, run `/plugin update` to reload changes.

### Configuration Files

- `.claude-plugin/marketplace.json` - Marketplace registry
- `plugin/.claude-plugin/plugin.json` - Plugin metadata
- `plugin/.mcp.json` - MCP server configuration

## Troubleshooting

If skills aren't appearing:
1. Verify the marketplace path is correct
2. Check that plugin.json has the correct structure
3. Try removing and re-adding the marketplace
4. Restart Claude Code if necessary

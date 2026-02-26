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

If you are using Claude Code, you'll need to restart Claude Code for the skills to appear as slash commands.

### 4. Update after making changes

When you modify skill files or configuration:

```
/plugin update modernization@github-copilot-modernization
```

Then restart Claude Code to pick up the changes.

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

After editing, run `/plugin update` to reload changes, then restart Claude Code.

### Configuration Files

- `.claude-plugin/marketplace.json` - Marketplace registry
- `plugin/.claude-plugin/plugin.json` - Plugin metadata
- `plugin/.mcp.json` - MCP server configuration

## Troubleshooting

If skills aren't appearing as slash commands:
1. **Restart Claude Code** — skills are registered on startup and won't appear in the `/` menu until the next session
2. Verify the marketplace path is correct
3. Check that plugin.json has the correct structure
4. Try removing and re-adding the marketplace

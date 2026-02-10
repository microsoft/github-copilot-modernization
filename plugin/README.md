# Modernization

Application modernization plugin for [GitHub Copilot CLI](https://github.com/github/copilot-cli) and Claude Code. Assess, plan, and execute Java and .NET project modernization directly from your development environment.

## Setup

### Install the Plugin

```
# Add the marketplace
/plugin marketplace add microsoft/github-copilot-modernization

# Install the plugin
/plugin install modernization@github-copilot-modernization

# Update the plugin
/plugin update modernization@github-copilot-modernization
```

## Available Skills

The plugin provides three skills that work together as a modernization workflow:

### 1. Assess (`modernize-assess`)

Run an assessment on your project to identify modernization opportunities and generate a summary report.

```
Assess my project for modernization
```

### 2. Create Plan (`modernize-create-plan`)

Create a detailed modernization plan based on your specific goals and requirements.

```
Create a plan to upgrade to .NET Core 10
```

### 3. Run Plan (`modernize-run-plan`)

Execute an existing modernization plan to apply the planned changes to your project.

```
Run my modernization plan
```

## Workflow

The recommended workflow is:

1. **Assess** — Analyze your project to understand the current state and identify modernization opportunities
2. **Plan** — Create a modernization plan based on assessment findings and your goals
3. **Execute** — Apply the planned changes to your project

## Example Usage

Ask Copilot CLI or Claude Code to:
- "Assess my Java project for modernization"
- "Create a plan to migrate to Azure App Service"
- "Upgrade my .NET project to .NET 10"
- "Execute the modernization plan"
- "Containerize my application"
- "Scan my project for legacy dependencies"

## Troubleshooting

### Common Issues

- **No project detected**: Ensure you're in a directory containing a Java or .NET project
- **Plan not found**: Run `modernize-assess` and `modernize-create-plan` before executing a plan
- **Command failures**: Check that the `modernize` CLI tool is installed and accessible

# GitHub Copilot Modernization

Application modernization plugin for [GitHub Copilot CLI](https://github.com/github/copilot-cli) and Claude Code. Assess, plan, and execute Java and .NET project modernization directly from your development environment.

## Installation

1. Add the marketplace: `/plugin marketplace add microsoft/github-copilot-modernization`
2. Install the plugin: `/plugin install modernization@github-copilot-modernization`
3. **Restart Claude Code** to make the skills available as slash commands
4. To update later: `/plugin update modernization@github-copilot-modernization`

## Skills

| Skill | Description |
|-------|-------------|
| **modernize-assess** | Run assessment and generate summary report for Java or .NET projects |
| **modernize-create-plan** | Create a modernization plan based on your goals |
| **modernize-run-plan** | Execute an existing modernization plan |

The recommended workflow is: **Assess** → **Plan** → **Execute**

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

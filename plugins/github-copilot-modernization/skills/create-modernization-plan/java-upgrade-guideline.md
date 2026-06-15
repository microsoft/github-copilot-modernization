# Java Upgrade Task Guidelines

Only add an upgrade task if the user explicitly requests it. The upgrade task must be the first task if it exists.

## Latest Stable Versions

- Java: 25
- Spring Boot: 4.x
- Spring Framework: 7.x

## Supported Upgrade Versions

- Java: 11, 17, 21, 25
- Spring Boot: 3.x, 4.x
- Spring Framework: 6.x, 7.x

## Framework Compatibility

| Spring Boot | Spring Framework | Jakarta EE | Minimum Java | Maximum Java |
|-------------|:----------------:|:----------:|:------------:|:------------:|
| 2.x | 5.x | JavaEE (javax.*) | 8 | 11 |
| 3.x | 6.x | Jakarta EE (jakarta.*) | 17 | 21 |
| 4.x | 7.x | Jakarta EE (jakarta.*) | 25 | 25 |

## Upgrade Task Types and Included Changes

| Task Type | Spring Framework Upgrade | Jakarta EE Migration (javax.* → jakarta.*) | JDK/Java |
|-----------|:------------------------:|:------------------------------------------:|:-----------:|
| Spring Boot 4.x upgrade | 7.x | ✓ | 25 |
| Spring Boot 3.x upgrade | 6.x | ✓ | 21 |
| Spring Framework 7.x upgrade | — | ✓ | 25 |
| Spring Framework 6.x upgrade | — | ✓ | 21 |
| Jakarta EE upgrade | — | ✓ | 21 |
| JDK/Java upgrade | — | — | to specified version |

## Java Task Selection Rules

When selecting the Java upgrade task type, follow these rules in order:

- **Rule 1 — No redundant sub-tasks**: Each upgrade type (Spring Boot, Spring Framework, Jakarta EE, JDK/Java) is hierarchical — higher-level tasks already include lower-level ones. Never create a lower-level task that is already covered by a selected higher-level task. For example, if a Spring Boot 4.x upgrade task is selected (which already includes JDK 25), do NOT also create a separate JDK/Java upgrade task.
- **Rule 2 — User-specified framework request doesn't fully match system state**: When the user requests a **framework** upgrade (e.g., Spring Boot, Spring Framework) but the target version they specify is not the latest available, select the highest-level task applicable and prompt the user to clarify. For example, if the user asks to "upgrade Spring Boot to 3.x" but Spring Boot 4.x is available, create a Spring Boot 3.x upgrade task and add a clarification question asking whether they want 4.x. **This rule does NOT apply to pure JDK/Java upgrade requests — see Rule 4.**
- **Rule 3 — User-specified request matches system state**: Select the most closely matching task type that directly matches the user's request and fits the system. For example, if the user asks to "upgrade JDK" and the JDK is outdated, create a JDK/Java upgrade task — NOT a higher-level Spring Boot or Spring Framework upgrade task.
- **Rule 4 — Never upgrade other frameworks on a JDK/Java request**: When the user explicitly requests a JDK/Java upgrade, you MUST NOT upgrade Spring Boot, Spring Framework, or Jakarta EE — create only a JDK/Java upgrade task targeting the user-specified version. If the project's existing Spring Boot, Spring Framework, or Jakarta EE versions are incompatible with the target Java version (per the Framework Compatibility table above), add a clarification question asking the user whether they also want to upgrade the incompatible framework(s) to a compatible version.
- **Rule 5 — Ask for clarification when the selected task diverges from the user's request**: Whenever the task you create differs from what the user explicitly asked for (e.g., upgrading to a different version, choosing a higher-level task type, or skipping a requested change due to compatibility), you MUST use the `ask_user` tool to explain what was selected, why it differs, and ask the user to confirm or adjust. If `ask_user` is not available, add the question to the "## Open Questions" section of `plan.md`. Never silently override the user's intent.
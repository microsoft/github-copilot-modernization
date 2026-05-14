---
name: create-modernization-plan
description: Create a modernization plan to migrate the project to Azure
---

# Create modernization plan

This skill is used to create a modernization plan to migrate the a given project to Azure

## User Input

modernization-prompt: The user input to generate the modernization plan
modernization-work-folder (Mandatory): The folder to save the modernization plan
github-issue-link (Optional): A github issue to track the modernization status, to be filled into plan template
assessment-report (Optional): A assessment report for the project will be modernized, it will provide the data about the project for modernization
plan-name (Optional): The plan name to be filled into plan template
language (Mandatory): The programming language of the project (java or dotnet)

## Supported Task Patterns

Read the supported patterns file based on the language:
- For .NET projects: Read `supported-patterns-dotnet.md`
- For all other projects: Read `supported-patterns-java.md`. Default option.

These files contain the list of supported task patterns with and without skill definitions. If a skill is available, the skill location should be set to `builtin`.

## Workflow

Given the user input, do this:

1. Double Check the issues
   **IMPORTANT**:
   - If you are given an assessment-report, you need to double check if the issue really exist in current project. If not, please ignore this issue when you generate the plan

2. **Load context**: Retrieve information for plan, you can read
    1) Analysis the supported patterns to find the right tasks for the issues
    2) Analysis modernization requirement from user input

3. **Generate plan and tasks**: Generate plan.md and tasks.json using the appropriate templates:

    **Template Selection**:
    - Use **plan-template.md** for code migration, containerization, and deployment tasks
    - Use **infra-plan-template.md** ONLY when user explicitly requests infrastructure (e.g., "prepare infrastructure", "create landing zone", "provision resources", "generate Bicep/Terraform")

    **Plan Generation**:
    1) Follow the structure of the selected template to generate the plan
    2) Follow the rules defined in the template to fill in the sections with relevant information based on the analysis of user input and content of mentioned files
    3) Save the plan in folder ${modernization-work-folder} with the filename plan.md. If a plan already exists, overwrite it.
    4) Generate a separate tasks.json file following the tasks-schema.json schema with all upgrade, transform, infrastructure, containerization, and deployment tasks
    5) Save the tasks in folder ${modernization-work-folder} with the filename tasks.json. If tasks.json already exists, overwrite it.


    **IMPORTANT**: The plan.md should NOT contain the detailed task breakdown. Those details go into tasks.json for better tracking and programmatic access.

    **Task Breakdown Rules**: When creating tasks for tasks.json and plan.md:
    - Purpose: Break down coding work into discrete migration tasks. Each task represents a user-requested migration from one service/component to another, or a specific business logic modernization.
    - Create tasks ONLY based on what the user explicitly requested - do not infer or add implicit tasks
    - Group related changes that serve a single user goal into one task (e.g., all changes needed to migrate to PostgreSQL)
    - If the JDK version is under 17, add task to upgrade the JDK to latest version unless user specified not to do it
    - Find a matched skill / pattern for the task, following the following priority order.
      1. Skills available for the project, which will be listed in the `skill` tool description.
      2. Patterns that will be attached and available at plan execution phase, listed in the supported patterns file.
      3. Otherwise if no relevant pattern is available for the task pattern, use the prompt segment from the user directly. DO NOT expand the request scope.
    - **IMPORTANT**:
      - You MUST NOT use the pattern name as the skill name in the generated plan and tasks.json.
      - If there are similar skills defined in project skill `.github/skills/` versus other skills, MUST use the one defined in project.
      - Skills must be fully matched. For migration scenarios, both the source product and target product must match the task intent.
    - Each task should be independently testable with integration tests
    - Do not add tests for unimpacted code or existing functionality unless user requested
    - **IMPORTANT**: Do NOT read individual skill files at this stage; Do Not include the skill detail in the tasks.

    **Java Upgrade Task Guidelines**: Only add upgrade task if the JDK version is under 17 or user explicitly requested. Upgrade task must be the first task if exists. When creating upgrade tasks for Java projects (current latest versions: Java 17+, Spring Boot 3.x+, Spring Framework 6.x+), create the highest-level upgrade task that encompasses all necessary changes:

    - **Spring Boot 3.x upgrade** (when Java 21+ not explicitly requested):
      - Create a single task: "Upgrade Spring Boot to 3.x"
      - Include in task description: This upgrade includes JDK 17, Spring Framework 6.x, and migration from JavaEE (javax.*) to Jakarta EE (jakarta.*)

    - **Spring Framework 6.x upgrade** (when Java 21+ not explicitly requested and Spring Boot not being upgraded):
      - Create a single task: "Upgrade Spring Framework to 6.x"
      - Include in task description: This upgrade includes JDK 17

    - **Java 21+ upgrade** (when explicitly requested):
      - Create a single task: "Upgrade Java to version X"
      - Include in task description: Specify the target version and related framework impacts

4. **Clarification**: If there are any open issues in the plan
    1) Return all the open issues to user for clarification
    2) After user clarified, update the plan

## Completion Criteria

1. All the open issues are clarified and the plan is updated
2. The modernization task list is built
3. The modernization task list MUST be scoped according to user input
4. DON'T RUN the plan if user does not explicitly ask you to run the plan

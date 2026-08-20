---
name: create-modernization-plan
description: Create a modernization plan to migrate the project to Azure
---

# Create modernization plan

This skill is used to create a modernization plan to migrate the a given project to Azure

## User Input

- modernization-prompt: The user input to generate the modernization plan
- modernization-work-folder (Mandatory): The folder to save the modernization plan
- github-issue-link (Optional): A github issue to track the modernization status, to be filled into plan template
- assessment-report (Optional): A assessment report for the project will be modernized, it will provide the data about the project for modernization
- plan-name (Optional): The plan name to be filled into plan template
- language (Mandatory): The programming language of the project (java or dotnet)

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

3. **Clarification and Questionnaire** (only when the `ask_user` tool is available): If there are any open issues or ambiguities that need user input, use the following steps to answer any questions. Also ask the questions outlined in `questionnaire.md` via `ask_user` tool to scope the modernization plan. For questionnaire questions, if the user input already provides the answer, skip asking that question and use the provided information as the answer.
    1) Use the `ask_user` tool to ask the user each clarification question directly. Wait for the user's response before proceeding.
    2) Record each question and answer for use in the summary step.
    3) If the `ask_user` tool is not available, skip this step entirely and proceed to plan generation using best-effort defaults.

4. **Generate plan and tasks**: Generate plan.md and tasks.json using the appropriate templates:

    **Template Selection**:
    - Use **plan-template.md** for code migration, containerization, and deployment tasks
    - Use **security-plan-template.md** to include a security/CVE remediation task in every modernization plan. 
    - Use **infra-plan-template.md** ONLY when user explicitly requests infrastructure (e.g., "prepare infrastructure", "create landing zone", "provision resources", "generate Bicep/Terraform")

     **Plan Generation**:
    1) Follow the structure of the selected template to generate the plan
    2) Follow the rules defined in the template to fill in the sections with relevant information based on the analysis of user input and content of mentioned files
    3) Save the plan in folder ${modernization-work-folder} with the filename plan.md. If a plan already exists, overwrite it.
    4) Generate a separate tasks.json file following the tasks-schema.json schema with setupBaseline, infrastructure, upgrade, transform, integration test, containerization, and deployment tasks
    5) Save the tasks in folder ${modernization-work-folder}/.metadata/ with the filename tasks.json. If tasks.json already exists, overwrite it.

    **Clarification Outcomes in Plan**: Incorporate all clarification answers from steps 3–4 into `plan.md` and `tasks.json`:
    - Update the relevant task's `requirements` or `description` in `tasks.json` based on the answer. Do NOT create a separate task for an implementation detail—only add a new task when the answer introduces entirely new migration scope.
    - Record all clarification questions and their outcomes in the **"## Open Questions & Questionnaire"** section of `plan.md`:
      - Answered: `- [x] Q: ... → A: ...`
      - Unanswered/skipped: `- [ ] ...`
      - Remove the section entirely if no clarification questions were raised.

    **IMPORTANT**: The plan.md should NOT contain the detailed task breakdown. Those details go into tasks.json for better tracking and programmatic access.

    **Task Breakdown Rules**: When creating tasks for tasks.json and plan.md:
    - Purpose: Break down coding work into discrete migration tasks. Each task represents a user-requested migration from one service/component to another, or a specific business logic modernization.
    - Create tasks ONLY based on what the user explicitly requested - do not infer or add implicit tasks, **except** for the security/CVE remediation task which must always be included in every plan
    - If an `assessment-report` is provided, the task description must identify which specific issues from the assessment report are addressed by that task (e.g., "Addresses issues: <issue-title-1>, <issue-title-2>")
    - Group related changes that serve a single user goal into one task (e.g., all changes needed to migrate to PostgreSQL)
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

    **Integration Test Task Rules**: Add an integration test task when EITHER of these conditions is met:
    1. The user explicitly requests integration testing (e.g., "add integration tests", "generate integration tests", "test the migration")
    2. The user answers the Integration Testing questionnaire question with any option OTHER than "No — skip integration testing entirely" (including when a default option is inferred because an environment is provided/provisioned)

    When an integration test task is included:
    - Add an integration test task with type "integrationTest" after all transform/upgrade tasks but before containerization tasks
    - This integration test task should:
      - Have id format: "{sequence}-integrationTest" where sequence is the next number after the last migration task (e.g., if last migration is 001, use "002-integrationTest")
      - Have description: "Build integration tests for migrated Azure services and run post-migration verification"
      - Have dependencies on ALL of: setupBaseline task ID, infrastructure task ID (if present), and ALL transform/upgrade task IDs. The integrationTest task is the convergence point that waits for all parallel work to complete.
      - Do NOT store resource IDs, subscription IDs, or connection strings in the task plan. If user provides infra info (resource ID, subscription ID, connection strings), record it in `./infra/infra-config.md`.

     **Baseline Task Rules**: A setupBaseline task is **mandatory whenever an integrationTest task is included** in the plan.
     - **Parallel execution**: The setupBaseline task and infrastructure task run in **parallel** with no dependencies between them. The setupBaseline task snapshots the source folder and operates on the snapshot, so it is not affected by concurrent code changes or infra provisioning. Set `snapshotFolder` to the project's main source directory (relative to project root).
     - **Transform/upgrade tasks run sequentially**: Upgrade and transform tasks MUST be chained with dependencies (each depends on the previous one) to avoid file conflicts from concurrent code modifications. However, they run in parallel with setupBaseline and infrastructure since they modify different concerns.
     - **Dependencies**: The setupBaseline task should have NO dependencies (empty `dependencies` array or omit it). Upgrade/transform tasks depend on the previous upgrade/transform task in sequence. Only the `integrationTest` verification task depends on ALL of: setupBaseline, infrastructure (if present), and all transform/upgrade tasks completing.
     - **Purpose**: setupBaseline produces the frozen test specification (test-cases, testdata) and the **infra-decision-table** — the real/mock strategy for every external dependency used by integration tests. This decision is frozen into the baseline bundle and reused as-is by the verification phase.

    **Java Upgrade Task Guidelines**: Only add an upgrade task if the user explicitly requests it. You must refer to the ./java-upgrade-guideline.md for specific rules and guidelines when creating Java upgrade tasks.

    **.NET Upgrade Task Guidelines**: You must refer to the ./dotnet-upgrade-guideline.md for specific rules and guidelines when creating .NET upgrade tasks.

    **Deployment Task Rules**:
    - **IMPORTANT** Do NOT create task type with `containerization`  if deployment task already exists, deployment task will cover the containerization work if needed.
    - Deployment Task Options: Azure App Service, Azure Kubernetes Service, Azure Container Apps (default), Azure App Service Managed Instance, Azure Static Web App, Azure Function App

    **Security Task Guidelines**: The security task order should be after all the upgrade and transform tasks and before the deployment tasks in the generated plan. If the user provides specific security requirements, incorporate them into the security task; otherwise, use the default requirements from the template.

    **IMPORTANT**: The upgrade task must be the first task in the task list because subsequent transform tasks (e.g., migrating to Azure services) depend on the upgraded runtime and project format.

5. **Rulebook Compliance Validation** (only when rulebook attachments are present):
   After generating the plan and tasks, call skill `validate-rulebook-compliance` to validate that the plan tasks cover the rulebook rules:
   - tasks-json-path: `${modernization-work-folder}/.metadata/tasks.json`
   - compliance-output-path: `${modernization-work-folder}/rulebook-compliance.md`
   - This validation is **best-effort only** and must **not** block or fail plan creation.
   - If the validation call cannot run, fails, or required context/attachments are missing, you must still complete the workflow and emit `${modernization-work-folder}/plan.md` and `${modernization-work-folder}/.metadata/tasks.json`.
   - If validation cannot be completed successfully, write a minimal warning/status report to `${modernization-work-folder}/rulebook-compliance.md` explaining that validation was skipped or failed and why, if known.

6. **Summary & Confirmation** (only when the `ask_user` tool is available):
    1) Present a summary to the user via `ask_user` that includes:
       - All clarification questions and the user's answers (if any were asked in step 3)
       - The planned task list with key details for each task: task name, type, matched skill/pattern, and a brief description of what it will do
       - The supported task type in task-schema.json but not listed in the planned task list but matched with the user requirement, ask the user if they want to include those tasks in the plan or not.
    2) Ask the user to confirm the summary is correct, or provide additional input to adjust any answers or task list.
    3) If the user provides additional input, incorporate the changes. If the user chooses to skip or confirms, proceed to plan generation.
    4) If the `ask_user` tool is not available, skip this step entirely.

## Completion Criteria

1. All clarification & questionnaire questions have been asked (or skipped with defaults) via `ask_user`, answers incorporated into `plan.md` and `tasks.json`, and outcomes recorded in the "## Open Questions & Questionnaire" section of `plan.md`
2. The modernization task list is built
3. The modernization task list MUST be scoped according to user input
4. DON'T RUN the plan if user does not explicitly ask you to run the plan
5. The generated plan.md and tasks.json are saved in the specified folder `${modernization-work-folder}`

# Infrastructure Plan Template

Use this template when user explicitly requests infrastructure preparation (e.g., "prepare infrastructure", "create landing zone", "provision resources", "generate Bicep/Terraform/IaC files").

---

# Infrastructure Plan: [Plan Title]

## User Requirements

[A concise summary of the user's inputs, requirements and preferences for the infrastructure, may include: project codes, assessment report, architecture diagram]

**Plan Configuration**:

| Parameter | Value | Description |
|-----------|-------|-------------|
| IaC Tool | [bicep (default) / terraform] | Infrastructure as Code tool |
| Provision | [true (default) / false] | Whether to provision resources after generating IaC |
| Subscription | [Azure subscription ID] | Target Azure subscription |

---

## Proposed Architecture

[A high-level text diagram illustrating the proposed Azure resource architecture that meets the user's requirements]

---

## Azure Resource List
A complete list of Azure resources to be generated.

| Resource Type | Resource Name | SKU | Purpose |
|---------------|---------------|-----|---------|
| [e.g., SQL Database] | [e.g., sqldb-myapp-prod] | [e.g., S1] | [Purpose] |

---

## Task

**Description**: Generate IaC files to provision the required Azure resources.

**Output**: ./infra/

**Skill**: [infrastructure-bicep-generation | infrastructure-terraform-generation]

**Success Criteria**:
- IaC files generated and validated
- Resources provisioned successfully (if Provision=true)

---

## Clarifications

[Optional: Only list the most critical items that MUST be confirmed before provisioning. Keep it minimal.]

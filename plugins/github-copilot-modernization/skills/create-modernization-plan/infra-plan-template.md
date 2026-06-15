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
A complete list of Azure resources to be generated. Use `#appmod-get-azure-pricing` to retrieve pricing information for each resource.

| Resource Type | Resource Name | SKU | Est. Monthly Cost | Purpose |
|---------------|---------------|-----|--------------------|---------|
| [e.g., SQL Database] | [e.g., sqldb-myapp-prod] | [e.g., S1] | [e.g., $25/mo] | [Purpose] |

> **Note**: The estimated costs shown above are based on Azure retail prices and serve only as a rough estimation. Actual costs may differ due to enterprise agreements, reservations, or other discounts. For consumption-based (pay-as-you-go) resources, costs depend on actual usage and cannot be accurately estimated upfront.

---

## Task

**Description**: Generate IaC files to provision the required Azure resources.

**Output**: Files of infrastructure as code

**Skill**: [infrastructure-bicep-generation | infrastructure-terraform-generation]

**Success Criteria**:
- IaC files generated and validated
- Resources provisioned successfully (if Provision=true)

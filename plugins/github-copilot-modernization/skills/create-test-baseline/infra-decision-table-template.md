# Infra Decision Table

> This document is part of the **frozen baseline bundle**. It records, for every external dependency the migrated application talks to, whether the post-migration tests will exercise it as a **real** provisioned resource, a **testcontainer**-backed emulator/dependency, or a **mock** at the SDK / HTTP boundary. The decision is made once here and reused as-is by the `verify-test-baseline` skill.

## Metadata

| Field | Value |
|-------|-------|
| Project | [Application name] |
| Module | [e.g. `web`, `worker`] |
| Migration Scope | [e.g. migrate from AWS S3 + SQS to Azure Blob Storage + Service Bus] |
| Integration Test Environment | [real \| mock \| testcontainer \| mixed] |
| Created At | [YYYY-MM-DD] |
| `infra/` Snapshot | [git SHA or "infra-missing" if no infra folder] |
| Status | baseline (frozen) |

## Decision Table

One row per external dependency. The dependency list is derived from the target stack and the entry-point inventory in `test-cases.md` (Step 1 of `create-test-baseline`). No dependency the application talks to may be omitted.

| Dependency | Infra Match | Decision | Auth Method | Reason |
|---|---|---|---|---|
| [Dependency name + identifier, e.g. `Azure Blob Storage (sthve4rw7qkv7k4)`] | [`Yes — <path/in/infra>` \| `No`] | [`real` \| `testcontainer` \| `mock`] | [see allowed values below] | [Single sentence; see rules below] |

### Required column values

- **Dependency** — Name the concrete resource the application binds to, including its identifier when applicable (account / namespace / database / topic name). Generic categories alone (e.g. "object storage") are not acceptable.
- **Infra Match** — Exactly one of:
  - `Yes — <relative path under infra/>` when a provisioned endpoint + credentials are documented in `infra/`.
  - `No` when no matching resource exists in `infra/` (or `infra/` does not exist at all).
- **Decision** — Exactly one of `real`, `testcontainer`, or `mock`. No conditional values, no per-test-case overrides in this column.
- **Auth Method** — How the application authenticates to this dependency at runtime. Exactly one of:
  - `managed-identity` — workload identity issued by the hosting cloud platform.
  - `service-principal` — client-id with secret/certificate/federated credential.
  - `username-password` — DB/basic auth user credential.
  - `connection-string` — secret-bearing connection string.
  - `emulator-connection-string` — local emulator/container connection string (testcontainer mode).
  - `sas-token` — scoped shared access token/signature.
  - `api-key` — static key or out-of-band bearer token.
  - `mtls` — mutual TLS/client certificate.
  - `anonymous` — no authentication.
  - `n/a` — only when `Decision = mock`.

  Rules: use `managed-identity` only for deployments on identity-issuing cloud hosts; record the **post-migration** auth method only.
- **Reason** — One sentence. Must justify the Decision against the Infra Match per the rules below.

### Testcontainer support reference

**Has emulator — can use `testcontainer`:**

| Dependency type | Emulator image | Dependencies | Auth method |
|---|---|---|---|
| Azure Blob / Queue / Table Storage | `mcr.microsoft.com/azure-storage/azurite` | None | `emulator-connection-string` |
| Azure Service Bus | `mcr.microsoft.com/azure-messaging/servicebus-emulator` | Companion MSSQL container + JSON config file | `emulator-connection-string` |
| Azure Event Hubs | `mcr.microsoft.com/azure-messaging/eventhubs-emulator` | Companion Azurite container + JSON config file | `emulator-connection-string` |
| Azure Cosmos DB | `mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator` | None (requires SSL trust-store setup) | `connection-string` (endpoint + emulator key) |
| Azure SQL Database | `mcr.microsoft.com/mssql/server` | None | `username-password` |
| PostgreSQL / MySQL | `postgres`, `mysql` | None | `username-password` |
| Redis / MongoDB / RabbitMQ / Kafka | standard community images | None | varies |

> **Cosmos DB:** If SSL trust-store setup is too complex, mark `mock` with reason `no-testcontainer-emulator`.  
> **Service Bus / Event Hubs:** AMQP send/receive only — management/REST APIs are not supported by the emulators.

**No emulator — must use `mock`:**

| Dependency type |
|---|
| Azure Key Vault |
| Azure App Configuration |
| Azure Active Directory / Entra ID |
| Azure AI / Cognitive Services |
| Third-party / external HTTP APIs |

### Decision rules (must match Step 5 of `create-test-baseline`)

- If `Integration Test Environment = mock`: every row's Decision MUST be `mock` regardless of `Infra Match`.
- If `Integration Test Environment = real`: `Infra Match = Yes` → Decision MUST be `real`.
- If `Integration Test Environment = real` and `Infra Match = No` while `infra/` exists: Decision MUST be `mock`. Reason should state that the dependency is not provisioned.
- If `Integration Test Environment = testcontainer`: use `testcontainer` when a viable emulator/container strategy exists for that dependency.
- If `Integration Test Environment = testcontainer` and no viable emulator/container strategy exists: Decision MUST be `mock` and Reason should include `no-testcontainer-emulator`.
- If `Integration Test Environment = mixed`: apply the `real`, `testcontainer`, or `mock` rules above per row according to the user-specified per-dependency decision.
- `infra/` does not exist at all and mode is not `testcontainer` → every row's Decision is `mock` and the Reason is `infra-missing`. Set the `infra/` Snapshot field to `infra-missing`.
- `Auth Method = n/a` is allowed **only** when `Decision = mock`. `real` and `testcontainer` rows must declare a concrete auth method.

### Banned phrasings (auto-reject)

- Decision values other than `real` / `testcontainer` / `mock` (e.g. `mostly real`, `real-with-fallback`, `tbd`).
- Auth Method values outside the allowed list above. Free-form descriptions (e.g. "DefaultAzureCredential", "whatever the SDK picks") are not acceptable — pick the concrete underlying credential type instead.
- Auth Method = `n/a` on a `real` or `testcontainer` row.
- Reasons that do not reference decision evidence (`infra/`, `infra-missing`, or testcontainer emulator/container evidence).
- Per-test-case carve-outs ("real for happy-path, mock for failure"). Failure-injection conflicts are handled in `verify-test-baseline` Step 4 via a re-freeze, not by splitting a row here.
- Missing or empty cells.

## Worked Example (reference; do not copy verbatim)

| Dependency | Infra Match | Decision | Auth Method | Reason |
|---|---|---|---|---|
| Azure Blob Storage (`sthve4rw7qkv7k4`, container `assets`) | Yes — `infra/env-config.md` | real | managed-identity | Provisioned storage account with container `assets` in resource group `rg-app-demo`. |
| Azure Service Bus (`sbemulatorns`, queue `image-processing`) | No | testcontainer | emulator-connection-string | Using Service Bus emulator container configuration for local verification; no matching provisioned namespace selected for this run. |
| Azure Service Bus (`sbhve4rw7qkv7k4`, queue `image-processing`) | Yes — `infra/env-config.md` | real | managed-identity | Provisioned namespace with queue `image-processing` in resource group `rg-app-demo`. |
| Azure Database for PostgreSQL (`pg6kt67kwkpeqji2`, database `app`) | Yes — `infra/env-config.md` | real | managed-identity | Provisioned flexible server with database `app`; migration moves from password to managed identity. |
| Third-party email API (`api.example-mail.com`) | No | mock | n/a | No provisioned credentials in `infra/`; mock at the HTTP boundary, seed from `testdata/`. |

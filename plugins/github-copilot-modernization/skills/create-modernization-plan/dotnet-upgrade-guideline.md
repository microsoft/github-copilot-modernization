# .NET Upgrade Task Guidelines

Only add a .NET upgrade task if one of the following conditions is met:

1. **End of Life (EOL)**: The project's .NET version is out of mainstream support.
2. **Azure SDK Compatibility**: The project targets a .NET Framework version older than 4.6.2, which does not support `netstandard2.0` and cannot use modern Azure SDK (`Azure.*`) packages.
3. **User Request**: The user explicitly requests a .NET version upgrade.

The upgrade task must be the first task if it exists.

### Target Version

Always upgrade to the **latest LTS** version unless the user explicitly specifies a different target version.

- Current latest LTS: **.NET 10** (`net10.0`)

### Azure SDK Minimum .NET Version

The modern Azure SDK for .NET (`Azure.*` packages) targets `netstandard2.0` as its baseline. The following .NET Framework versions do **not** support `netstandard2.0` and require an upgrade:

| .NET Framework Version | `netstandard2.0` Support | Action |
|------------------------|:------------------------:|--------|
| 4.5 and below | ❌ | Upgrade required |
| 4.6 | ❌ | Upgrade required |
| 4.6.1 | ⚠️ Unreliable | Upgrade recommended |
| 4.6.2+ | ✅ | No upgrade needed for Azure SDK compatibility |

> **Note**: .NET Framework 4.6.1 is technically listed as supporting `netstandard2.0` but has known issues. Microsoft recommends 4.7.2+ for reliable support. The Azure SDK explicitly targets `net462` as its minimum.

## Framework Compatibility

| Source Framework | Target Framework | SDK-Style Conversion Required |
|-----------------|:----------------:|:----------------------------:|
| .NET Framework 4.x | net10.0 | Yes |
| .NET Core 3.1 | net10.0 | No |
| .NET 5–9 | net10.0 | No |

## .NET Task Selection Rules

- **Rule 1 — Single task only**: Always create a **single** upgrade task that encompasses all necessary changes. The `modernize-dotnet-upgrade-engineer` agent handles the detailed breakdown during execution.
- **Rule 2 — EOL or Azure SDK incompatibility**: Create task "Upgrade .NET to latest LTS (net10.0)". Set the task `skills` array to `[]` (empty) — the upgrade agent handles execution internally.
- **Rule 3 — User-specified version**: Create task "Upgrade .NET to version X". Set the task `skills` array to `[]` (empty) — the upgrade agent handles execution internally.
- **Rule 4 — No upgrade needed**: If the project's .NET version is in support **and** the project targets .NET Framework 4.6.2+ (or any .NET Core / modern .NET) **and** the user did not request an upgrade, do **not** add an upgrade task.
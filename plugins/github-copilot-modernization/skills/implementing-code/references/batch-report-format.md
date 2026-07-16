# Batch Result Report Format

The implementing-code skill MUST return this structured YAML report for the orchestrator.

```yaml
batch_id: "B01"
completed_tasks: ["T001", "T002", "T003"]
blocked_tasks:
  - task_id: "T004"
    reason: "Depends on T010 which is not in this batch"
    required_task_ids: ["T010"]
files_changed:
  T001:
    - file: "path/to/file"
      change_type: "created | modified | deleted"
      description: "Brief description of change"
  T002:
    - file: "path/to/another-file"
      change_type: "modified"
      description: "Brief description of change"
# Role-neutral upstream artifact consumption (required when dependency artifacts exist)
upstream_artifacts_consumed:
  T001:
    - artifact: "artifacts/t1-architect-wire-contracts.md"
      used_for: "HTTP endpoint contracts and JSON response keys"
    - artifact: "artifacts/units/request_action/behavior.yaml"
      used_for: "request form branches and save side effects"
evidence_mapping:
  T001:
    - upstream: "artifacts/t1-architect-wire-contracts.md#POST /saverequest"
      output: "src/main/java/.../RequestController.java#saveRequest"
      evidence: "RequestControllerTest#saveRequest_*"
    - upstream: "artifacts/units/request_action/behavior.yaml#branches"
      output: "src/main/java/.../RequestController.java"
      evidence: "branch tests pass"
# Source-anchored traceability (rewrite mode only)
source_references:
  T001:
    source_files:
      - file: "src/main/java/com/example/ProductAction.java"
        methods_read: ["list", "execute"]
    branches_preserved: 5
    validations_preserved: 2
    error_paths_preserved: 3
    side_effects_preserved: 1
    notes: "Discovered inventory check not in BL inventory"
traceability:
  - requirement: "REQ-XXX"
    plan_item: "X.Y"
    task: "T001"
    files: ["path/to/file"]
    source_files: ["path/to/original/source"]  # rewrite mode
    status: "completed"
protocol_violation: false
errors: []
warnings: []
test_results:
  T001:
    command: "test command used"
    passed: 41
    failed: 0
    skipped: 0
    failures: []
  T002:
    command: "test command used"
    passed: 36
    failed: 1
    skipped: 0
    failures: ["com.example.SomeTest#testMethod"]
```

## Field Descriptions

| Field | Required | Description |
|-------|----------|-------------|
| `batch_id` | Yes | Batch identifier (e.g., "B01") |
| `completed_tasks` | Yes | List of task IDs successfully completed |
| `blocked_tasks` | Yes | Tasks that couldn't run due to unmet dependencies |
| `files_changed` | Yes | Per-task list of files created/modified/deleted |
| `upstream_artifacts_consumed` | When dependency artifacts exist | Upstream artifacts read by each task and what each was used for |
| `evidence_mapping` | When dependency artifacts exist | Upstream artifact contract/row/section → this task's output and verification evidence |
| `source_references` | Rewrite mode | Source-anchored traceability: files read, branches/validations/errors/side-effects preserved |
| `traceability` | Yes | REQ → Plan → Task → Files mapping |
| `protocol_violation` | Yes | Whether any constitution principle was violated |
| `errors` / `warnings` | Yes | Runtime issues encountered |
| `test_results` | Yes | Test execution summary: command used, pass/fail/skip counts, and list of failing test names |

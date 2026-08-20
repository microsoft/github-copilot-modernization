# Test Cases

> This document is the **frozen behavioral specification** of a single module's external surface for the migration in scope. It is the source of truth that the `verify-test-baseline` skill uses to generate `*PostMigrationIT` tests against the new implementation. No test code is generated in the baseline phase.
>
> **Scoping rule:** This file MUST contain only test cases whose entry points belong to the module named below. Test cases for entry points in other modules belong in those modules' own `test-cases.md`. Modules that do not directly access any migration-relevant resource are out of scope and do not get a `test-cases.md` at all.

## Metadata

| Field | Value |
|-------|-------|
| Project | [Application name] |
| Module | [e.g. `web`, `worker` — the single module this file covers] |
| Migration Scope | [e.g. migrate from AWS S3 + SQS to Azure Blob Storage + Service Bus] |
| Created At | [YYYY-MM-DD] |
| Status | baseline (frozen) |
| Testing Conventions | [e.g. JUnit 5, AssertJ; naming: `should_<action>_when_<condition>`; one test class per controller] |

## Existing Test Coverage

List entry points already covered by existing integration tests. These are NOT duplicated as new test cases below.

| Entry Point | Existing Test (FQ name) | Categories Covered |
|---|---|---|
| `POST /api/files/upload` | `com.example.FileControllerIT#should_upload_file_successfully` | happy-path |
| … | … | … |

> Remove this section if no existing integration tests exist.

## Entry-Point Inventory

List every external boundary / orchestration entry point covered below. Cross-checked by Step 6 of the create-test-baseline skill.

| Entry Point | Type | Source (file:symbol) | Covered by |
|---|---|---|---|
| `POST /api/files/upload` | HTTP | `web/.../FileController.java:upload` | existing: `FileControllerIT`, TC-WEB-002 |
| `processImage(ImageProcessingMessage)` on queue `image-processing` | Message-queue listener | `worker/.../ImageProcessor.java:processImage` | TC-WKR-001, TC-WKR-004 |
| … | … | … | … |

Entry-point types: `HTTP`, `CLI`, `Scheduled`, `In-process event`, `Message-queue listener`, `Webhook`, `Streaming`, `Public method`.

## Test Case Format

Every test case MUST populate **all required fields below**. Use the worked example as the canonical shape. Any vague phrasing (see "Banned phrasings" in the skill) is a defect and must be fixed before freezing.

---

### Worked Example — TC-WKR-001 (reference; do not copy verbatim)

| Field | Value |
|-------|-------|
| ID | TC-WKR-001 |
| Category | happy-path |
| Entry Point Type | Message-queue listener |
| Entry Point | Listener bound to queue `image-processing`, consuming `ImageProcessingMessage` |
| Description | A valid JPEG referenced by an incoming message is downloaded, a 600px-bounded thumbnail is produced, and metadata is updated. |

**Trigger**

Publish one message to queue `image-processing` with body:

```json
{
  "key": "<random-uuid>-sample.jpg",
  "contentType": "image/jpeg",
  "storageType": "<configured-storage-type>",
  "size": 12345
}
```

(`size` = byte length of `testdata/inputs/sample.jpg`.)

**Preconditions**

- Object with key `<random-uuid>-sample.jpg` exists in the storage container, content byte-identical to `testdata/inputs/sample.jpg`, content-type `image/jpeg`.
- A row exists in `image_metadata` with `key = <random-uuid>-sample.jpg`, `thumbnail_key` NULL.

**Expected Response**

`none (fire-and-forget)` — the listener acknowledges the message after successful processing; no synchronous response is observable.

**Resource Verification**

- An object with key `<random-uuid>-sample_thumbnail.jpg` exists in the storage container with content-type `image/jpeg`.
- That thumbnail object is a readable image whose `max(width, height) <= 600`, and the aspect ratio matches the original (`testdata/inputs/sample.jpg`) within ±1 pixel.
- The row in `image_metadata` with `key = <random-uuid>-sample.jpg` has `thumbnail_key = <random-uuid>-sample_thumbnail.jpg` and `thumbnail_url` non-null.
- No additional rows are created in `image_metadata`.

**Negative Verification**

- No message is published to any downstream queue.
- No row is created in `image_metadata` with `key != <random-uuid>-sample.jpg`.

**Data References**

- `testdata/inputs/sample.jpg`

---

## Test Cases

### [TC-XXX-NNN] [Operation Name] — [Category Title]

| Field | Value |
|-------|-------|
| ID | TC-XXX-NNN |
| Category | [happy-path \| boundary \| special-input \| failure] |
| Entry Point Type | [HTTP \| CLI \| Scheduled \| In-process event \| Message-queue listener \| Webhook \| Streaming \| Public method] |
| Entry Point | [Exact identifier from production code — HTTP method+path, FQ method, CLI command, queue/topic name] |
| Description | [One sentence: what externally observable behavior this case pins down] |

**Trigger**

[Concrete invocation. For HTTP: method, path, headers, body (reference a `testdata/inputs/*.json` file when non-trivial). For CLI: full argv and stdin. For listener: queue/topic name and message body. Sufficient detail for a code generator to construct the call without further interpretation.]

**Preconditions**

- [Each prerequisite as a bullet. Reference `testdata/seed-data/*` for any seeded state. Use `none` only if literally nothing.]

**Expected Response**

[Synchronous return at the entry point. HTTP: status + body file reference. CLI: exit code + stdout/stderr references. Method: return value. Listener: `none (fire-and-forget)` is acceptable.]

**Resource Verification**

- [Each post-condition as a bullet. Name the resource (object key, table+PK, queue name + message shape) and the observable state. Resource-neutral phrasing.]
- [`none` allowed only when the operation provably touches no external resource; explain why in one phrase.]

**Negative Verification**

- [Required for `failure` cases and any "skip / no-op" behavior. State what MUST NOT happen, naming the resource.]
- [Omit this section ONLY for pure `happy-path` cases where no plausible side-effect-leak risk exists.]

**Data References**

- [Every `testdata/...` path referenced above, listed here for the freeze audit.]

---

### [TC-XXX-NNN+1] …

(Repeat for every test case. Cover all four categories per entry point.)

---

## Required Field Checklist (Freeze Gate)

Before marking this document frozen, every test case above MUST satisfy every row. Tick when validated.

- [ ] **ID** unique, formatted `TC-<MODULE>-<NNN>`.
- [ ] **Category** is one of `happy-path`, `boundary`, `special-input`, `failure`.
- [ ] **Entry Point Type** matches one of the catalog types.
- [ ] **Entry Point** is an exact production-code identifier (no vague references).
- [ ] **Trigger** is concrete enough to construct the call mechanically (payload referenced by file, headers/argv enumerated, queue/topic named).
- [ ] **Preconditions** enumerated (or `none`); all referenced seed data exists under `testdata/`.
- [ ] **Expected Response** specifies exact status / exit code / return shape (or `none (fire-and-forget)`).
- [ ] **Resource Verification** has at least one bullet OR explicit `none` with justification; each bullet names a specific resource and the observable state.
- [ ] **Negative Verification** present for every `failure` case and every "skip / no-op" outcome.
- [ ] **Data References** complete; every path exists under `testdata/`.

## Coverage Gate

- [ ] Every entry point in the **Entry-Point Inventory** appears as the `Entry Point` of at least one `happy-path` case.
- [ ] Every entry point in the **Entry-Point Inventory** appears as the `Entry Point` of at least one `failure` case.
- [ ] Each entry point covers all four buckets where applicable: `happy-path`, `boundary`, `special-input`, `failure`.
- [ ] Entity examples use 2–5 representative records (no single-row, no exhaustive enumeration).

## Banned Phrasings (Auto-Reject)

If any of the following appears in a test case, it is a defect — fix before freezing:

- "should return a reasonable error" → state exact status + body.
- "behaves as expected" / "works correctly" → state observable outcome.
- "approximately N items" → state exact count or precise range with bound semantics.
- "etc." / "and so on" in expected outputs → enumerate completely.
- "data is persisted" / "state is updated" without naming the resource and field-level state.
- Service-specific SDK types (`S3Object`, `BlobClient`, `SqsMessage`, …) in any field — describe in resource-neutral terms instead.

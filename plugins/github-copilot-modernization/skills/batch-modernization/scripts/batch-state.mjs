import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { sanitizeGitUrl } from "./resolve-repos.mjs";
import { validateSchema } from "./schema-validator.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const stateSchemaPath = path.resolve(scriptRoot, "..", "schemas", "batch-state.schema.json");
const eventSchemaPath = path.resolve(scriptRoot, "..", "schemas", "event.schema.json");
const stateSchema = JSON.parse(fs.readFileSync(stateSchemaPath, "utf8"));
const eventSchema = JSON.parse(fs.readFileSync(eventSchemaPath, "utf8"));

export class BatchStateError extends Error {
  constructor(message, code = "batch_state_error") {
    super(message);
    this.name = "BatchStateError";
    this.code = code;
  }
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fsyncDirectory(directory) {
  try {
    const descriptor = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    // Windows can reject directory fsync; the file itself is still flushed.
  }
}

export function atomicWriteFile(filePath, content) {
  const absolutePath = path.resolve(filePath);
  const directory = path.dirname(absolutePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const descriptor = fs.openSync(temporaryPath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporaryPath, absolutePath);
    fsyncDirectory(directory);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function atomicWriteJson(filePath, value) {
  atomicWriteFile(filePath, jsonText(value));
}

function writeExclusiveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, jsonText(value), "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(filePath));
}

function createExclusiveEmptyFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(filePath));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ownerDigest(ownerToken) {
  return `sha256:${sha256(ownerToken)}`;
}

function pathsFor(batchRoot) {
  const root = path.resolve(batchRoot);
  return {
    root,
    manifest: path.join(root, "manifest.json"),
    lease: path.join(root, "lease.json"),
    takeoverLock: path.join(root, ".takeover.lock"),
    state: path.join(root, "state.json"),
    events: path.join(root, "events.jsonl"),
    summaryJson: path.join(root, "summary.json"),
    summaryMarkdown: path.join(root, "summary.md"),
    repos: path.join(root, "repos"),
    attempts: path.join(root, "attempts"),
  };
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new BatchStateError(`Unable to read ${label}: ${error.message}`, "invalid_json");
  }
  if (parsed?.schemaVersion !== 1) {
    throw new BatchStateError(
      `Unsupported ${label} schemaVersion: ${JSON.stringify(parsed?.schemaVersion)}`,
      "unsupported_schema",
    );
  }
  return parsed;
}

function walkStrings(value, visit) {
  if (typeof value === "string") {
    visit(value);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => walkStrings(entry, visit));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => walkStrings(entry, visit));
  }
}

function findSecretKeys(value, currentPath = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findSecretKeys(entry, `${currentPath}[${index}]`)));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const entryPath = `${currentPath}.${key}`;
      if (
        /(?:password|passwd|token|secret|credential|api[-_]?key|access[-_]?key)$/i.test(key)
        && entry !== "<redacted>"
        && entry !== null
      ) {
        findings.push(entryPath);
      } else {
        findings.push(...findSecretKeys(entry, entryPath));
      }
    }
  }
  return findings;
}

export function assertSafePersistedValue(value) {
  const secretKeys = findSecretKeys(value);
  if (secretKeys.length > 0) {
    throw new BatchStateError(
      `Persisted batch values must not contain credential fields: ${secretKeys.join(", ")}`,
      "unsafe_persisted_value",
    );
  }
  walkStrings(value, (text) => {
    const urls = text.match(/(?:https?|ssh):\/\/[^\s'"<>]+/gi) ?? [];
    for (const candidate of urls) {
      let parsed;
      try {
        parsed = new URL(candidate);
      } catch {
        continue;
      }
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new BatchStateError("Persisted batch values must not contain URL credentials, query, or fragment", "unsafe_persisted_value");
      }
      try {
        sanitizeGitUrl(candidate);
      } catch {
        // Non-Git HTTPS strings are allowed when they have no secret-bearing components.
      }
    }
  });
}

function assertDocumentSchema(value, schema, schemaPath, label) {
  const errors = validateSchema(value, schema, schemaPath);
  if (errors.length > 0) {
    throw new BatchStateError(
      `${label} violates its v1 schema: ${errors.join("; ")}`,
      "schema_validation_failed",
    );
  }
}

export function initializeBatch({ batchRoot, manifest, state, now = new Date().toISOString() } = {}) {
  const files = pathsFor(batchRoot);
  fs.mkdirSync(files.root, { recursive: true });
  fs.mkdirSync(files.repos, { recursive: true });
  fs.mkdirSync(files.attempts, { recursive: true });
  const existingControlFile = [
    files.manifest,
    files.state,
    files.events,
    files.lease,
    files.summaryJson,
    files.summaryMarkdown,
  ].find((filePath) => fs.existsSync(filePath));
  if (existingControlFile) {
    throw new BatchStateError(
      `Batch control file already exists: ${path.basename(existingControlFile)}`,
      "batch_exists",
    );
  }
  const persistedManifest = { ...manifest, schemaVersion: 1 };
  assertSafePersistedValue(persistedManifest);
  const persistedState = {
    schemaVersion: 1,
    batchId: persistedManifest.batchId,
    status: "draft",
    revision: 0,
    createdAt: now,
    updatedAt: now,
    activeLeaseDigest: null,
    executionUnits: [],
    progress: { wave: 1, eligible: 0, terminal: 0, successful: 0, issues: 0, failed: 0 },
    ...state,
    schemaVersion: 1,
    batchId: persistedManifest.batchId,
  };
  if (persistedState.batchId !== persistedManifest.batchId) {
    throw new BatchStateError("Manifest and state batch IDs must match", "batch_id_mismatch");
  }
  assertSafePersistedValue(persistedState);
  assertDocumentSchema(persistedState, stateSchema, stateSchemaPath, "Batch state");
  try {
    writeExclusiveJson(files.manifest, persistedManifest);
    atomicWriteJson(files.state, persistedState);
    if (!fs.existsSync(files.events)) createExclusiveEmptyFile(files.events);
  } catch (error) {
    fs.rmSync(files.manifest, { force: true });
    fs.rmSync(files.state, { force: true });
    fs.rmSync(files.events, { force: true });
    throw error;
  }
  return { manifestPath: files.manifest, statePath: files.state };
}

function writeLeaseExclusive(leasePath, lease) {
  try {
    writeExclusiveJson(leasePath, lease);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new BatchStateError("Batch lease is already held", "lease_held");
    }
    throw error;
  }
}

export function acquireLease({ batchRoot, invocationId, now = new Date().toISOString() } = {}) {
  const files = pathsFor(batchRoot);
  readJson(files.manifest, "batch manifest");
  readJson(files.state, "batch state");
  const ownerToken = crypto.randomBytes(32).toString("base64url");
  const lease = {
    schemaVersion: 1,
    ownerTokenDigest: ownerDigest(ownerToken),
    acquiredAt: now,
    lastHeartbeat: now,
    invocationId,
    schedulingAllowed: true,
    takeoverOf: null,
  };
  writeLeaseExclusive(files.lease, lease);
  return { ownerToken, lease, leaseFileDigest: fileDigest(files.lease) };
}

export function fileDigest(filePath) {
  return `sha256:${sha256(fs.readFileSync(filePath))}`;
}

export function readLease(batchRoot) {
  const leasePath = pathsFor(batchRoot).lease;
  if (!fs.existsSync(leasePath)) return null;
  const lease = readJson(leasePath, "lease");
  return { ...lease, leaseFileDigest: fileDigest(leasePath) };
}

export function assertLeaseOwner(batchRoot, ownerToken) {
  if (!ownerToken) throw new BatchStateError("Owner token is required", "owner_token_required");
  const lease = readLease(batchRoot);
  if (!lease) throw new BatchStateError("Batch lease is not held", "lease_missing");
  const supplied = Buffer.from(ownerDigest(ownerToken));
  const expected = Buffer.from(lease.ownerTokenDigest);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new BatchStateError("Owner token does not match the active lease", "owner_token_mismatch");
  }
  return lease;
}

function withExclusiveLock(lockPath, action) {
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new BatchStateError("Another lease mutation is in progress", "lease_mutation_locked");
    }
    throw error;
  }
  try {
    return action();
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lockPath, { force: true });
  }
}

export function heartbeatLease({ batchRoot, ownerToken, now = new Date().toISOString() } = {}) {
  const files = pathsFor(batchRoot);
  return withExclusiveLock(files.takeoverLock, () => {
    const lease = assertLeaseOwner(batchRoot, ownerToken);
    const updated = { ...lease, lastHeartbeat: now };
    delete updated.leaseFileDigest;
    atomicWriteJson(files.lease, updated);
    return updated;
  });
}

export function releaseLease({ batchRoot, ownerToken } = {}) {
  const files = pathsFor(batchRoot);
  return withExclusiveLock(files.takeoverLock, () => {
    assertLeaseOwner(batchRoot, ownerToken);
    fs.rmSync(files.lease);
    fsyncDirectory(files.root);
    return { released: true };
  });
}

export function takeoverLease({
  batchRoot,
  expectedLeaseDigest,
  invocationId,
  now = new Date().toISOString(),
} = {}) {
  const files = pathsFor(batchRoot);
  return withExclusiveLock(files.takeoverLock, () => {
    const current = readLease(batchRoot);
    if (!current) throw new BatchStateError("No lease exists to take over", "lease_missing");
    if (current.leaseFileDigest !== expectedLeaseDigest) {
      throw new BatchStateError("Lease changed before takeover", "lease_compare_failed");
    }
    const ownerToken = crypto.randomBytes(32).toString("base64url");
    const lease = {
      schemaVersion: 1,
      ownerTokenDigest: ownerDigest(ownerToken),
      acquiredAt: now,
      lastHeartbeat: now,
      invocationId,
      schedulingAllowed: false,
      takeoverOf: expectedLeaseDigest,
    };
    atomicWriteJson(files.lease, lease);
    return { ownerToken, lease, leaseFileDigest: fileDigest(files.lease) };
  });
}

export function assertSchedulingAllowed(batchRoot, ownerToken) {
  const lease = assertLeaseOwner(batchRoot, ownerToken);
  if (!lease.schedulingAllowed) {
    throw new BatchStateError(
      "Takeover lease is read-only until worker fencing is implemented",
      "scheduling_fenced",
    );
  }
  return lease;
}

function assertWritableLease(batchRoot, ownerToken) {
  return assertSchedulingAllowed(batchRoot, ownerToken);
}

export function readState(batchRoot) {
  return readJson(pathsFor(batchRoot).state, "batch state");
}

export function updateState({ batchRoot, ownerToken, mutate, now = new Date().toISOString() } = {}) {
  const files = pathsFor(batchRoot);
  return withExclusiveLock(files.takeoverLock, () => {
    const lease = assertWritableLease(batchRoot, ownerToken);
    const current = readState(batchRoot);
    const next = mutate(structuredClone(current));
    if (!next || next.schemaVersion !== 1 || next.batchId !== current.batchId) {
      throw new BatchStateError("State mutation changed immutable protocol fields", "invalid_state_mutation");
    }
    next.revision = current.revision + 1;
    next.updatedAt = now;
    next.activeLeaseDigest = lease.ownerTokenDigest;
    assertSafePersistedValue(next);
    assertDocumentSchema(next, stateSchema, stateSchemaPath, "Batch state");
    atomicWriteJson(files.state, next);
    return next;
  });
}

function readEventLog(eventsPath) {
  if (!fs.existsSync(eventsPath)) return [];
  const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const [index, line] of lines.entries()) {
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      throw new BatchStateError(`Event log is corrupt at line ${index + 1}: ${error.message}`, "invalid_event_log");
    }
  }
  return events;
}

function sameEvent(existing, candidate) {
  return existing.type === candidate.type
    && existing.repoId === candidate.repoId
    && existing.executionUnitId === candidate.executionUnitId
    && existing.invocationId === candidate.invocationId
    && isDeepStrictEqual(existing.payload, candidate.payload);
}

export function appendEvent({
  batchRoot,
  ownerToken,
  event,
  operationKey,
  now = new Date().toISOString(),
} = {}) {
  const files = pathsFor(batchRoot);
  return withExclusiveLock(files.takeoverLock, () => {
    assertWritableLease(batchRoot, ownerToken);
    const events = readEventLog(files.events);
    const candidate = {
      type: event.type,
      repoId: event.repoId ?? null,
      executionUnitId: event.executionUnitId ?? null,
      invocationId: event.invocationId ?? null,
      payload: operationKey
        ? { ...(event.payload ?? {}), operationKey }
        : event.payload ?? {},
    };
    if (operationKey) {
      const existing = events.find((entry) => entry.payload?.operationKey === operationKey);
      if (existing) {
        if (!sameEvent(existing, candidate)) {
          throw new BatchStateError("Event operation key is already bound to different content", "event_operation_conflict");
        }
        return existing;
      }
    }
    const persisted = {
      schemaVersion: 1,
      eventId: crypto.randomUUID(),
      sequence: events.length === 0 ? 1 : Number(events.at(-1).sequence) + 1,
      batchId: readState(batchRoot).batchId,
      ...candidate,
      at: now,
    };
    assertSafePersistedValue(persisted);
    assertDocumentSchema(persisted, eventSchema, eventSchemaPath, "Batch event");
    const descriptor = fs.openSync(files.events, "a", 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(persisted)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    return persisted;
  });
}

export function writeRepoState({ batchRoot, ownerToken, repoId, state } = {}) {
  const files = pathsFor(batchRoot);
  return withExclusiveLock(files.takeoverLock, () => {
    assertWritableLease(batchRoot, ownerToken);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(repoId ?? "")) {
      throw new BatchStateError("Repository state ID is not a safe filename", "invalid_repo_id");
    }
    if (state.schemaVersion !== 1 || state.repoId !== repoId) {
      throw new BatchStateError("Repository state identity is invalid", "invalid_repo_state");
    }
    assertSafePersistedValue(state);
    const filePath = path.join(files.repos, `${repoId}.json`);
    atomicWriteJson(filePath, state);
    return filePath;
  });
}

export function writeSummary({ batchRoot, ownerToken, summary, markdown } = {}) {
  const files = pathsFor(batchRoot);
  return withExclusiveLock(files.takeoverLock, () => {
    assertWritableLease(batchRoot, ownerToken);
    if (summary.schemaVersion !== 1) {
      throw new BatchStateError("Summary schemaVersion must be 1", "unsupported_schema");
    }
    assertSafePersistedValue(summary);
    assertSafePersistedValue(markdown);
    atomicWriteJson(files.summaryJson, summary);
    atomicWriteFile(files.summaryMarkdown, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    return { json: files.summaryJson, markdown: files.summaryMarkdown };
  });
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readInputJson(filePath, label) {
  if (!filePath) throw new BatchStateError(`${label} path is required`, "missing_option");
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new BatchStateError(`Unable to read ${label}: ${error.message}`, "invalid_json");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const batchRoot = optionValue("--batch-root");
  try {
    let result;
    if (command === "initialize") {
      const manifest = readInputJson(optionValue("--manifest"), "manifest input");
      const statePath = optionValue("--state");
      const state = statePath ? readInputJson(statePath, "state input") : undefined;
      result = initializeBatch({ batchRoot, manifest, state });
    } else if (command === "acquire-lease") {
      result = acquireLease({ batchRoot, invocationId: optionValue("--invocation-id") });
    } else if (command === "inspect-lease") {
      result = readLease(batchRoot);
    } else if (command === "read-state") {
      result = readState(batchRoot);
    } else if (command === "update-status") {
      result = updateState({
        batchRoot,
        ownerToken: process.env.BATCH_OWNER_TOKEN,
        mutate: (state) => ({ ...state, status: optionValue("--status") }),
      });
    } else if (command === "append-event") {
      result = appendEvent({
        batchRoot,
        ownerToken: process.env.BATCH_OWNER_TOKEN,
        event: readInputJson(optionValue("--event"), "event input"),
      });
    } else if (command === "write-repo-state") {
      result = {
        path: writeRepoState({
          batchRoot,
          ownerToken: process.env.BATCH_OWNER_TOKEN,
          repoId: optionValue("--repo-id"),
          state: readInputJson(optionValue("--state"), "repository state input"),
        }),
      };
    } else if (command === "write-summary") {
      const markdownPath = optionValue("--markdown");
      if (!markdownPath) throw new BatchStateError("markdown path is required", "missing_option");
      result = writeSummary({
        batchRoot,
        ownerToken: process.env.BATCH_OWNER_TOKEN,
        summary: readInputJson(optionValue("--summary"), "summary input"),
        markdown: fs.readFileSync(path.resolve(markdownPath), "utf8"),
      });
    } else if (command === "assert-scheduling") {
      result = assertSchedulingAllowed(batchRoot, process.env.BATCH_OWNER_TOKEN);
    } else if (command === "release-lease") {
      result = releaseLease({ batchRoot, ownerToken: process.env.BATCH_OWNER_TOKEN });
    } else if (command === "takeover-lease") {
      result = takeoverLease({
        batchRoot,
        expectedLeaseDigest: optionValue("--expected-digest"),
        invocationId: optionValue("--invocation-id"),
      });
    } else {
      throw new BatchStateError(`Unknown command: ${command}`, "unknown_command");
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code, message: error.message })}\n`);
    process.exitCode = error.code === "lease_held" || error.code === "lease_compare_failed" ? 2 : 1;
  }
}
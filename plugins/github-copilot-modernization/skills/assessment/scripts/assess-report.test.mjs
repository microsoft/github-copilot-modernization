import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateHtmlReport, loadEnrichment, validateEnrichment } from "./assess-report.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(scriptsDir, "fixtures", "acme-orders", ".memory");
const runId = "2026-05-20T14-22-11Z";

function copyFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "assess-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const memoryDir = path.join(root, ".memory");
  fs.cpSync(fixtureDir, memoryDir, { recursive: true });
  return { root, memoryDir };
}

test("fixture enrichment validates as ai-narrated", (t) => {
  const { memoryDir } = copyFixture(t);
  const loaded = loadEnrichment({ memoryDir, runId });
  const result = validateEnrichment({ memoryDir, runId });

  assert.equal(loaded.mode, "ai-narrated");
  assert.equal(loaded.enrichment.version, 1);
  assert.equal(result.ok, true, result.failures.join("\n"));
  assert.equal(result.mode, "ai-narrated");
  assert.deepEqual(result.failures, []);
});

test("generated fixture report embeds a complete payload", (t) => {
  const { root, memoryDir } = copyFixture(t);
  const outputDir = path.join(root, "reports");
  const result = generateHtmlReport({ memoryDir, runId, outputDir, projectRoot: root });
  const html = fs.readFileSync(result.versionedPath, "utf8");

  assert.equal(result.mode, "ai-narrated");
  assert.ok(html.length > 10_000);
  assert.ok(fs.existsSync(result.latestPath));
  assert.match(html, /<script type="application\/json" id="report-data">\{/);
  assert.match(html, /"report_mode":"ai-narrated"/);
  assert.match(html, /"total":12/);
  assert.doesNotMatch(html, /\{\{[A-Z0-9_]+\}\}/);
});

test("malformed enrichment fails validation", (t) => {
  const { root, memoryDir } = copyFixture(t);
  const malformedPath = path.join(root, "malformed.yaml");
  fs.writeFileSync(malformedPath, [
    "version: 1",
    "briefing:",
    "  paragraph: short",
    "headlines:",
    "  - title: Missing kind",
    "themes:",
    "  - id: misc",
    "    label: Misc",
    "    finding_ids: []",
    "next_steps:",
    "  - title: Missing kind",
  ].join("\n"), "utf8");

  const result = validateEnrichment({ memoryDir, runId, enrichmentPath: malformedPath });

  assert.equal(result.ok, false);
  assert.notEqual(result.mode, "ai-narrated");
  assert.ok(result.failures.some((failure) => failure.includes("briefing.paragraph is too short")));
  assert.ok(result.failures.some((failure) => failure.includes("missing kind")));
});

test("no findings can explicitly pass as a raw report", (t) => {
  const { memoryDir } = copyFixture(t);
  fs.writeFileSync(path.join(memoryDir, "findings.yaml"), "version: 1\nfindings: []\n", "utf8");

  const result = validateEnrichment({ memoryDir, runId, enrichmentPath: "-", allowRaw: true });

  assert.deepEqual(result, { ok: true, mode: "raw", failures: [], warnings: [] });
});
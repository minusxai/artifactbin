import test from "node:test";
import assert from "node:assert/strict";
import { readMigrationArchivedArtifact } from "../src/migration/archived-artifact.ts";
import type { SqlReader } from "../src/migration/contracts.ts";
const original = {
  id: "old-page",
  version: 3,
  deleted_at: "2026-01-01T00:00:00Z",
};
const projection = {
  digest: "a".repeat(64),
  maps: { pages: { "old-page": "Pg0001" } },
  original: null,
};
const part = {
  table: "artifacts",
  path: "artifacts/part.ndjson",
  sha256: "b".repeat(64),
  rows: 2,
  bytes: 100,
};
const raw = {
  original,
  kind: "base",
  source_namespace: "source",
  manifest_digest: "c".repeat(64),
  path: part.path,
  source_table: part.table,
  part_digest: part.sha256,
  part_rows: "2",
  part_bytes: "100",
  ordinal: "1",
  part,
};
function database(rows: Record<string, unknown>[]) {
  let calls = 0;
  return {
    db: {
      query: async () => ({ rows: ++calls === 1 ? [projection] : rows }),
    } as SqlReader,
    calls: () => calls,
  };
}
test("reads an omitted original from its exact base raw artifact part", async () => {
  const { db } = database([raw]);
  assert.deepEqual(
    await readMigrationArchivedArtifact(db, "fixture", "source", "old-page"),
    { ...projection, original },
  );
});
test("preserves existing inline original without requiring stream tables", async () => {
  let calls = 0;
  const db = {
    query: async () => {
      calls++;
      return { rows: [{ ...projection, original }] };
    },
  } as SqlReader;
  assert.deepEqual(
    (await readMigrationArchivedArtifact(db, "fixture", "source", "old-page"))
      .original,
    original,
  );
  assert.equal(calls, 1);
});
test("refuses absent, duplicate, foreign relation, unbound part or out-of-range raw rows", async () => {
  for (const rows of [
    [],
    [raw, raw],
    [{ ...raw, source_table: "artifact_versions" }],
    [{ ...raw, source_namespace: "foreign" }],
    [{ ...raw, kind: "supplemental-relations" }],
    [{ ...raw, part: { ...part, sha256: "f".repeat(64) } }],
    [{ ...raw, ordinal: "2" }],
    [{ ...raw, original: { ...original, id: "foreign" } }],
  ]) {
    await assert.rejects(
      readMigrationArchivedArtifact(
        database(rows).db,
        "fixture",
        "source",
        "old-page",
      ),
    );
  }
});

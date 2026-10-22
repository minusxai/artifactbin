import test from "node:test";
import assert from "node:assert/strict";
import { PostgresDatasetMetadataDestination } from "../src/migration/dataset-destination.ts";
import type { DatasetMigrationBatch } from "../src/migration/dataset-destination-contracts.ts";
const batch = (): DatasetMigrationBatch => ({
  baseManifestSha256: "a".repeat(64),
  relationManifestSha256: "b".repeat(64),
  relationExportedAt: "2026-10-22T00:00:00.000Z",
  metadata: {
    sourceNamespace: "fixture",
    bindings: [],
    pages: [],
    resources: [],
    versions: [],
    principals: [
      {
        actor: "new@example.test",
        kind: "user",
        legacyId: "user-1",
        identity: "user",
        expiresAt: null,
      },
    ],
    groups: [],
    acceptedJoins: [],
  },
});
test("dataset migration rejects principal remapping before any insertion and rolls back", async () => {
  const queries: string[] = [];
  const destination = new PostgresDatasetMetadataDestination(
    {
      query: async (sql) => {
        queries.push(sql);
        return {
          rows: sql.includes('FROM "isolated".dataset_principals')
            ? [
                {
                  value: {
                    source_namespace: "fixture",
                    actor: "old@example.test",
                    kind: "user",
                    legacy_id: "user-1",
                    identity: "user",
                    expires_at: null,
                  },
                },
              ]
            : [],
        };
      },
    },
    "isolated",
  );
  await assert.rejects(
    destination.import(batch()),
    /Existing dataset metadata differs/,
  );
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.ok(!queries.some((q) => q.startsWith("INSERT")));
});
test("dataset migration rejects invalid schema and export provenance before querying", async () => {
  let queries = 0;
  const db = {
    query: async () => {
      queries++;
      return { rows: [] };
    },
  };
  assert.throws(() => new PostgresDatasetMetadataDestination(db, "public"));
  const invalid = batch();
  invalid.baseManifestSha256 = "missing";
  await assert.rejects(
    new PostgresDatasetMetadataDestination(db, "isolated").import(invalid),
    /provenance/,
  );
  assert.equal(queries, 0);
});

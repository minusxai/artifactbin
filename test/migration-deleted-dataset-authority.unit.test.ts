import assert from "node:assert/strict";
import test from "node:test";
import type { DatasetMigrationBatch } from "../src/migration/dataset-destination-contracts.ts";
import {
  deletedDatasetBatchFingerprint,
  validateDeletedDatasetBatch,
} from "../src/migration/deleted-dataset-authority.ts";
function batch(): DatasetMigrationBatch {
  const b: DatasetMigrationBatch = {
    baseManifestSha256: "a".repeat(64),
    relationManifestSha256: "b".repeat(64),
    relationExportedAt: "2024-01-01T00:00:00Z",
    metadata: {
      sourceNamespace: "fixture",
      bindings: [],
      pages: [
        {
          pageId: "Deleted1",
          pageVersion: 1,
          snapshot: {
            id: "legacy",
            editId: "edit",
            format: "markup",
            deleted: true,
            visibility: "private",
            owner: { userId: null, tokenId: null },
            ownerIsTestUser: false,
            acceptedJoinUserIds: [],
          },
        },
      ],
      resources: [],
      versions: [],
      principals: [],
      groups: [],
      acceptedJoins: [],
    },
  };
  b.deletedAdditive = {
    kind: "deleted-dataset-additive-v1",
    sourceNamespace: "fixture",
    batchSha256: deletedDatasetBatchFingerprint(b),
    admitted: [
      {
        legacyId: "legacy",
        pageId: "Deleted1",
        version: 1,
        artifactSha256: "c".repeat(64),
      },
    ],
    base: {
      verificationReport: { path: "offline", sha256: "d".repeat(64) },
      inventory: {
        sourceNamespace: "fixture",
        datasetFingerprint: "e".repeat(64),
        resources: [],
        baseManifestSha256: b.baseManifestSha256,
        relationManifestSha256: b.relationManifestSha256,
        relationExportedAt: b.relationExportedAt,
        compilerIdentity: "test",
        reservedFileIds: [],
        protectedRows: [],
        backendRows: [],
        pageReceipts: [],
        sources: [],
        tables: [],
      },
    },
  };
  return b;
}
test("sealed deleted batch retains original snapshot and rejects source scope or metadata changes", () => {
  const b = batch();
  const before = structuredClone(b);
  validateDeletedDatasetBatch(b);
  assert.deepEqual(b, before);
  for (const change of [
    (v: DatasetMigrationBatch) => {
      v.metadata.pages[0]!.snapshot.deleted = false;
    },
    (v: DatasetMigrationBatch) => {
      v.metadata.pages[0]!.snapshot.id = "active";
    },
    (v: DatasetMigrationBatch) => {
      v.deletedAdditive!.admitted = [
        ...v.deletedAdditive!.admitted,
        v.deletedAdditive!.admitted[0]!,
      ];
    },
    (v: DatasetMigrationBatch) => {
      v.metadata.pages[0]!.snapshot.visibility = "public";
    },
  ]) {
    const v = batch();
    change(v);
    assert.throws(() => validateDeletedDatasetBatch(v));
  }
});

test("deleted authority verifies persisted normal and historical source queries and rejects changed proofs", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const { registerSourceQueries } = await import(
    "../src/persistence/source-queries.ts"
  );
  const { verifyDeletedDatasetAuthority } = await import(
    "../src/migration/deleted-dataset-authority.ts"
  );
  const { migrationDatasetTablePlans } = await import(
    "../src/migration/dataset-table-plans.ts"
  );
  const directory = await mkdtemp(join(tmpdir(), "deleted-source-authority-"));
  try {
    for (const historical of [false, true]) {
      const b = batch();
      const receipt = {
        pageLegacyId: "legacy",
        pageId: "PAGE01",
        pageVersion: 1,
        backendId: "BACK01",
        deployment: { version: "v1" },
        ...(historical
          ? {
              historicalSourceQueries: {
                kind: "standalone-external-history-v1" as const,
                pageLegacyId: "legacy",
                pageId: "PAGE01",
                pageVersion: 1,
                headVersion: 2,
                editId: "edit",
                sourceNamespace: "fixture",
                artifactSha256: "c".repeat(64),
              },
            }
          : {}),
      };
      const sql = "SELECT $needle AS value";
      const queries = [
        {
          pageLegacyId: "legacy",
          pageVersion: 1,
          name: "answer",
          sourceRef: "ref:ABC123",
          resource: "source-ABC123",
          sql,
          sqlSha256: createHash("sha256").update(sql).digest("hex"),
          params: { needle: "string" as const },
          columns: [{ name: "value", type: "string" as const }],
        },
      ];
      b.sourceQueryRegistrations = [{ receipt, queries }];
      const plans = migrationDatasetTablePlans(b);
      b.deletedAdditive!.base.inventory.tables = plans.map((plan) => ({
        table: plan.table,
        keys: [...plan.keys],
        rows: [],
      }));
      const report = JSON.stringify({
        complete: true,
        readOnly: true,
        compilerIdentity: "test",
        runtime: { pages: 0 },
        archives: [
          { manifestSha256: b.baseManifestSha256 },
          { manifestSha256: b.relationManifestSha256 },
        ],
      });
      const reportPath = join(directory, "report.json");
      await writeFile(reportPath, report);
      b.deletedAdditive!.base.verificationReport = {
        path: reportPath,
        sha256: createHash("sha256").update(report).digest("hex"),
      };
      b.deletedAdditive!.batchSha256 = deletedDatasetBatchFingerprint(b);
      const persisted: Record<string, unknown>[] = [];
      await registerSourceQueries(
        {
          query: async (_text, values) => {
            persisted.push({
              backend_id: values![0],
              backend_version: values![1],
              page_id: values![2],
              page_version: values![3],
              name: values![4],
              registration: JSON.parse(String(values![5])),
            });
            return { rows: [{ name: values![4] }], rowCount: 1 };
          },
        },
        receipt,
        "fixture",
        queries,
      );
      const db = {
        query: async (text: string) => {
          if (text.includes(".dataset_receipts"))
            return {
              rows: [
                {
                  fingerprint:
                    b.deletedAdditive!.base.inventory.datasetFingerprint,
                },
              ],
            };
          if (text.includes(".dataset_source_queries "))
            return { rows: persisted.map((value) => ({ value })) };
          const plan = plans.find((plan) => text.includes(`.${plan.table} t `));
          return { rows: plan ? plan.rows.map((value) => ({ value })) : [] };
        },
      };
      await verifyDeletedDatasetAuthority(db, "isolated", b, true);
      const registration = persisted[0]!.registration as Record<
        string,
        unknown
      >;
      registration.historicalAuthority = { forged: true };
      await assert.rejects(
        verifyDeletedDatasetAuthority(db, "isolated", b, true),
        /Unexpected deleted dataset registration/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

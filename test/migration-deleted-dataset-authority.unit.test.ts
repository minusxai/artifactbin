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

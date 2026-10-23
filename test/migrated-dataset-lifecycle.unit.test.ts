import test from "node:test";
import assert from "node:assert/strict";
import { projectMigratedDatasetLifecycle } from "../src/persistence/migrated-dataset-lifecycle.ts";
import type { DocumentSnapshot } from "../src/datasets/policy/contracts.ts";
import type { MigratedDatasetLifecycleProjection } from "../src/datasets/migrated-lifecycle-contracts.ts";
const snapshot: DocumentSnapshot = {
  id: "legacy-data",
  editId: "edit",
  owner: { userId: "owner", tokenId: null },
  visibility: "private",
  format: "dataset",
  deleted: true,
  acceptedJoinUserIds: [],
  ownerIsTestUser: false,
};
const expected = {
  sourceNamespace: "fixture",
  pageId: "Data01",
  owner: "owner@example.test",
};
const current: MigratedDatasetLifecycleProjection = {
  link: {
    sourceNamespace: "fixture",
    legacyId: "legacy-data",
    pageId: "Data01",
    authoritySha256: "a".repeat(64),
  },
  owner: expected.owner,
  fileOwner: expected.owner,
  snapshotId: "legacy-data",
  deleted: false,
};
test("only exact admitted current lifecycle projects immutable deleted snapshots", () => {
  assert.deepEqual(
    projectMigratedDatasetLifecycle(snapshot, expected, current),
    { ...snapshot, deleted: false },
  );
  assert.equal(snapshot.deleted, true);
  assert.equal(
    projectMigratedDatasetLifecycle(snapshot, expected, null),
    snapshot,
  );
  for (const changed of [
    { ...current, fileOwner: "other" },
    { ...current, snapshotId: "other" },
    { ...current, link: { ...current.link, sourceNamespace: "other" } },
    { ...current, link: { ...current.link, pageId: "Other1" } },
    { ...current, link: { ...current.link, legacyId: "other" } },
    { ...current, link: { ...current.link, authoritySha256: "invalid" } },
  ])
    assert.equal(
      projectMigratedDatasetLifecycle(snapshot, expected, changed),
      snapshot,
    );
  assert.equal(
    projectMigratedDatasetLifecycle(snapshot, expected, {
      ...current,
      deleted: true,
    }).deleted,
    true,
  );
});

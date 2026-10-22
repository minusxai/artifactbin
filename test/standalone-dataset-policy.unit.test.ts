import { test } from "node:test";
import assert from "node:assert/strict";
import { datasetReadable } from "../src/datasets/policy/read.ts";
import type { DatasetReadAuthority } from "../src/datasets/contracts.ts";
const authority = (): DatasetReadAuthority => ({
  page: {
    id: "Dataset1",
    editId: "edit-1",
    owner: { userId: "owner", tokenId: null },
    visibility: "private",
    format: "dataset",
    deleted: false,
    ownerIsTestUser: false,
    acceptedJoinUserIds: [],
    standaloneDataset: {
      kind: "dataset-self-read-v1",
      datasetId: "Dataset1",
      version: 7,
    },
  },
  pageVersion: 7,
  dataset: {
    id: "Dataset1",
    owner: { userId: "owner", tokenId: null },
    visibility: "private",
    policyRevision: 1,
    ownerIsTestUser: false,
    policy: null,
    deleted: false,
    version: 7,
    generation: 1,
  },
  facts: {
    caller: { userId: "owner", tokenId: null },
    identity: "user",
    groupRoles: {},
    sharedArtifactIds: [],
  },
});
test("standalone dataset source format remains dataset and only exact read-only self authority is admitted", () => {
  const a = authority();
  assert.equal(datasetReadable(a), true);
  for (const change of [
    { ...a, page: { ...a.page, standaloneDataset: undefined } },
    { ...a, dataset: { ...a.dataset, id: "other-dataset" } },
    { ...a, pageVersion: 8 },
    { ...a, page: { ...a.page, format: "program" } },
    {
      ...a,
      facts: { ...a.facts, caller: { userId: "stranger", tokenId: null } },
    },
    { ...a, dataset: { ...a.dataset, deleted: true } },
  ])
    assert.equal(datasetReadable(change), false);
});
test("dataset wrapper cannot create the markup document-reference authority its original source never had", () => {
  const a = authority();
  a.dataset.policy = {
    version: 2,
    allow: [{ actions: ["read"], from: { artifact: a.page.id } }],
  };
  assert.equal(
    datasetReadable({
      ...a,
      page: { ...a.page, format: "markup", standaloneDataset: undefined },
    }),
    true,
  );
  assert.equal(datasetReadable(a), false);
});

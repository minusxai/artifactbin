import test from "node:test";
import assert from "node:assert/strict";
import {
  translateDataset,
  permitsDatasetAction,
} from "../src/migration/datasets/policy.ts";
import type {
  DatasetSnapshot,
  AuthorizationFacts,
  Evaluation,
} from "../src/migration/datasets/contracts.ts";
const owner = { userId: "owner", tokenId: null };
const snapshot: DatasetSnapshot = {
  id: "dataset",
  owner,
  visibility: "public",
  policyRevision: 3,
  ownerIsTestUser: false,
  policy: {
    version: 2,
    allow: [{ actions: ["read", "insert"], from: { user: "*" } }],
  },
};
const facts: AuthorizationFacts = {
  caller: { userId: "reader", tokenId: null },
  identity: "user",
  groupRoles: {},
  sharedArtifactIds: [],
};
function allows(
  change: Partial<DatasetSnapshot> = {},
  request: Partial<Evaluation> = {},
) {
  const result = translateDataset({ ...snapshot, ...change });
  assert.equal(result.ok, true);
  return (
    result.ok &&
    permitsDatasetAction(result.dataset, {
      action: "read",
      facts,
      currentPolicyRevision: 3,
      ...request,
    })
  );
}
test("public wildcard reads include anonymous callers; private remains an audience ceiling", () => {
  assert.equal(
    allows(
      {},
      {
        facts: {
          ...facts,
          caller: { userId: null, tokenId: null },
          identity: null,
        },
      },
    ),
    true,
  );
  assert.equal(allows({ visibility: "private" }), false);
  assert.equal(
    allows(
      { visibility: "private" },
      { facts: { ...facts, sharedArtifactIds: ["dataset"] } },
    ),
    true,
  );
});
test("writes require current revision, valid identity and accepted saved document membership", () => {
  assert.equal(allows({}, { action: "insert" }), true);
  assert.equal(
    allows({}, { action: "insert", currentPolicyRevision: 4 }),
    false,
  );
  assert.equal(
    allows({}, { action: "insert", facts: { ...facts, identity: "guest" } }),
    false,
  );
  const document = {
    id: "document",
    editId: "edit",
    owner,
    visibility: "public",
    format: "markup",
    deleted: false,
    ownerIsTestUser: false,
    acceptedJoinUserIds: [],
  };
  assert.equal(
    allows(
      {},
      {
        action: "insert",
        document,
        requestedDocument: { id: "document", editId: "edit" },
      },
    ),
    false,
  );
  assert.equal(
    allows(
      {},
      {
        action: "insert",
        document: { ...document, acceptedJoinUserIds: ["reader"] },
        requestedDocument: { id: "document", editId: "edit" },
      },
    ),
    true,
  );
  assert.equal(
    allows(
      {},
      {
        action: "insert",
        document: { ...document, acceptedJoinUserIds: ["reader"] },
        requestedDocument: { id: "document", editId: "stale" },
      },
    ),
    false,
  );
});
test("group editor owns grants; viewer only satisfies private readability", () => {
  const change = {
    owner: { userId: null, tokenId: null, groupId: "team" },
    visibility: "private",
    policy: {
      version: 2,
      allow: [{ actions: ["read", "insert"], from: { user: "$owner" } }],
    },
  };
  assert.equal(
    allows(change, { facts: { ...facts, groupRoles: { team: "viewer" } } }),
    false,
  );
  assert.equal(
    allows(change, {
      action: "insert",
      facts: { ...facts, groupRoles: { team: "editor" } },
    }),
    true,
  );
});
test("translation refuses unsupported policy semantics and never mutates input", () => {
  for (const policy of [
    { version: 1 },
    { version: 2, allow: [], tables: [] },
    { version: 2, allow: [], execution: {} },
    { version: 2, allow: [{ actions: ["read"], from: { unknown: "*" } }] },
  ])
    assert.equal(translateDataset({ ...snapshot, policy }).ok, false);
  const result = translateDataset(snapshot);
  if (result.ok)
    assert.notEqual(
      result.dataset.grants,
      (snapshot.policy as { allow: unknown }).allow,
    );
});
test("selectors are conjunctive and artifact ownership respects token identities", () => {
  const tokenOwner = { userId: null, tokenId: "token" };
  const policy = {
    version: 2,
    allow: [
      {
        actions: ["read"],
        from: { user: "reader", artifact: "document", artifactOwner: "$owner" },
      },
    ],
  };
  const document = {
    id: "document",
    editId: "edit",
    owner: tokenOwner,
    visibility: "public",
    format: "markup",
    deleted: false,
    ownerIsTestUser: false,
    acceptedJoinUserIds: [],
  };
  assert.equal(allows({ owner: tokenOwner, policy }, { document }), true);
  assert.equal(
    allows(
      { owner: tokenOwner, policy },
      { document: { ...document, owner: { userId: null, tokenId: "other" } } },
    ),
    false,
  );
  assert.equal(
    allows(
      { owner: tokenOwner, policy },
      { document: { ...document, id: "another" } },
    ),
    false,
  );
  assert.equal(allows({ owner: tokenOwner, policy }), false);
});
test("token creators bypass joins only for their own document; test users remain sandboxed", () => {
  const tokenOwner = { userId: null, tokenId: "token" };
  const tokenFacts = { ...facts, caller: tokenOwner, identity: null };
  const document = {
    id: "document",
    editId: "edit",
    owner: tokenOwner,
    visibility: "public",
    format: "markup",
    deleted: false,
    ownerIsTestUser: false,
    acceptedJoinUserIds: [],
  };
  assert.equal(
    allows(
      { owner: tokenOwner },
      {
        action: "insert",
        facts: tokenFacts,
        document,
        requestedDocument: { id: "document", editId: "edit" },
      },
    ),
    true,
  );
  assert.equal(
    allows({}, { action: "insert", facts: { ...facts, identity: "testuser" } }),
    false,
  );
  assert.equal(
    allows(
      { ownerIsTestUser: true },
      { action: "insert", facts: { ...facts, identity: "testuser" } },
    ),
    true,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { selectDatasetMutationPolicy } from "../src/datasets/mutation/policy.ts";
import type {
  DatasetMutationHead,
  DatasetMutationOperation,
} from "../src/datasets/mutation/contracts.ts";
const operation: DatasetMutationOperation = {
  name: "save",
  backendId: "Back12",
  backendVersion: "a".repeat(64),
  page: { id: "Page12", version: 1, legacyId: "Legacy12", editId: "edit" },
  datasetId: "data",
  target: { schema: "public", table: "rows" },
  sql: "update public.rows set value=1",
  paramTypes: {},
  conflictMode: "refuse",
};
function head(): DatasetMutationHead {
  return {
    generation: 0,
    version: 1,
    policyRevision: 2,
    writable: true,
    callerCanEdit: false,
    documentWriterCanRead: true,
    tables: [],
    systemParams: {},
    authority: {
      pageVersion: 1,
      page: {
        id: "Legacy12",
        editId: "edit",
        owner: { userId: "owner", tokenId: null },
        visibility: "public",
        format: "markup",
        deleted: false,
        ownerIsTestUser: false,
        acceptedJoinUserIds: ["viewer"],
      },
      dataset: {
        ...{ version: 1, generation: 1 },
        id: "data",
        owner: { userId: "owner", tokenId: null },
        visibility: "public",
        policyRevision: 2,
        ownerIsTestUser: false,
        deleted: false,
        policy: {
          version: 2,
          allow: [
            { actions: ["update"], from: { user: "*", artifact: "Legacy12" } },
          ],
        },
      },
      facts: {
        caller: { userId: "viewer", tokenId: null },
        identity: "user",
        groupRoles: {},
        sharedArtifactIds: [],
      },
    },
  };
}
test("v2 keeps granted operation and trusted legacy session; absent tables uses exact viewer default", () => {
  const out = selectDatasetMutationPolicy(head(), operation);
  assert.deepEqual(out.operations, ["update"]);
  assert.equal(out.policy?.session["x-hasura-user-id"], "viewer");
  assert.equal(out.policy?.role, "viewer");
});
test("private audience, changed document, missing accepted join and unknown extensions deny", () => {
  const a = head();
  a.authority.dataset.visibility = "private";
  assert.throws(() => selectDatasetMutationPolicy(a, operation));
  const b = head();
  b.authority.page.editId = "changed";
  assert.throws(() => selectDatasetMutationPolicy(b, operation));
  const c = head();
  c.authority.page.acceptedJoinUserIds = [];
  assert.throws(() => selectDatasetMutationPolicy(c, operation));
  const d = head();
  (d.authority.dataset.policy as Record<string, unknown>).execution = {
    extensions: { network: {} },
  };
  assert.throws(() => selectDatasetMutationPolicy(d, operation));
});
test("null policy needs editor, while v1 selects table viewer permissions even for editor", () => {
  const a = head();
  a.authority.dataset.policy = null;
  assert.throws(() => selectDatasetMutationPolicy(a, operation));
  a.callerCanEdit = true;
  assert.equal(selectDatasetMutationPolicy(a, operation).policy, undefined);
  a.authority.dataset.policy = {
    version: 1,
    enforcement: "enabled",
    tables: [],
    systemParams: {},
  };
  assert.throws(() => selectDatasetMutationPolicy(a, operation));
});

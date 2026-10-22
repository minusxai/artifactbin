import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetMutationAvailabilityService } from "../src/datasets/mutation/availability.ts";
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

const context = {
  backendId: operation.backendId,
  backendVersion: operation.backendVersion,
  pageId: operation.page.id,
  subject: "viewer",
};
test("advisory matches analyzed action and exact selected role, never another allowed action", async () => {
  const op = {
    ...operation,
    analysis: { operation: "update" as const, columns: ["value"] },
  };
  const h = head();
  const service = createDatasetMutationAvailabilityService({
    snapshot: async () => ({ operation: op, head: h }),
  });
  assert.deepEqual(
    await service.mutationAvailability(context, { operation: "save" }),
    { canAttempt: true },
  );
  op.analysis.operation = "delete" as "update";
  assert.deepEqual(
    await service.mutationAvailability(context, { operation: "save" }),
    { canAttempt: false },
  );
  op.analysis.operation = "update";
  h.authority.dataset.policy = {
    version: 1,
    enforcement: "enabled",
    tables: [
      {
        table: {
          schema: operation.target.schema,
          name: operation.target.table,
        },
        update_permissions: [
          { role: "editor", permission: { columns: "*", filter: {} } },
        ],
      },
    ],
  };
  assert.deepEqual(
    await service.mutationAvailability(context, { operation: "save" }),
    { canAttempt: false },
  );
  (h.authority.dataset.policy as any).tables[0].update_permissions.push({
    role: "viewer",
    permission: { columns: ["other"], filter: {} },
  });
  assert.deepEqual(
    await service.mutationAvailability(context, { operation: "save" }),
    { canAttempt: false },
  );
  (
    h.authority.dataset.policy as any
  ).tables[0].update_permissions[1].permission.columns = ["value"];
  assert.deepEqual(
    await service.mutationAvailability(context, { operation: "save" }),
    { canAttempt: true },
  );
});
test("unknown analysis, changed context, invalid selectors, abort and authority errors fail closed", async () => {
  let calls = 0;
  const h = head();
  const op = structuredClone(operation);
  const service = createDatasetMutationAvailabilityService({
    snapshot: async () => {
      calls++;
      return { operation: op, head: h };
    },
  });
  assert.deepEqual(
    await service.mutationAvailability(context, { operation: "save" }),
    { canAttempt: false },
  );
  op.analysis = { operation: "update", columns: ["value"] };
  assert.deepEqual(
    await service.mutationAvailability(
      { ...context, pageId: "wrong" },
      { operation: "save" },
    ),
    { canAttempt: false },
  );
  const before = calls;
  for (const input of [
    { operation: "save", sql: "bad" },
    { operation: "constructor" },
    null,
  ])
    assert.deepEqual(await service.mutationAvailability(context, input), {
      canAttempt: false,
    });
  assert.equal(calls, before);
  const abort = new AbortController();
  abort.abort();
  assert.deepEqual(
    await service.mutationAvailability(
      context,
      { operation: "save" },
      abort.signal,
    ),
    { canAttempt: false },
  );
  assert.equal(calls, before);
  const denied = createDatasetMutationAvailabilityService({
    snapshot: async () => {
      throw Error("denied");
    },
  });
  assert.deepEqual(
    await denied.mutationAvailability(context, { operation: "save" }),
    { canAttempt: false },
  );
});

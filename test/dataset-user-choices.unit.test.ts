import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetUserChoiceService } from "../src/datasets/user-choices/service.ts";
import type { DatasetUserChoiceSnapshot } from "../src/datasets/user-choices/contracts.ts";
const context = {
  backendId: "Back01",
  backendVersion: "v1",
  pageId: "Page01",
  subject: "viewer",
};
const request = { name: "items", column: "owner" };
const snapshot: DatasetUserChoiceSnapshot = {
  generation: "one",
  constraints: { memberOf: ["ref:scope"] },
  callerUserId: "me",
  members: [
    { value: "member", label: "Member" },
    { value: "me", label: "Viewer" },
  ],
  self: { value: "me", label: "Viewer" },
};
test("choices disclose only permitted constrained members and self intersects memberships", async () => {
  let current = structuredClone(snapshot);
  const service = createDatasetUserChoiceService({
    snapshot: async () => current,
  });
  assert.deepEqual(
    await service.userChoices(context, request),
    snapshot.members,
  );
  current = { ...snapshot, constraints: {} };
  assert.deepEqual(await service.userChoices(context, request), []);
  current = { ...snapshot, constraints: { self: true } };
  assert.deepEqual(await service.userChoices(context, request), [
    snapshot.self,
  ]);
  current = {
    ...snapshot,
    constraints: { self: true, memberOf: ["ref:scope"] },
    members: [snapshot.members[0]!],
  };
  assert.deepEqual(await service.userChoices(context, request), []);
  current = {
    ...snapshot,
    constraints: { self: true },
    callerUserId: null,
    self: null,
  };
  assert.deepEqual(await service.userChoices(context, request), []);
});
test("revocation or changed current scope after result collection discloses nothing", async () => {
  for (const fresh of [
    null,
    { ...snapshot, generation: "changed" },
    { ...snapshot, members: [] },
  ]) {
    let calls = 0;
    const service = createDatasetUserChoiceService({
      snapshot: async () => (++calls === 1 ? snapshot : fresh),
    });
    await assert.rejects(service.userChoices(context, request), {
      code: "denied",
    });
  }
});
test("arbitrary scope, identifier, version or person inputs never reach repository", async () => {
  let calls = 0;
  const service = createDatasetUserChoiceService({
    snapshot: async () => {
      calls++;
      return snapshot;
    },
  });
  for (const input of [
    null,
    "items",
    {},
    { ...request, ref: "ref:private" },
    { ...request, version: 1 },
    { ...request, column: "__proto__" },
    { ...request, name: "x".repeat(129) },
  ])
    await assert.rejects(service.userChoices(context, input), {
      code: "invalid_request",
    });
  assert.equal(calls, 0);
});
test("result budgets and cancellation fail closed", async () => {
  const service = createDatasetUserChoiceService({
    snapshot: async () => ({
      ...snapshot,
      members: Array.from({ length: 1001 }, (_, i) => ({
        value: String(i),
        label: "person",
      })),
    }),
  });
  await assert.rejects(service.userChoices(context, request), {
    code: "result_limit",
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    service.userChoices(context, request, controller.signal),
  );
});

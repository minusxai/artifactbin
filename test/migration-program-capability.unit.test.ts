import test from "node:test";
import assert from "node:assert/strict";
import { programCapabilityHandler } from "../src/migration/programs/capability.ts";
const signal = new AbortController().signal;
const principal = { tenant: "page", subject: "caller" };
const manifest = {
  values: ["region"],
  queries: ["total"],
  mutations: ["insert"],
  defaults: { region: "initial" },
};
test("program capabilities pin caller, fixed names and fresh authorization; writes retain scoped identity", async () => {
  let checks = 0,
    writes = 0;
  const identities: string[] = [];
  const handler = programCapabilityHandler({
    principal,
    requestId: "run-1",
    manifest,
    transport: {
      authorize: async () => {
        checks++;
      },
      query: async () => [],
      mutate: async (_n, _a, _r, id) => {
        writes++;
        identities.push(id);
      },
    },
  });
  const request = {
    kind: "invoke" as const,
    resource: "program-bindings",
    operation: "mutate",
    input: {
      name: "insert",
      args: { amount: 3 },
      operationId: "operation-1",
      values: { region: "east" },
    },
  };
  await handler(principal, request, signal);
  await handler(principal, request, signal);
  assert.equal(writes, 1);
  assert.deepEqual(identities, ["run-1:operation-1"]);
  assert.equal(checks, 2);
  await assert.rejects(
    handler({ ...principal, subject: "other" }, request, signal),
    /denied/,
  );
  await assert.rejects(
    handler(
      principal,
      { ...request, input: { ...request.input, args: { amount: 4 } } },
      signal,
    ),
    /identity/,
  );
  await assert.rejects(
    handler(
      principal,
      { ...request, input: { ...request.input, name: "unregistered" } },
      signal,
    ),
    /denied/,
  );
  await assert.rejects(
    handler(
      principal,
      {
        kind: "invoke",
        resource: "program-bindings",
        operation: "query",
        input: { name: "total", values: { region: "east" }, sql: "select 1" },
      },
      signal,
    ),
    /denied/,
  );
});
test("unknown mutation outcome is retained for reconciliation and never retried", async () => {
  let writes = 0;
  const handler = programCapabilityHandler({
    principal,
    requestId: "run-2",
    manifest,
    transport: {
      authorize: async () => {},
      query: async () => [],
      mutate: async () => {
        writes++;
        throw Error("unknown");
      },
    },
  });
  const request = {
    kind: "invoke" as const,
    resource: "program-bindings",
    operation: "mutate",
    input: {
      name: "insert",
      args: {},
      operationId: "operation-1",
      values: { region: "east" },
    },
  };
  await assert.rejects(handler(principal, request, signal), /unknown/);
  await assert.rejects(handler(principal, request, signal), /unknown/);
  assert.equal(writes, 1);
});

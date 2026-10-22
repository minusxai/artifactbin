import test from "node:test";
import assert from "node:assert/strict";
import { invokeProgramResolver } from "../src/migration/programs/service.ts";
import type { BackendHost, CompiledBackend } from "../src/backend/contracts.ts";
test("program service fixes one-shot scope, empty owner environment and fresh caller capabilities", async () => {
  const principal = { tenant: "page", subject: "caller" };
  const manifest = { values: [], queries: [], mutations: [], defaults: {} };
  let calls = 0;
  const host: BackendHost = {
    compile: async () => {
      throw Error("unexpected compilation");
    },
    invoke: async (request) => {
      calls++;
      assert.deepEqual(request.reuse, { kind: "one-shot" });
      assert.deepEqual(request.env, {});
      assert.deepEqual(request.principal, principal);
      assert.equal(request.input.field, "run");
      await request.capabilityHandler!(
        request.principal,
        {
          kind: "invoke",
          resource: "program-bindings",
          operation: "authorize",
          input: {},
        },
        new AbortController().signal,
      );
      return JSON.stringify({
        input: JSON.parse(
          (request.input.args as { inputJson: string }).inputJson,
        ),
      });
    },
  };
  const output = await invokeProgramResolver(
    host,
    { backend: {} as CompiledBackend, manifest, scriptSha256: "digest" },
    {
      principal,
      requestId: "run",
      transport: {
        authorize: async () => {},
        query: async () => [],
        mutate: async () => {},
      },
    },
    { text: "南" },
  );
  assert.deepEqual(output, { input: { text: "南" } });
  assert.equal(calls, 1);
  await assert.rejects(
    invokeProgramResolver(
      host,
      { backend: {} as CompiledBackend, manifest, scriptSha256: "digest" },
      {
        principal,
        requestId: "run",
        transport: {
          authorize: async () => {
            throw Error("denied");
          },
          query: async () => [],
          mutate: async () => {},
        },
      },
      null,
    ),
    /denied/,
  );
});

/**
 * With an operator's resource configuration, the capability authority still
 * hands `caps.store` requests to the store handler the server passes for the
 * backend file, for anonymous viewers too, while connector calls keep their
 * grants and stay refused for anonymous viewers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withCapabilityAuthority } from "../../../src/backend/capability-authority.ts";
import type {
  BackendCapabilityHandler,
  BackendCapabilityRequest,
  CompiledBackend,
} from "../../../src/backend/contracts.ts";

const deployment = { version: "v".repeat(64), runtime: "workerd/esbuild/protocol@2/image:sha256:x" } as CompiledBackend;

function authority() {
  const connectorCalls: string[] = [];
  const host = withCapabilityAuthority(
    {
      compile: async () => deployment,
      // The isolate makes two calls: the store, then a connector.
      async invoke({ deployment: _d, principal, input: _input, signal, capabilityHandler: handler }) {
        const call = (request: BackendCapabilityRequest) =>
          handler!(principal, request, signal ?? new AbortController().signal).then(
            (value) => value,
            () => "denied",
          );
        return [
          await call({ kind: "store", operation: "get" }),
          await call({ kind: "invoke", resource: "db", operation: "list", input: null }),
        ];
      },
    },
    {
      host: {
        invoke: async () => (connectorCalls.push("invoke"), "rows"),
        transaction: async () => [],
        close: async () => {},
      },
      grants: [{ documentId: "Pg4mQ2", backendVersion: deployment.version, resource: "db", namedOperations: ["list"] }],
    } as never,
  );
  return { host, connectorCalls };
}

const store: BackendCapabilityHandler = async (_principal, request) =>
  request.kind === "store" ? { value: { todos: [] }, version: 3 } : Promise.reject(Error("not a store request"));

test("store requests reach the server's store handler for signed-in and anonymous callers", async () => {
  const { host, connectorCalls } = authority();
  const input = { field: "todos", args: null };
  assert.deepEqual(await host.invoke({ deployment: deployment, principal: { tenant: "Pg4mQ2", subject: "ann@example.test" }, input: input, capabilityHandler: store, env: {}, reuse: { kind: "one-shot" } }), [
    { value: { todos: [] }, version: 3 },
    "rows",
  ]);
  assert.deepEqual(await host.invoke({ deployment: deployment, principal: { tenant: "Pg4mQ2", subject: null }, input: input, capabilityHandler: store, env: {}, reuse: { kind: "one-shot" } }), [
    { value: { todos: [] }, version: 3 },
    "denied",
  ]);
  assert.deepEqual(connectorCalls, ["invoke"], "anonymous callers never reach connectors");
  // Without a store handler, store requests are refused.
  assert.deepEqual(await host.invoke({ deployment: deployment, principal: { tenant: "Pg4mQ2", subject: "ann@example.test" }, input: input, env: {}, reuse: { kind: "one-shot" } }), ["denied", "rows"]);
  await host.close();
});

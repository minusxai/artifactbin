import test from "node:test";
import assert from "node:assert/strict";
import { BACKEND_RUNTIME } from "../src/backend/deployment.ts";
import { configureResources } from "../src/connectors/config.ts";
import { withCapabilityAuthority } from "../src/backend/capability-authority.ts";
import type { BackendHost, CompiledBackend } from "../src/backend/contracts.ts";
const version = "a".repeat(64);
const deployment = { version } as CompiledBackend;
test("configuration rejects malformed authority without echoing secrets", () => {
  for (const value of [
    null,
    {},
    {
      resources: {},
      grants: [
        {
          documentId: "doc",
          backendVersion: "*",
          resource: "x",
          namedOperations: ["get"],
        },
      ],
    },
    { resources: { constructor: { kind: "http" } }, grants: [] },
  ])
    assert.throws(
      () => configureResources(value),
      /Invalid resource configuration/,
    );
  assert.throws(
    () =>
      configureResources(
        {
          resources: {
            api: {
              kind: "http",
              origin: "https://example.com",
              tokenEnv: "TOKEN",
              operations: { get: { method: "POST", path: "/get" } },
            },
          },
          grants: [],
        },
        { env: {} },
      ),
    /Invalid resource configuration/,
  );
});
test("exact version grants are captured before backend asynchronous execution", async () => {
  const config: any = {
    resources: {
      db: {
        kind: "postgres",
        connectionStringEnv: "DB",
        operations: {
          get: {
            text: "select $1, $2, $3",
            params: [
              { from: "tenant" },
              { from: "subject" },
              { from: "input", path: ["value"] },
            ],
          },
        },
      },
    },
    grants: [
      {
        documentId: "doc",
        backendVersion: version,
        resource: "db",
        namedOperations: ["get"],
      },
    ],
  };
  const queries: any[] = [];
  let ended = 0;
  const configured = configureResources(config, {
    env: { DB: "secret" },
    poolFactory: () => ({
      async connect() {
        return {
          async query(text, params) {
            queries.push([text, params]);
            return { rows: [] };
          },
          release() {},
        };
      },
      async end() {
        ended++;
      },
    }),
  });
  config.grants[0].namedOperations.length = 0;
  const host: BackendHost = {
    async compile() {
      return deployment;
    },
    async invoke({ deployment: _d, principal: p, input: _i, signal: s, capabilityHandler: handler }) {
      await Promise.resolve();
      return handler!(
        p,
        {
          kind: "invoke",
          resource: "db",
          operation: "get",
          input: { value: 3 },
        },
        s ?? new AbortController().signal,
      );
    },
  };
  const secured = withCapabilityAuthority(host, configured);
  await secured.invoke(
    { deployment: deployment, principal: { tenant: "doc", subject: "actor" }, input: { field: "get", args: { tenant: "spoof" } }, env: {}, reuse: { kind: "one-shot" } },
  );
  assert.ok(
    queries.some(
      ([sql, params]) =>
        sql === "select $1, $2, $3" &&
        JSON.stringify(params) === '["doc","actor",3]',
    ),
  );
  await assert.rejects(
    secured.invoke(
      { deployment: { ...deployment, version: "b".repeat(64) }, principal: { tenant: "doc", subject: "actor" }, input: { field: "get", args: {} }, env: {}, reuse: { kind: "one-shot" } },
    ),
  );
  await assert.rejects(
    secured.invoke(
      { deployment: deployment, principal: { tenant: "other", subject: "actor" }, input: { field: "get", args: {} }, env: {}, reuse: { kind: "one-shot" } },
    ),
  );
  await secured.close();
  await secured.close();
  assert.equal(ended, 1);
});
test("zero grants deny capabilities and closing closes underlying host once", async () => {
  let calls = 0,
    closed = 0;
  const resources = configureResources({ resources: {}, grants: [] });
  const secured = withCapabilityAuthority(
    {
      async compile() {
        return deployment;
      },
      async invoke({ deployment: _d, principal: p, input: _i, signal: _s, capabilityHandler: h }) {
        calls++;
        return h!(
          p,
          {
            kind: "invoke",
            resource: "constructor",
            operation: "get",
            input: null,
          },
          new AbortController().signal,
        );
      },
      async close() {
        closed++;
      },
    } as BackendHost,
    resources,
  );
  await assert.rejects(
    secured.invoke(
      { deployment: deployment, principal: { tenant: "doc", subject: "actor" }, input: { field: "get", args: null }, env: {}, reuse: { kind: "one-shot" } },
    ),
  );
  assert.equal(calls, 1);
  await secured.close();
  await secured.close();
  assert.equal(closed, 1);
  await assert.rejects(
    secured.invoke(
      { deployment: deployment, principal: { tenant: "doc", subject: "actor" }, input: { field: "get", args: null }, env: {}, reuse: { kind: "one-shot" } },
    ),
  );
  assert.equal(calls, 1);
});
test("resource validation rejects insecure destinations and prototype selectors before allocation", () => {
  let pools = 0;
  const base: any = {
    resources: {
      api: {
        kind: "http",
        origin: "http://example.com",
        tokenEnv: "TOKEN",
        operations: { get: { method: "POST", path: "/get" } },
      },
    },
    grants: [],
  };
  assert.throws(
    () => configureResources(base, { env: { TOKEN: "do-not-print" } }),
    (e) => String(e) === "Error: Invalid resource configuration",
  );
  base.resources = {
    db: {
      kind: "postgres",
      connectionStringEnv: "DB",
      operations: {
        get: {
          text: "select $1",
          params: [{ from: "input", path: ["constructor"] }],
        },
      },
    },
  };
  assert.throws(() =>
    configureResources(base, {
      env: { DB: "do-not-print" },
      poolFactory: () => {
        pools++;
        throw Error("unexpected");
      },
    }),
  );
  assert.equal(pools, 0);
});
test("service configuration uses explicit remote transport and denies implicit resources", async () => {
  const { serviceConfig } = await import("../src/config.js");
  assert.equal(serviceConfig({}).backendHost, undefined);
  assert.throws(
    () => serviceConfig({ PAGEGI_RESOURCE_CONFIG: "/absent" }),
    /requires backend/,
  );
  assert.throws(
    () => serviceConfig({ PAGEGI_BACKEND_EXECUTOR: "remote" }),
    /transport and secret/,
  );
  assert.throws(
    () =>
      serviceConfig({
        PAGEGI_BACKEND_EXECUTOR: "remote",
        PAGEGI_EXECUTION_SOCKET: "/run/example.sock",
        PAGEGI_EXECUTION_SECRET_FILE: "/absent/private-secret-file",
      }),
    (e) => String(e) === "Error: Unable to read execution secret file",
  );
  const config = serviceConfig({
    PAGEGI_BACKEND_EXECUTOR: "remote",
    PAGEGI_EXECUTION_SOCKET: "/run/example.sock",
    PAGEGI_EXECUTION_SECRET: "x".repeat(32),
  });
  assert.equal(typeof config.backendHost?.invoke, "function");
});
test("idle PostgreSQL pool errors are contained and later requests recover", async () => {
  const { EventEmitter } = await import("node:events");
  const pool = Object.assign(new EventEmitter(), {
    async connect() {
      return {
        async query() {
          return { rows: [{ ok: true }] };
        },
        release() {},
      };
    },
    async end() {
      pool.emit("error", new Error("private close connection string"));
    },
  });
  const configured = configureResources(
    {
      resources: {
        db: {
          kind: "postgres",
          connectionStringEnv: "DB",
          operations: { get: { text: "select 1", params: [] } },
        },
      },
      grants: [],
    },
    { env: { DB: "private database password" }, poolFactory: () => pool },
  );
  assert.doesNotThrow(() =>
    pool.emit("error", new Error("private database password")),
  );
  const result = await configured.host.invoke(
    {
      tenant: "doc",
      subject: "actor",
      grants: [{ resource: "db", operation: "get" }],
    },
    { resource: "db", operation: "get", input: null },
  );
  assert.deepEqual(result, [{ ok: true }]);
  await configured.host.close();
});
test("legacy protocol receives no capability handler without grants", async () => {
  let received: unknown = "unset";
  const host: BackendHost = {
    async compile() {
      return deployment;
    },
    async invoke({ deployment: _d, principal: _p, input: _i, signal: _s, capabilityHandler: h }) {
      received = h;
      return "legacy";
    },
  };
  const secured = withCapabilityAuthority(
    host,
    configureResources({ resources: {}, grants: [] }),
  );
  assert.equal(
    await secured.invoke(
      { deployment: {
        ...deployment,
        runtime: "workerd@1/esbuild@1/protocol@1/image@sha256:abc",
      }, principal: { tenant: "doc", subject: "actor" }, input: { field: "get", args: null }, env: {}, reuse: { kind: "one-shot" } },
    ),
    "legacy",
  );
  assert.equal(received, undefined);
});
test("legacy protocol explicitly rejects bound capability grants before dispatch", async () => {
  let calls = 0;
  const configured = configureResources(
    {
      resources: {
        api: {
          kind: "http",
          origin: "https://example.com",
          tokenEnv: "TOKEN",
          operations: { get: { method: "POST", path: "/get" } },
        },
      },
      grants: [
        {
          documentId: "doc",
          backendVersion: version,
          resource: "api",
          namedOperations: ["get"],
        },
      ],
    },
    { env: { TOKEN: "private" } },
  );
  const secured = withCapabilityAuthority(
    {
      async compile() {
        return deployment;
      },
      async invoke() {
        calls++;
        return null;
      },
    },
    configured,
  );
  await assert.rejects(
    secured.invoke(
      { deployment: {
        ...deployment,
        runtime: "workerd@1/esbuild@1/protocol@1/image@sha256:abc",
      }, principal: { tenant: "doc", subject: "actor" }, input: { field: "get", args: null }, env: {}, reuse: { kind: "one-shot" } },
    ),
    /deployment_invalid/,
  );
  assert.equal(calls, 0);
  await secured.close();
});
test("effect routes are no longer a configuration key", () => {
  const config = {
    resources: {
      api: {
        kind: "http",
        origin: "https://example.com",
        tokenEnv: "TOKEN",
        operations: { deliver: { method: "POST", path: "/deliver" } },
      },
    },
    grants: [],
    effects: [{ documentId: "doc", resource: "api", operation: "deliver", idempotent: true }],
  };
  assert.throws(
    () => configureResources(config, { env: { TOKEN: "private" } }),
    /Invalid resource configuration/,
  );
});
test("authority close awaits both cleanups on failure and blocks compile immediately", async () => {
  let release!: () => void,
    backendCloses = 0,
    connectorCloses = 0,
    compiles = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const configured = {
    grants: [],
    host: {
      async invoke() {
        return null;
      },
      async transaction() {
        return [];
      },
      close() {
        connectorCloses++;
        throw Error("private provider failure");
      },
    },
  };
  const host: BackendHost & { close(): Promise<void> } = {
    async compile() {
      compiles++;
      return deployment;
    },
    async invoke() {
      return null;
    },
    close() {
      backendCloses++;
      return pending;
    },
  };
  const secured = withCapabilityAuthority(host, configured);
  let settled = false;
  const closing = secured.close();
  const observed = closing.then(
    () => {
      settled = true;
      return null;
    },
    (error) => {
      settled = true;
      return error;
    },
  );
  assert.equal(secured.close(), closing);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(connectorCloses, 1);
  assert.equal(backendCloses, 1);
  assert.equal(settled, false);
  await assert.rejects(secured.compile("unused"), /backend_unavailable/);
  assert.equal(compiles, 0);
  release();
  const error = await observed;
  assert.equal(error?.message, "cleanup_failed");
  assert.equal(settled, true);
});

test("capability authority preserves trusted backend-file scope in both protocol paths", async () => {
  for (const runtime of ["workerd/esbuild/protocol@1/image:x", BACKEND_RUNTIME + "/image:sha256:" + "a".repeat(64)]) {
    const received: Parameters<BackendHost["invoke"]>[] = [];
    const backend: BackendHost = {
      compile: async () => deployment,
      invoke: async (...args) => { received.push(args); return null; },
    };
    const secured = withCapabilityAuthority(backend, configureResources({ resources: {}, grants: [] }));
    const artifact = { ...deployment, runtime };
    const scope = Object.freeze({ owner: "backend-owner", fileId: "backend-file" });
    const env = Object.freeze({ TOKEN: "test-value" });
    try {
      for (const subject of ["viewer", null]) {
        await secured.invoke(
          { deployment: artifact, principal: { tenant: "viewing-page", subject }, input: { field: "get", args: { scope: { owner: "forged", fileId: "forged" } } }, env: env, reuse: { kind: "file", scope: scope } },
        );
        const call = received.at(-1)!;
        assert.deepEqual(call[0].reuse, { kind: "file", scope }, runtime);
        assert.equal(call[0].env, env, runtime);
        assert.equal(typeof call[0].capabilityHandler, runtime.includes("/protocol@1/") ? "undefined" : "function");
      }
      await secured.invoke({ deployment: artifact, principal: { tenant: "viewing-page", subject: null }, input: { field: "get", args: null }, env: {}, reuse: { kind: "one-shot" } });
      assert.deepEqual(received.at(-1)![0].reuse, { kind: "one-shot" }, "one-shot disposition is preserved");
    } finally {
      await secured.close();
    }
  }
});

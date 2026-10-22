import test from "node:test";
import assert from "node:assert/strict";
import { createConnectorHost } from "../src/connectors/index.ts";
const caller = {
  tenant: "a",
  subject: "u",
  grants: [{ resource: "api", operation: "send" }],
};
test("connector denies missing grants and inherited operation names before dispatch", async () => {
  const host = createConnectorHost({
    api: {
      kind: "http",
      origin: "https://example.invalid",
      token: "secret",
      operations: { send: { path: "/", method: "POST" } },
    },
  });
  await assert.rejects(
    host.invoke(
      { ...caller, grants: [] },
      { resource: "api", operation: "send", input: null },
    ),
    { code: "DENIED", outcome: "not-executed" },
  );
  await assert.rejects(
    host.invoke(
      { ...caller, grants: [{ resource: "api", operation: "toString" }] },
      { resource: "api", operation: "toString", input: null },
    ),
    { code: "DENIED" },
  );
  await host.close();
});
test("connector rejects non JSON values without invoking accessors", async () => {
  const host = createConnectorHost({});
  let reads = 0;
  const input = Object.defineProperty({}, "x", {
    enumerable: true,
    get() {
      reads++;
      return 1;
    },
  });
  await assert.rejects(
    host.invoke(caller, { resource: "api", operation: "send", input }),
    { code: "INVALID" },
  );
  assert.equal(reads, 0);
  await host.close();
});

import { createServer } from "node:http";
import { once } from "node:events";
import { testDatabase } from "./postgres.js";
import type { PgPool } from "../src/connectors/contracts.ts";
test("HTTP fixed destination injects trusted identity and bounds failures without retries", async () => {
  let requests = 0;
  const received: unknown[] = [];
  const server = createServer(async (req, res) => {
    requests++;
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push({
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/ok" }).end();
      return;
    }
    if (req.url === "/lost") {
      req.socket.destroy();
      return;
    }
    if (req.url === "/large") {
      res.end(JSON.stringify("x".repeat(2000)));
      return;
    }
    if (req.url === "/slow") {
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const operations = Object.fromEntries(
    ["ok", "redirect", "lost", "large", "slow"].map((name) => [
      name,
      { path: "/" + name, method: "POST" as const },
    ]),
  );
  const host = createConnectorHost(
    {
      api: {
        kind: "http",
        origin: `http://127.0.0.1:${address.port}`,
        token: "host-only",
        operations,
      },
    },
    { allowLoopbackHttp: true, maxBytes: 1024, timeoutMs: 80 },
  );
  const trusted = {
    tenant: "a",
    subject: "u",
    grants: Object.keys(operations).map((operation) => ({
      resource: "api",
      operation,
    })),
  };
  try {
    assert.deepEqual(
      await host.invoke(trusted, {
        resource: "api",
        operation: "ok",
        input: { tenant: "forged" },
      }),
      { ok: true },
    );
    assert.deepEqual(received[0], {
      authorization: "Bearer host-only",
      body: {
        caller: { tenant: "a", subject: "u" },
        input: { tenant: "forged" },
      },
    });
    for (const operation of ["redirect", "lost"])
      await assert.rejects(
        host.invoke(trusted, { resource: "api", operation, input: null }),
        { code: "UNAVAILABLE", outcome: "unknown" },
      );
    await assert.rejects(
      host.invoke(trusted, {
        resource: "api",
        operation: "large",
        input: null,
      }),
      { code: "INVALID", outcome: "unknown" },
    );
    await assert.rejects(
      host.invoke(trusted, { resource: "api", operation: "slow", input: null }),
      { code: "TIMEOUT" },
    );
    assert.equal(requests, 5);
  } finally {
    await host.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("HTTP cleartext and escaped destinations are rejected at binding installation", () => {
  for (const origin of ["http://example.invalid", "http://127.0.0.1"])
    assert.throws(
      () =>
        createConnectorHost({
          api: {
            kind: "http",
            origin,
            token: "x",
            operations: { send: { path: "/", method: "POST" } },
          },
        }),
      { code: "INVALID" },
    );
  assert.throws(
    () =>
      createConnectorHost({
        api: {
          kind: "http",
          origin: "https://example.invalid",
          token: "x",
          operations: {
            send: { path: "https://other.invalid", method: "POST" },
          },
        },
      }),
    { code: "INVALID" },
  );
});
test("real PostgreSQL parameterization, tenant scoping, rollback and server timeout", async () => {
  const db = await testDatabase();
  await db.pool.query(
    "CREATE TABLE items (tenant text, id text, value text, PRIMARY KEY(tenant,id))",
  );
  const operations = {
    put: {
      text: "INSERT INTO items VALUES ($1,$2,$3) RETURNING id",
      params: (c: typeof caller, input: any) => [
        c.tenant,
        input.id,
        input.value,
      ],
    },
    list: {
      text: "SELECT id,value FROM items WHERE tenant=$1 ORDER BY id",
      params: (c: typeof caller) => [c.tenant],
    },
    slow: { text: "SELECT pg_sleep(1)", params: () => [] },
  };
  let slowQueries = 0,
    serverTimeouts = 0;
  const host = createConnectorHost(
    {
      db: {
        kind: "postgres",
        pool: {
          connect: async () => {
            const client = await db.pool.connect();
            return {
              async query(text: string, values?: unknown[]) {
                if (text === operations.slow.text) slowQueries++;
                try {
                  // Test PostgreSQL's statement deadline independently of the host's
                  // total checkout/setup deadline; both previously raced at 80ms.
                  return await client.query(
                    text,
                    text === "SELECT set_config('statement_timeout',$1,true)"
                      ? ["80"]
                      : values,
                  );
                } catch (error) {
                  if ((error as { code?: string }).code === "57014")
                    serverTimeouts++;
                  throw error;
                }
              },
              release: (destroy?: boolean) => client.release(destroy),
            };
          },
          end: async () => {},
        } as PgPool,
        operations,
      },
    },
    { timeoutMs: 10000 },
  );
  const principal = {
    ...caller,
    grants: Object.keys(operations).map((operation) => ({
      resource: "db",
      operation,
    })),
  };
  try {
    const value = "'; DROP TABLE items; --";
    await host.invoke(principal, {
      resource: "db",
      operation: "put",
      input: { id: "one", value },
    });
    assert.deepEqual(
      await host.invoke(
        { ...principal, tenant: "b" },
        { resource: "db", operation: "list", input: null },
      ),
      [],
    );
    assert.deepEqual(
      await host.invoke(principal, {
        resource: "db",
        operation: "list",
        input: null,
      }),
      [{ id: "one", value }],
    );
    await assert.rejects(
      host.transaction(principal, "db", [
        { operation: "put", input: { id: "two", value: "x" } },
        { operation: "put", input: { id: "one", value: "x" } },
      ]),
      { code: "CONFLICT", outcome: "unknown" },
    );
    assert.equal((await db.pool.query("SELECT * FROM items")).rows.length, 1);
    await assert.rejects(
      host.invoke(principal, {
        resource: "db",
        operation: "slow",
        input: null,
      }),
      { code: "TIMEOUT", outcome: "unknown" },
    );
    assert.equal(slowQueries, 1);
    assert.equal(
      serverTimeouts,
      1,
      "PostgreSQL must report statement cancellation",
    );
    await assert.rejects(
      host.transaction(principal, "db", [
        { operation: "put", input: { id: "cancelled", value: "x" } },
        { operation: "slow", input: null },
      ]),
      { code: "TIMEOUT", outcome: "unknown" },
    );
    assert.equal(slowQueries, 2);
    assert.equal(
      serverTimeouts,
      2,
      "transaction timeout must also come from PostgreSQL",
    );
    assert.deepEqual(
      await host.invoke(principal, {
        resource: "db",
        operation: "list",
        input: null,
      }),
      [{ id: "one", value }],
    );
  } finally {
    await host.close();
    await db.cleanup();
  }
});
test("queued acquisition captures input, bounds abandoned checkouts and destroys late clients", async () => {
  let resolve!: (client: any) => void,
    releases = 0,
    ended = 0;
  const pool: PgPool = {
    connect: () =>
      new Promise((r) => {
        resolve = r;
      }),
    end: async () => {
      ended++;
    },
  };
  const host = createConnectorHost(
    {
      db: {
        kind: "postgres",
        pool,
        operations: {
          read: { text: "SELECT $1", params: (c, input) => [c.tenant, input] },
        },
      },
    },
    { timeoutMs: 20, maxActive: 1, maxPendingAcquisitions: 1 },
  );
  const principal = {
    ...caller,
    grants: [{ resource: "db", operation: "read" }],
  };
  const call = host.invoke(principal, {
    resource: "db",
    operation: "read",
    input: { x: 1 },
  });
  await assert.rejects(
    host.invoke(principal, { resource: "db", operation: "read", input: null }),
    { code: "UNAVAILABLE", outcome: "not-executed" },
  );
  await assert.rejects(call, { code: "TIMEOUT", outcome: "not-executed" });
  await assert.rejects(
    host.invoke(principal, { resource: "db", operation: "read", input: null }),
    { code: "UNAVAILABLE" },
  );
  await host.close();
  resolve({
    query: async () => ({ rows: [] }),
    release: (destroy: boolean) => {
      assert.equal(destroy, true);
      releases++;
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(releases, 1);
  assert.equal(ended, 1);
  await assert.rejects(
    host.invoke(principal, { resource: "db", operation: "read", input: null }),
    { code: "CLOSED" },
  );
});

test("waiting invocation retains original caller, input and operation binding", async () => {
  let releaseCheckout!: (c: any) => void;
  const values: unknown[][] = [];
  const binding = {
    kind: "postgres" as const,
    pool: {
      connect: () =>
        new Promise<any>((r) => {
          releaseCheckout = r;
        }),
      end: async () => {},
    },
    operations: {
      read: {
        text: "SELECT original",
        params: (c: typeof caller, input: any) => [c.tenant, input.x],
      },
    },
  };
  const host = createConnectorHost({ db: binding });
  const input = { x: 1 };
  const principal = {
    ...caller,
    grants: [{ resource: "db", operation: "read" }],
  };
  const pending = host.invoke(principal, {
    resource: "db",
    operation: "read",
    input,
  });
  principal.tenant = "changed";
  input.x = 2;
  binding.operations.read.text = "SELECT changed";
  await new Promise((r) => setImmediate(r));
  releaseCheckout({
    query: async (text: string, params: unknown[]) => {
      if (text === "SELECT original") values.push(params);
      return { rows: [] };
    },
    release: () => {},
  });
  assert.deepEqual(await pending, []);
  assert.deepEqual(values, [["a", 1]]);
  await host.close();
});
test("pre-cancellation does not acquire and active close aborts a checkout", async () => {
  let connects = 0,
    releases = 0;
  const host = createConnectorHost({
    db: {
      kind: "postgres",
      pool: {
        connect: async () => {
          connects++;
          return {
            query: () => new Promise<any>(() => {}),
            release: () => {
              releases++;
            },
          };
        },
        end: async () => {},
      },
      operations: { read: { text: "SELECT 1", params: () => [] } },
    },
  });
  const principal = {
    ...caller,
    grants: [{ resource: "db", operation: "read" }],
  };
  const signal = AbortSignal.abort();
  await assert.rejects(
    host.invoke(
      principal,
      { resource: "db", operation: "read", input: null },
      signal,
    ),
    { code: "CANCELLED", outcome: "not-executed" },
  );
  assert.equal(connects, 0);
  const pending = host.invoke(principal, {
    resource: "db",
    operation: "read",
    input: null,
  });
  await new Promise((r) => setImmediate(r));
  await host.close();
  await assert.rejects(pending, { code: "CANCELLED", outcome: "not-executed" });
  assert.equal(releases, 1);
});
test("JSON rejects decorated, sparse, cyclic and oversized inputs", async () => {
  const host = createConnectorHost({}, { maxBytes: 512 });
  const cycle: any = {};
  cycle.self = cycle;
  const decorated: any[] = [1];
  Object.assign(decorated, { other: 2 });
  for (const input of [
    NaN,
    Infinity,
    1n,
    undefined,
    new Date(),
    [undefined],
    Array(2),
    decorated,
    cycle,
    "x".repeat(513),
    { x: () => 0 },
  ]) {
    await assert.rejects(
      host.invoke(caller, {
        resource: "api",
        operation: "send",
        input: input as any,
      }),
      { code: "INVALID", outcome: "not-executed" },
    );
  }
  await host.close();
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)("pg");
import { createService } from "../src/server.js";
import { createConnectorHost } from "../src/connectors/index.ts";
import { withCapabilityAuthority } from "../src/backend/capability-authority.ts";
import type { BackendHost, CompiledBackend } from "../src/backend/contracts.ts";
import { testDatabase } from "./postgres.js";

test("application close awaits active connector cancellation and disposes pools exactly once", async () => {
  const db = await testDatabase();
  const pool = new pg.Pool({ connectionString: db.connectionString });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let ended = 0;
  const connectors = createConnectorHost({
    db: {
      kind: "postgres",
      pool: {
        connect: async () => {
          const client = await pool.connect();
          return {
            query: (text: string, values?: unknown[]) => {
              const result = client.query(text, values);
              if (text === "SELECT pg_sleep(30)") entered();
              return result;
            },
            release: (destroy?: boolean) => client.release(destroy),
          };
        },
        end: async () => {
          ended++;
          await pool.end();
        },
      },
      operations: { slow: { text: "SELECT pg_sleep(30)", params: () => [] } },
    },
  });
  const version = "a".repeat(64);
  const deployment = { version } as CompiledBackend;
  const host = withCapabilityAuthority(
    {
      compile: async () => deployment,
      invoke: async ({ deployment: _d, principal: p, input: _i, signal, capabilityHandler: handler }) =>
        handler!(
          p,
          {
            kind: "invoke",
            resource: "db",
            operation: "slow",
            input: null,
          },
          signal ?? new AbortController().signal,
        ),
    },
    {
      host: connectors,
      grants: [
        {
          documentId: "doc",
          backendVersion: version,
          resource: "db",
          namedOperations: ["slow"],
        },
      ],
    },
  );
  const service = createService({ ...db, backendHost: host });
  const running = host.invoke(
    { deployment: deployment, principal: { tenant: "doc", subject: "actor" }, input: { field: "slow", args: null }, env: {}, reuse: { kind: "one-shot" } },
  );
  const rejected = assert.rejects(running, { code: "CANCELLED" });
  try {
    await started;
    const first = service.close();
    assert.equal(service.close(), first);
    await first;
    await rejected;
    assert.equal(ended, 1);
    assert.equal(pool.totalCount, 0);
    await assert.rejects(
      host.invoke(
        { deployment: deployment, principal: { tenant: "doc", subject: "actor" }, input: { field: "slow", args: null }, env: {}, reuse: { kind: "one-shot" } },
      ),
      { code: "CLOSED" },
    );
  } finally {
    await host.close();
    await service.close();
    await db.cleanup();
  }
});

test("backend disposal failure still closes repository and repeated close shares failure", async () => {
  const db = await testDatabase();
  const failure = new Error("backend disposal failed");
  let closes = 0;
  const host: BackendHost = {
    compile: async () => {
      throw Error("unused");
    },
    invoke: async () => null,
    close: async () => {
      closes++;
      throw failure;
    },
  };
  const service = createService({ ...db, backendHost: host });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const origin = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(origin + "/health")).status, 200);
    const first = service.close();
    assert.equal(service.close(), first);
    await assert.rejects(first, (error) => error === failure);
    assert.equal(closes, 1);
    assert.equal((await fetch(origin + "/health")).status, 500);
    await assert.rejects(service.close(), (error) => error === failure);
    assert.equal(closes, 1);
  } finally {
    service.server.closeAllConnections();
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
    await service.close().catch(() => {});
    await db.cleanup();
  }
});

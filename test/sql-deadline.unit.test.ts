import test from "node:test";
import assert from "node:assert/strict";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import type { SqlClient } from "../src/persistence/sql-contracts.ts";
test("aborted SQL pool wait never starts work and discards a late acquired connection", async () => {
  let deliver!: (client: SqlClient) => void;
  const releases: unknown[] = [];
  const queries: string[] = [];
  const client: SqlClient = {
    query: async (text) => {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    },
    release: (value) => {
      releases.push(value);
    },
  };
  const db = createSqlDatabase({
    pool: {
      connect: () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    },
    initialize: async () => {},
    statementTimeoutMs: 15000,
  });
  const abort = new AbortController();
  let work = 0;
  const pending = db.transaction(
    async () => {
      work++;
    },
    { timeoutMs: 1000, signal: abort.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  await assert.rejects(pending);
  deliver(client);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(work, 0);
  assert.deepEqual(queries, []);
  assert.deepEqual(releases, [true]);
});
test("aborting an active driver discards once and prevents subsequent queries", async () => {
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const releases: unknown[] = [];
  const queries: string[] = [];
  const client: SqlClient = {
    query: async (text) => {
      queries.push(text);
      if (text === "SELECT blocked") {
        entered();
        return new Promise(() => {});
      }
      return { rows: [], rowCount: 0 };
    },
    release: (value) => {
      releases.push(value);
    },
  };
  const db = createSqlDatabase({
    pool: { connect: async () => client },
    initialize: async () => {},
    statementTimeoutMs: 15000,
  });
  const abort = new AbortController();
  const pending = db.transaction(
    async (c) => {
      await c.query("SELECT blocked");
      await c.query("SELECT forbidden");
    },
    { timeoutMs: 1000, signal: abort.signal },
  );
  await ready;
  abort.abort();
  await assert.rejects(pending);
  assert.deepEqual(releases, [true]);
  assert.equal(queries.includes("SELECT forbidden"), false);
  assert.ok(
    queries.some(
      (q) =>
        /^SET LOCAL statement_timeout='\d+ms'$/.test(q) && !q.includes("15000"),
    ),
  );
});

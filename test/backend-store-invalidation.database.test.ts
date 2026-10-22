import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createBackendStore } from "../src/backend/af-store.ts";
test("store commits emit one durable event; CAS conflicts and rolled-back writes emit none", async () => {
  const env = await testDatabase();
  try {
    await env.pool.query(
      await readFile(
        new URL("../src/backend/af-schema.sql", import.meta.url),
        "utf8",
      ),
    );
    await env.pool.query(
      "INSERT INTO af_backend_files(file_id,owner,head_version) VALUES('Bk0001','owner','one')",
    );
    const store = createBackendStore(
      createSqlDatabase({
        pool: env.pool,
        initialize: async () => {},
        statementTimeoutMs: 15000,
      }),
    );
    await store.set("Bk0001", { n: 1 }, 0);
    await store.set("Bk0001", { n: 2 }, 0);
    const events = await env.pool.query(
      "SELECT backend_id,store_version FROM backend_store_invalidations ORDER BY sequence",
    );
    assert.deepEqual(events.rows, [
      { backend_id: "Bk0001", store_version: "1" },
    ]);
    await env.pool.query(
      "CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic event failure'; END $$",
    );
    await env.pool.query(
      "CREATE TRIGGER reject_event BEFORE INSERT ON backend_store_invalidations FOR EACH ROW EXECUTE FUNCTION reject_event()",
    );
    await assert.rejects(
      store.set("Bk0001", { n: 2 }, 1),
      /synthetic event failure/,
    );
    assert.deepEqual(await store.get("Bk0001"), {
      value: { n: 1 },
      version: 1,
    });
    await env.pool.query(
      "DROP TRIGGER reject_event ON backend_store_invalidations",
    );
    const results = await Promise.all(
      [2, 3, 4].map((n) => store.set("Bk0001", { n }, 1)),
    );
    assert.equal(results.filter((r) => !("conflict" in r)).length, 1);
    assert.equal(
      (
        await env.pool.query(
          "SELECT count(*)::int n FROM backend_store_invalidations",
        )
      ).rows[0].n,
      2,
    );
  } finally {
    await env.cleanup();
  }
});

test("store outbox sequence allocation cannot overtake an earlier uncommitted event", async () => {
  const env = await testDatabase();
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (started = r));
  try {
    await env.pool.query(
      await readFile(
        new URL("../src/backend/af-schema.sql", import.meta.url),
        "utf8",
      ),
    );
    await env.pool.query(
      "INSERT INTO af_backend_files(file_id,owner,head_version) VALUES('Bk0001','owner','one'),('Bk0002','owner','two')",
    );
    const database = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    const first = createBackendStore({
      transaction: (work) =>
        database.transaction(async (client) => {
          const result = await work(client);
          started();
          await held;
          return result;
        }),
    });
    const ordinary = createBackendStore(database);
    const write1 = first.set("Bk0001", { n: 1 }, 0);
    await ready;
    let secondSettled = false;
    const write2 = ordinary.set("Bk0002", { n: 2 }, 0).then((r) => {
      secondSettled = true;
      return r;
    });
    // Barrier via PostgreSQL lock state rather than timing assumptions.
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await env.pool.query(
        "SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
      );
      if (waiting.rows[0].n > 0) break;
      if (attempt === 99)
        assert.fail(
          "second event never waited for the transaction ordering lock",
        );
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(secondSettled, false);
    assert.equal(
      (
        await env.pool.query(
          "SELECT count(*)::int n FROM backend_store_invalidations",
        )
      ).rows[0].n,
      0,
    );
    release();
    await Promise.all([write1, write2]);
    assert.deepEqual(
      (
        await env.pool.query(
          "SELECT backend_id FROM backend_store_invalidations ORDER BY sequence",
        )
      ).rows.map((r: { backend_id: string }) => r.backend_id),
      ["Bk0001", "Bk0002"],
    );
  } finally {
    release();
    await env.cleanup();
  }
});

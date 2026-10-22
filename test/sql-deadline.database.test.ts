import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createDatasetPersonRepository } from "../src/persistence/dataset-person.ts";
test("person registry reads stop at a bounded PostgreSQL deadline without changing normal transaction limits", async () => {
  const env = await testDatabase();
  const lock = await env.pool.connect();
  try {
    for (const path of [
      "schema.sql",
      "backend/af-schema.sql",
      "datasets/schema.sql",
    ])
      await env.pool.query(
        await readFile(new URL("../src/" + path, import.meta.url), "utf8"),
      );
    const database = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    const normal = await database.transaction(
      async (c) =>
        (await c.query("SHOW statement_timeout")).rows[0]!.statement_timeout,
    );
    assert.equal(normal, "15s");
    await lock.query("BEGIN");
    await lock.query(
      "LOCK TABLE dataset_public_profiles IN ACCESS EXCLUSIVE MODE",
    );
    const start = Date.now();
    await assert.rejects(
      createDatasetPersonRepository(database).card("fixture", "user"),
    );
    assert.ok(
      Date.now() - start < 2000,
      "person lookup must not inherit the 15 second global timeout",
    );
    // The lock stays held: a vanished wait therefore demonstrates server-side deadline/disconnect cleanup, not successful completion.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const active = await env.pool.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE state='active' AND query LIKE 'SELECT name,handle,image FROM dataset_public_profiles%' AND pid<>pg_backend_pid()",
    );
    assert.equal(active.rows[0].count, 0);
    await lock.query("ROLLBACK");
    assert.equal(
      await createDatasetPersonRepository(database).card("fixture", "user"),
      null,
    );
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
    await env.cleanup();
  }
});

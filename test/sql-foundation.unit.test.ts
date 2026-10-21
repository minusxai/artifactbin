import test from "node:test";
import assert from "node:assert/strict";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import type { SqlClient, SqlDatabaseOptions } from "../src/persistence/sql.ts";
function fixture(failure?: "commit" | "rollback") {
  const releases: Array<Error | boolean | undefined> = [];
  let initialized = false,
    active = false,
    committed = false,
    finishCommit: () => void = () => {};
  const gate = new Promise<void>((resolve) => (finishCommit = resolve));
  const client: SqlClient = {
    async query(text) {
      if (text === "BEGIN") active = true;
      if (text === "COMMIT") {
        await gate;
        if (failure === "commit") throw Error("commit failure");
        committed = true;
        active = false;
      }
      if (text === "ROLLBACK") {
        if (failure === "rollback") throw Error("rollback failure");
        active = false;
      }
      return { rows: [], rowCount: null };
    },
    release(discard) {
      releases.push(discard);
    },
  };
  const options: SqlDatabaseOptions = {
    pool: {
      async connect() {
        assert.equal(initialized, true);
        return client;
      },
    },
    initialize: async () => {
      initialized = true;
    },
    statementTimeoutMs: 15000,
    lockTimeoutMs: 5000,
  };
  return {
    options,
    releases,
    finishCommit,
    active: () => active,
    committed: () => committed,
  };
}
test("SQL transaction resolves only after commit and releases its connection exactly once", async () => {
  const f = fixture();
  let resolved = false;
  const result = createSqlDatabase(f.options)
    .transaction(async () => {
      assert.equal(f.active(), true);
      return "receipt";
    })
    .then((value) => {
      resolved = true;
      return value;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolved, false);
  assert.equal(f.committed(), false);
  assert.deepEqual(f.releases, []);
  f.finishCommit();
  assert.equal(await result, "receipt");
  assert.equal(f.committed(), true);
  assert.deepEqual(f.releases, [undefined]);
});
test("rollback failures discard connections while preserving original operation errors", async () => {
  for (const failure of [undefined, "rollback"] as const) {
    const f = fixture(failure),
      original = Object.assign(Error("policy failure"), { status: 412 });
    await assert.rejects(
      createSqlDatabase(f.options).transaction(async () => {
        throw original;
      }),
      (error) => error === original,
    );
    assert.deepEqual(f.releases, [failure ? true : undefined]);
    assert.equal(f.committed(), false);
  }
});
test("failed commit rolls back, releases normally, and never returns a receipt", async () => {
  const f = fixture("commit");
  f.finishCommit();
  await assert.rejects(
    createSqlDatabase(f.options).transaction(async () => true),
    /commit failure/,
  );
  assert.equal(f.active(), false);
  assert.equal(f.committed(), false);
  assert.deepEqual(f.releases, [undefined]);
});
test("invalid timeout configurations fail before acquiring SQL resources", () => {
  const f = fixture();
  for (const statementTimeoutMs of [-1, NaN, Infinity, 1.5])
    assert.throws(
      () => createSqlDatabase({ ...f.options, statementTimeoutMs }),
      /timeout/i,
    );
  assert.throws(
    () => createSqlDatabase({ ...f.options, lockTimeoutMs: -1 }),
    /timeout/i,
  );
  assert.deepEqual(f.releases, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SQL_POOL_CAPACITY } from "../src/persistence/sql-contracts.ts";
import type { SqlClient, SqlDatabase } from "../src/persistence/sql.ts";
import { withNativeProgramLock } from "../src/server/native-program-lock.ts";
import { NATIVE_PROGRAM_SQL_RESERVED_CONNECTIONS } from "../src/server/native-program-lock-contracts.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
/** Finite shared driver model: transactions occupy clients until their work settles. */
function boundedDatabase(poolCapacity = DEFAULT_SQL_POOL_CAPACITY) {
  let active = 0, peak = 0, transactions = 0, failQuery = false, failAcquisition = false;
  const locks = new Set<string>();
  const database: SqlDatabase = {
    poolCapacity,
    async transaction(work) {
      if (failAcquisition) { failAcquisition = false; throw Error("pool acquisition failed"); }
      if (active === poolCapacity) throw Error("SQL pool exhausted");
      active++; peak = Math.max(peak, active); transactions++;
      const held = new Set<string>();
      const client: SqlClient = {
        release() {},
        async query(_sql, values) {
          if (failQuery) { failQuery = false; throw Error("driver failure"); }
          const key = String(values?.[0]);
          if (locks.has(key)) return { rows: [{ acquired: false }], rowCount: 1 };
          locks.add(key); held.add(key);
          return { rows: [{ acquired: true }], rowCount: 1 };
        },
      };
      try { return await work(client); }
      finally { for (const key of held) locks.delete(key); active--; }
    },
  };
  return { database, get peak() { return peak; }, get active() { return active; }, get transactions() { return transactions; }, failQuery() { failQuery = true; }, failAcquisition() { failAcquisition = true; } };
}

test("distinct native pages across competing hosts reserve shared SQL headroom for reauthorization", async () => {
  const db = boundedDatabase(), entered = deferred(), release = deferred();
  const admitted = db.database.poolCapacity! - NATIVE_PROGRAM_SQL_RESERVED_CONNECTIONS;
  let running = 0;
  const host = (prefix: string, count: number) => Array.from({length: count}, (_, index) =>
    withNativeProgramLock(db.database, prefix + index, async () => {
      running++;
      if (running === admitted) entered.resolve();
      await release.promise;
      return db.database.transaction(async () => "authorized");
    }).then(value => ({value}), error => ({error})));
  const first = host("first", admitted), second = host("second", db.database.poolCapacity!);
  await entered.promise;
  assert.equal(db.active, admitted, "different hosts cannot each take their own admission budget");
  assert.equal(db.transactions, admitted, "over-capacity calls do not queue in the driver");
  release.resolve();
  const results = await Promise.all([...first, ...second]);
  assert.equal(results.filter(r => "value" in r).length, admitted);
  for (const result of results) if ("error" in result) {
    assert.equal(result.error.code, "native_program_capacity");
    assert.equal(result.error.retryable, true);
  }
  assert.ok(db.peak < db.database.poolCapacity!, "authority reads can obtain a connection");
  assert.equal(db.active, 0);
});

test("same-page invocations on competing hosts still hold the database lock through cleanup", async () => {
  const db = boundedDatabase(), entered = deferred(), release = deferred();
  const first = withNativeProgramLock(db.database, "same", async () => { entered.resolve(); await release.promise; return "done"; });
  await entered.promise;
  await assert.rejects(withNativeProgramLock(db.database, "same", async () => "overlap"), /already running/);
  release.resolve(); assert.equal(await first, "done");
  assert.equal(await withNativeProgramLock(db.database, "same", async () => "next"), "next");
});

test("driver failure, execution rejection and cancellation all return admission after cleanup", async () => {
  const db = boundedDatabase();
  for (let index = 0; index < 8; index++) {
    db.failAcquisition();
    await assert.rejects(withNativeProgramLock(db.database, "page", async () => "never"), /pool acquisition failed/);
    db.failQuery();
    await assert.rejects(withNativeProgramLock(db.database, "page", async () => "never"), /driver failure/);
    await assert.rejects(withNativeProgramLock(db.database, "page", async () => { throw Error("run failed"); }), /run failed/);
  }
  const stop = new AbortController(), entered = deferred(), cleanup = deferred();
  const running = withNativeProgramLock(db.database, "cancelled", async () => {
    entered.resolve();
    await new Promise<void>(resolve => stop.signal.addEventListener("abort", () => resolve(), {once:true}));
    await cleanup.promise;
    stop.signal.throwIfAborted();
  }, stop.signal);
  await entered.promise; stop.abort();
  assert.equal(db.active, 1, "abort does not release the lock while isolate cleanup is pending");
  cleanup.resolve(); await assert.rejects(running, /abort/i);
  assert.equal(await withNativeProgramLock(db.database, "cancelled", async () => "next"), "next");
  const before = db.transactions;
  await assert.rejects(withNativeProgramLock(db.database, "cancelled", async () => "never", stop.signal), /abort/i);
  assert.equal(db.transactions, before, "pre-aborted calls acquire neither a permit nor a connection");
});

test("declared pool capacity must leave the reserved headroom before native admission", async () => {
  for (const capacity of [0, 6, 1.5, NaN]) {
    const db = boundedDatabase(capacity);
    await assert.rejects(withNativeProgramLock(db.database, "page", async () => "never"), /capacity/i);
    assert.equal(db.transactions, 0);
  }
});

test("configured smaller pool reserves the same headroom and recovers capacity after successful work", async () => {
  const db = boundedDatabase(NATIVE_PROGRAM_SQL_RESERVED_CONNECTIONS + 2);
  const entered = deferred(), release = deferred(); let count = 0, next = 0;
  const run = () => withNativeProgramLock(db.database, "page" + next++, async () => {
    if (++count === 2) entered.resolve(); await release.promise;
  });
  const first = run(), second = run(); await entered.promise;
  await assert.rejects(withNativeProgramLock(db.database, "third", async () => {}), /busy/);
  release.resolve(); await Promise.all([first, second]);
  assert.equal(await withNativeProgramLock(db.database, "next", async () => "ok"), "ok");
});


test("capacity rejection reports an unexecuted mutation with a retryable code", async () => {
  const { composePageSchema, executePageOperation } = await import("../src/graphql/af-namespaces.ts");
  const db = boundedDatabase(), release = deferred();
  const holders = Array.from({ length: DEFAULT_SQL_POOL_CAPACITY - NATIVE_PROGRAM_SQL_RESERVED_CONNECTIONS }, (_, i) =>
    withNativeProgramLock(db.database, String(i), () => release.promise));
  let executed = false;
  try {
    const schema = composePageSchema([{ name: "tasks", fileId: "Bk7Qa2", version: "v1", typeDefs: "type Query { count: Int! } type Mutation { add: Int! }" }]);
    const result = await executePageOperation({ schema,
      caller: { pageId: "Pg4mQ2", subject: "owner@example.test", role: "OWNER" },
      request: { query: "mutation { tasks { add } }" },
      invoke: () => withNativeProgramLock(db.database, "extra", async () => { executed = true; return 1; }),
    });
    assert.equal(executed, false);
    assert.deepEqual(result.extensions?.outcomes, { "tasks.add": "rejected" });
    assert.equal(result.errors?.[0]?.extensions?.code, "native_program_capacity");
  } finally { release.resolve(); await Promise.all(holders); }
});

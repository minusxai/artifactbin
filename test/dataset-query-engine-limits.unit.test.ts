/**
 * The SQLite engine's resource bounds (src/datasets/sql/engine/database.ts):
 * a statement is interrupted at its deadline and reported as TimedOut, the
 * database stays usable afterwards, oversized statement text is refused
 * before it runs, EXPLAIN is not a read, and a row limit reports `more`
 * instead of stepping on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSqliteModule } from "../src/datasets/sql/engine/wasm.ts";
import { Refused, SqliteDatabase, TimedOut } from "../src/datasets/sql/engine/database.ts";

/** Counts far past what fits in any budget; the progress handler is the only thing that stops it. */
const SLOW = "with recursive c(x) as (select 1 union all select x + 1 from c where x < 1000000000) select count(*) as n from c";

test("a statement past its deadline is interrupted as TimedOut near the budget, and the database stays usable", async () => {
  const db = new SqliteDatabase(await loadSqliteModule());
  try {
    const started = performance.now();
    const slow = db.prepare(SLOW, "read");
    try {
      assert.throws(() => slow.bind({}).rows(10, 50), TimedOut);
    } finally {
      slow.finalize();
    }
    assert.ok(performance.now() - started < 2000, "interrupted near 50 ms, not when the count finished");
    const quick = db.prepare("select 1 as n", "read");
    try {
      assert.deepEqual(quick.bind({}).rows(10, 50).rows, [{ n: 1 }]);
    } finally {
      quick.finalize();
    }
    const again = db.prepare(SLOW, "read");
    try {
      assert.throws(() => again.bind({}).rows(10, 50), TimedOut, "a second deadline interrupts again");
    } finally {
      again.finalize();
    }
  } finally {
    db.close();
  }
});

test("a row limit reports more rows without stepping past the limit, and a fitting result reports none", async () => {
  const db = new SqliteDatabase(await loadSqliteModule());
  try {
    const five = db.prepare("with recursive c(x) as (select 1 union all select x + 1 from c where x < 5) select x from c", "read");
    try {
      const limited = five.bind({}).rows(2, 1000);
      assert.equal(limited.rows.length, 2);
      assert.equal(limited.more, true);
    } finally {
      five.finalize();
    }
    const fits = db.prepare("with recursive c(x) as (select 1 union all select x + 1 from c where x < 5) select x from c", "read");
    try {
      const all = fits.bind({}).rows(5, 1000);
      assert.equal(all.rows.length, 5);
      assert.equal(all.more, false);
    } finally {
      fits.finalize();
    }
  } finally {
    db.close();
  }
});

test("statement text past 1 MB is refused before it runs, and the database stays usable", async () => {
  const db = new SqliteDatabase(await loadSqliteModule());
  try {
    const huge = "select 1 as n where 'x' = '" + "a".repeat(1_000_001) + "'";
    assert.throws(() => db.prepare(huge, "read"), Error);
    const quick = db.prepare("select 2 as n", "read");
    try {
      assert.deepEqual(quick.bind({}).rows(1, 50).rows, [{ n: 2 }]);
    } finally {
      quick.finalize();
    }
  } finally {
    db.close();
  }
});

test("EXPLAIN and EXPLAIN QUERY PLAN are refused as reads", async () => {
  const db = new SqliteDatabase(await loadSqliteModule());
  try {
    for (const sql of ["explain select 1", "explain query plan select 1"])
      assert.throws(() => db.prepare(sql, "read"), Refused, sql);
  } finally {
    db.close();
  }
});

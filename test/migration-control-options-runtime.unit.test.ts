import test from "node:test";
import assert from "node:assert/strict";
import { completeControlOptions } from "../src/migration/conversion/compiled/control-options.ts";
import type { CompiledDisplayTable } from "../src/migration/conversion/compiled/data-control-contracts.ts";
function clock() {
  let time = 0;
  const jobs = new Set<{ at: number; run: () => void }>();
  return {
    now: () => time,
    schedule: (run: () => void, delay: number) => {
      const job = { at: time + delay, run };
      jobs.add(job);
      return () => {
        jobs.delete(job);
      };
    },
    advance: (ms: number) => {
      time += ms;
      for (const job of [...jobs])
        if (job.at <= time) {
          jobs.delete(job);
          job.run();
        }
    },
    pending: () => jobs.size,
  };
}
const page = (rows: number[], totalRows = 3): CompiledDisplayTable => ({
  columns: [{ name: "n", type: "number" }],
  rows: rows.map((n) => ({ n })),
  totalRows,
  truncated: rows.length < totalRows,
});
test("completion keeps reader order and legitimate duplicate rows; deadlines are disposed", async () => {
  const time = clock(),
    offsets: number[] = [];
  const initial = page([2]);
  const result = await completeControlOptions(
    initial,
    async (offset, limit, signal) => {
      offsets.push(offset);
      assert.equal(limit, 1);
      assert.equal(signal?.aborted, false);
      return page([offset === 1 ? 2 : 1]);
    },
    { pageSize: 1 },
    time,
  );
  assert.deepEqual(offsets, [1, 2]);
  assert.deepEqual(result.rows, [{ n: 2 }, { n: 2 }, { n: 1 }]);
  assert.equal(initial.rows.length, 1);
  assert.equal(time.pending(), 0);
});
test("deadline cancels a hung read and rejects a late final result", async () => {
  const time = clock();
  let signal: AbortSignal | undefined;
  let finish!: (table: CompiledDisplayTable) => void;
  const pending = completeControlOptions(
    page([1]),
    async (_o, _l, s) => {
      signal = s;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    {},
    time,
  );
  const rejected = assert.rejects(pending, /timed out/);
  time.advance(5000);
  await rejected;
  assert.equal(signal?.aborted, true);
  assert.equal(time.pending(), 0);
  finish(page([2, 3]));
  await Promise.resolve();
});
test("cancellation stops pending reads; fresh retry starts at original offset", async () => {
  const time = clock(),
    controller = new AbortController();
  let signal: AbortSignal | undefined;
  let reads = 0;
  const pending = completeControlOptions(
    page([1]),
    async (_o, _l, s) => {
      reads++;
      signal = s;
      return new Promise(() => {});
    },
    {},
    { ...time, signal: controller.signal },
  );
  const rejected = assert.rejects(pending, /cancelled/);
  controller.abort();
  await rejected;
  assert.equal(signal?.aborted, true);
  assert.equal(time.pending(), 0);
  const retry = await completeControlOptions(
    page([1]),
    async (offset) => {
      assert.equal(offset, 1);
      reads++;
      return page([2, 3]);
    },
    {},
    time,
  );
  assert.equal(retry.rows.length, 3);
  assert.equal(reads, 2);
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(
    completeControlOptions(
      page([1]),
      async () => {
        throw Error("must not read");
      },
      {},
      { ...time, signal: stopped.signal },
    ),
    /cancelled/,
  );
});
test("snapshot changes and failed pages never partially complete or retry automatically", async () => {
  for (const changed of [
    { ...page([2]), totalRows: 4 },
    { ...page([2]), columns: [{ name: "n", type: "string" }] },
    page([]),
  ]) {
    const time = clock();
    let calls = 0;
    await assert.rejects(
      completeControlOptions(
        page([1]),
        async () => {
          calls++;
          return changed;
        },
        {},
        time,
      ),
      /snapshot changed/,
    );
    assert.equal(calls, 1);
    assert.equal(time.pending(), 0);
  }
  const time = clock();
  let calls = 0;
  await assert.rejects(
    completeControlOptions(
      page([1]),
      async () => {
        calls++;
        throw Error("read failed");
      },
      {},
      time,
    ),
    /read failed/,
  );
  assert.equal(calls, 1);
  assert.equal(time.pending(), 0);
});

test("the final page is rejected after the deadline even before its timer callback runs", async () => {
  const time = clock();
  let current = 0;
  await assert.rejects(
    completeControlOptions(
      page([1]),
      async () => {
        current = 5001;
        return page([2, 3]);
      },
      {},
      { ...time, now: () => current },
    ),
    /timed out/,
  );
  assert.equal(time.pending(), 0);
});
test("late page rejection remains observed after deadline cancellation", async () => {
  const time = clock();
  let rejectPage!: (reason: Error) => void;
  const attempt = completeControlOptions(
    page([1]),
    () =>
      new Promise((_resolve, reject) => {
        rejectPage = reject;
      }),
    {},
    time,
  );
  const rejected = assert.rejects(attempt, /timed out/);
  time.advance(5000);
  await rejected;
  rejectPage(Error("late transport failure"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(time.pending(), 0);
});

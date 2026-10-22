import test from "node:test";
import assert from "node:assert/strict";
import { createLiveInvalidationConsumer } from "../src/live-invalidation.ts";
test("independent consumers replay commits after restart and advance only after successful notification", async () => {
  const events = [
    { sequence: "1", pageIds: ["page"] },
    { sequence: "9007199254740993", pageIds: ["page", "other"] },
  ];
  const reader = {
    after: async (sequence: string) =>
      events.filter((e) => BigInt(e.sequence) > BigInt(sequence)),
  };
  let failed = true;
  const seen: string[] = [];
  const first = createLiveInvalidationConsumer({
    reader,
    autoStart: false,
    changed: (page) => {
      if (failed) {
        failed = false;
        throw Error("retry");
      }
      seen.push(page);
    },
  });
  await assert.rejects(first.poll());
  assert.equal(first.sequence, "0");
  await first.poll();
  assert.equal(first.sequence, "9007199254740993");
  assert.deepEqual(seen, ["page", "page", "other"]);
  await first.close();
  const restarted: string[] = [];
  const second = createLiveInvalidationConsumer({
    reader,
    autoStart: false,
    changed: (page) => {
      restarted.push(page);
    },
  });
  await second.poll();
  assert.deepEqual(restarted, seen);
  await second.close();
});
test("consumer coalesces concurrent polls and close drains work and cancels scheduling", async () => {
  let finish!: (events: []) => void,
    calls = 0;
  const scheduled = new Set<() => void>();
  const clock = {
    after(_ms: number, fn: () => void) {
      scheduled.add(fn);
      return () => {
        scheduled.delete(fn);
      };
    },
  };
  const consumer = createLiveInvalidationConsumer({
    reader: {
      after() {
        calls++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
    changed() {},
    clock,
  });
  assert.equal(scheduled.size, 1);
  const a = consumer.poll(),
    b = consumer.poll();
  assert.equal(calls, 1);
  let closed = false;
  const closing = consumer.close().then(() => (closed = true));
  await Promise.resolve();
  assert.equal(closed, false);
  finish([]);
  await Promise.all([a, b, closing]);
  assert.equal(scheduled.size, 0);
  await consumer.poll();
  assert.equal(calls, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createCompiledMembers } from "../src/migration/conversion/compiled/members-runtime.ts";
const first = {
  generation: "a".repeat(64),
  rows: [{ user_id: "person-a", joined_at: "2026-01-01T00:00:00.000Z" }],
};
const empty = { generation: "b".repeat(64), rows: [] };
test("members snapshots are transient, empty is valid, and watch revocation clears current rows", async () => {
  let notify: (v: unknown) => void = () => {};
  const seen: any[] = [];
  let reads = 0,
    stopped = false;
  const adapter = createCompiledMembers({
    read: async () => {
      reads++;
      return first;
    },
    watch: (fn) => {
      notify = fn;
      return () => {
        stopped = true;
      };
    },
    changed: (s) => seen.push(s),
  });
  assert.deepEqual(await adapter.read(), first);
  assert.equal(reads, 1);
  notify(empty);
  assert.deepEqual(await adapter.read(), empty);
  assert.equal(reads, 1);
  notify(null);
  assert.equal(seen.at(-1), null);
  adapter.dispose();
  assert.equal(stopped, true);
  await assert.rejects(adapter.read());
});
test("refresh invalidates before network completes and stale responses cannot restore revoked members", async () => {
  let notify: (v: unknown) => void = () => {};
  let resolve: (v: unknown) => void = () => {};
  const seen: any[] = [];
  const adapter = createCompiledMembers({
    read: () =>
      new Promise((r) => {
        resolve = r;
      }),
    watch: (fn) => {
      notify = fn;
      return () => {};
    },
    changed: (s) => seen.push(s),
  });
  notify(first);
  const pending = adapter.refresh();
  assert.equal(seen.at(-1), null);
  notify(null);
  await Promise.resolve();
  resolve(first);
  await assert.rejects(pending);
  assert.equal(seen.at(-1), null);
  adapter.dispose();
});
test("invalid or excessive member responses are refused and never exposed as current", async () => {
  for (const response of [
    { ...first, generation: "bad" },
    { ...first, rows: [{ user_id: "person-a", joined_at: "bad" }] },
    { ...first, rows: [{ ...first.rows[0], email: "private" }] },
    { ...first, rows: [first.rows[0], first.rows[0]] },
    {
      ...first,
      rows: Array.from({ length: 10001 }, (_, i) => ({
        ...first.rows[0],
        user_id: String(i),
      })),
    },
  ]) {
    const seen: any[] = [];
    const adapter = createCompiledMembers({
      read: async () => response,
      watch: () => () => {},
      changed: (s) => seen.push(s),
    });
    await assert.rejects(adapter.read());
    assert.ok(seen.every((v) => v === null));
    adapter.dispose();
  }
});

test("malformed successful responses release inflight state so the next read can recover", async () => {
  let calls = 0;
  const seen: unknown[] = [];
  const adapter = createCompiledMembers({
    read: async () =>
      ++calls === 1 ? { ...first, generation: "invalid" } : empty,
    watch: () => () => {},
    changed: (s) => seen.push(s),
  });
  await assert.rejects(adapter.read(), /Page members unavailable/);
  assert.deepEqual(await adapter.read(), empty);
  assert.equal(calls, 2);
  assert.deepEqual(seen, [null, null, empty]);
  adapter.dispose();
});
test("obsolete validation failures do not clear a newer inflight read or restore disposed members", async () => {
  const pending: ((value: unknown) => void)[] = [];
  const seen: unknown[] = [];
  const adapter = createCompiledMembers({
    read: () => new Promise((resolve) => pending.push(resolve)),
    watch: () => () => {},
    changed: (s) => seen.push(s),
  });
  const old = adapter.read();
  await Promise.resolve();
  const next = adapter.refresh();
  await Promise.resolve();
  pending[0]!({ ...first, generation: "invalid" });
  await assert.rejects(old);
  const joined = adapter.read();
  assert.equal(pending.length, 2);
  pending[1]!(empty);
  assert.deepEqual(await next, empty);
  assert.deepEqual(await joined, empty);
  const retired = adapter.refresh();
  await Promise.resolve();
  adapter.dispose();
  pending[2]!(first);
  await assert.rejects(retired);
  await assert.rejects(adapter.read());
  assert.notDeepEqual(seen.at(-1), first);
});

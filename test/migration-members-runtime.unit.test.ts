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

import test from "node:test";
import assert from "node:assert/strict";
import { createPresenceScheduler } from "../src/browser/presence-scheduler.ts";
test("presence coalesces updates, throttles cursor, reads latest and cancels suspended work", () => {
  const jobs = new Map<number, () => void>();
  let id = 0,
    count = 0,
    active = true,
    authenticated = true;
  const values: unknown[] = [];
  const p = createPresenceScheduler({
    clock: {
      setTimeout(fn) {
        jobs.set(++id, fn);
        return id;
      },
      clearTimeout(h) {
        jobs.delete(h as number);
      },
    },
    read: () => ({
      active,
      authenticated,
      presence: {
        sessionId: "s",
        sourceRevision: String(count),
        shareCursor: true,
        visible: true,
        cursor: null,
      },
    }),
    publish: (v) => values.push(v.sourceRevision),
    publishCursor: (v) => values.push(v),
  });
  p.schedule();
  p.schedule();
  assert.equal(jobs.size, 1);
  count = 2;
  [...jobs.values()][0]!();
  assert.deepEqual(values, ["2"]);
  jobs.clear();
  p.cursor();
  p.cursor();
  assert.equal(jobs.size, 1);
  active = false;
  [...jobs.values()][0]!();
  assert.deepEqual(values, ["2"]);
  jobs.clear();
  p.schedule();
  p.cancel();
  assert.equal(jobs.size, 0);
  active = true;
  authenticated = false;
  p.send();
  assert.deepEqual(values, ["2"]);
});
test("presence privacy flags gate only cursors; immediate sends cancel debounced duplicates", () => {
  const jobs = new Map<number, () => void>();
  let id = 0;
  const sent: unknown[] = [];
  const state = {
    authenticated: true,
    active: true,
    presence: {
      sessionId: "s",
      visible: false,
      shareCursor: true,
      cursor: null,
    },
  };
  const p = createPresenceScheduler({
    read: () => state,
    publish: (v) => sent.push(v),
    publishCursor: (v) => sent.push(v),
    clock: {
      setTimeout(fn) {
        jobs.set(++id, fn);
        return id;
      },
      clearTimeout(h) {
        jobs.delete(h as number);
      },
    },
  });
  const fire = () => {
    const [id, fn] = [...jobs][0]!;
    jobs.delete(id);
    fn();
  };
  p.cursor();
  fire();
  assert.equal(sent.length, 0);
  state.presence.visible = true;
  state.presence.shareCursor = false;
  p.cursor();
  fire();
  assert.equal(sent.length, 0);
  state.presence.shareCursor = true;
  p.cursor();
  fire();
  assert.deepEqual(sent, [null]);
  p.schedule();
  p.send();
  assert.equal(jobs.size, 0);
  assert.equal(sent.length, 2);
  p.schedule();
  p.cursor();
  p.cancel();
  p.cancel();
  assert.equal(jobs.size, 0);
});
test("selection events coalesce without postponing continuous native drags and cancel on disposal", () => {
  const jobs = new Map<number, () => void>();
  let id = 0;
  let latest = 1;
  const sent: number[] = [];
  const p = createPresenceScheduler({
    clock: {
      setTimeout(fn) {
        jobs.set(++id, fn);
        return id;
      },
      clearTimeout(h) {
        jobs.delete(h as number);
      },
    },
    read: () => ({
      active: true,
      authenticated: true,
      presence: { sessionId: String(latest) },
    }),
    publish: (v) => sent.push(Number(v.sessionId)),
    publishCursor() {},
  });
  p.selection();
  const first = [...jobs.keys()][0];
  latest = 2;
  p.selection();
  assert.deepEqual([...jobs.keys()], [first]);
  [...jobs.values()][0]!();
  jobs.clear();
  assert.deepEqual(sent, [2]);
  p.selection();
  p.cancel();
  assert.equal(jobs.size, 0);
});

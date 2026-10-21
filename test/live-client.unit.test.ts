import test from "node:test";
import assert from "node:assert/strict";
import { connectLive } from "../src/live-client.ts";
import type { LiveSocket } from "../src/live-client-contracts.ts";
function setup() {
  const jobs = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const sockets: (LiveSocket & { sent: string[]; closed: number })[] = [];
  const events: string[] = [];
  const client = connectLive({
    url: "ws://test",
    auth: () => ({ token: "token", sessionId: "s", sourceRevision: "r" }),
    onReady: () => events.push("ready"),
    onViewers: () => events.push("viewers"),
    onChanged: () => events.push("changed"),
    onStatus: (s) => events.push(s),
    random: () => 0,
    clock: {
      setTimeout(fn, ms) {
        jobs.set(++id, { fn, ms });
        return id;
      },
      clearTimeout(h) {
        jobs.delete(h as number);
      },
    },
    socket() {
      const s = {
        readyState: 1,
        bufferedAmount: 0,
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        sent: [] as string[],
        closed: 0,
        send(v: string) {
          this.sent.push(v);
        },
        close() {
          this.closed++;
        },
      };
      sockets.push(s);
      return s;
    },
  });
  return {
    client,
    sockets,
    events,
    jobs,
    fire(ms: number) {
      const found = [...jobs].find(([, j]) => j.ms === ms);
      assert.ok(found);
      jobs.delete(found[0]);
      found[1].fn();
    },
  };
}
test("live authenticates, gates writes until ready, bounds buffered writes and ignores malformed frames", () => {
  const t = setup(),
    s = t.sockets[0]!;
  s.onopen!();
  assert.equal(JSON.parse(s.sent[0]!).token, "token");
  assert.equal(t.client.send({ type: "cursor", cursor: null }), false);
  s.onmessage!({ data: "broken" });
  s.onmessage!({ data: '{"type":"viewers","viewers":false}' });
  s.onmessage!({
    data: JSON.stringify({ type: "viewers", viewers: [null, {}] }),
  });
  assert.equal(t.events.includes("viewers"), false);
  s.onmessage!({ data: '{"type":"ready"}' });
  s.onmessage!({ data: '{"type":"ready"}' });
  assert.equal(t.events.filter((x) => x === "ready").length, 1);
  assert.equal(t.client.send({ type: "cursor", cursor: null }), true);
  s.bufferedAmount = 2 * 1024 * 1024;
  assert.equal(t.client.send({ type: "cursor", cursor: null }), false);
  t.client.close();
  s.onmessage!({ data: '{"type":"changed"}' });
  assert.equal(t.events.includes("changed"), false);
  assert.equal(t.jobs.size, 0);
});
test("live watchdog reconnects and stale events cannot affect replacement socket", () => {
  const t = setup(),
    old = t.sockets[0]!;
  t.fire(10000);
  assert.equal(old.closed, 1);
  old.onclose!({ code: 1006 });
  t.fire(500);
  const fresh = t.sockets[1]!;
  old.onopen!();
  old.onmessage!({ data: '{"type":"ready"}' });
  old.onclose!({ code: 4403 });
  assert.equal(old.sent.length, 0);
  fresh.onopen!();
  fresh.onmessage!({ data: '{"type":"ready"}' });
  t.fire(35000);
  assert.equal(fresh.closed, 1);
  fresh.onclose!({ code: 4403 });
  assert.equal(t.jobs.size, 0);
  assert.equal(t.events.at(-1), "error");
  t.client.close();
});

test("reconnect backoff caps, ready resets it, and shutdown cancels retry", () => {
  const t = setup();
  for (const delay of [500, 1000, 2000, 4000, 8000, 15000, 15000]) {
    t.sockets.at(-1)!.onclose!({ code: 1006 });
    t.fire(delay);
  }
  t.sockets.at(-1)!.onmessage!({ data: '{"type":"ready"}' });
  t.sockets.at(-1)!.onclose!({ code: 1006 });
  assert.ok([...t.jobs.values()].some((j) => j.ms === 500));
  t.client.close();
  assert.equal(t.jobs.size, 0);
});
test("all permanent rejection codes stop reconnects; error and valid data events dispatch", () => {
  for (const code of [4400, 4401, 4403]) {
    const t = setup();
    const s = t.sockets[0]!;
    s.onmessage!({ data: '{"type":"viewers","viewers":[]}' });
    s.onmessage!({ data: '{"type":"changed"}' });
    s.onmessage!({ data: '{"type":"error","message":"denied"}' });
    assert.ok(t.events.includes("viewers"));
    assert.ok(t.events.includes("changed"));
    s.onclose!({ code });
    assert.equal(t.jobs.size, 0);
    assert.equal(t.client.send({ type: "cursor", cursor: null }), false);
  }
});
test("socket creation failures retry; send/auth exceptions do not escape", () => {
  const jobs: (() => void)[] = [];
  let attempts = 0;
  const s: LiveSocket = {
    readyState: 1,
    bufferedAmount: 0,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send() {
      throw Error("closed");
    },
    close() {},
  };
  const client = connectLive({
    url: "ws://test",
    auth: () => ({ token: "t", sessionId: "s", sourceRevision: "r" }),
    onReady() {},
    onChanged() {},
    onViewers() {},
    onStatus() {},
    clock: {
      setTimeout(fn) {
        jobs.push(fn);
        return fn;
      },
      clearTimeout() {},
    },
    socket() {
      if (attempts++ === 0) throw Error("create");
      return s;
    },
  });
  jobs.shift()!();
  s.onopen!();
  s.onmessage!({ data: '{"type":"ready"}' });
  assert.equal(client.send({ type: "cursor", cursor: null }), false);
  client.close();
});

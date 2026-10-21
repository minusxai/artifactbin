import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket from "ws";
import { liveHub } from "../src/live.js";

// No app, Postgres or browser: inject authorization and clock into the transport boundary.
async function fixture(t) {
  let time = 1000,
    reads = 0;
  const server = createServer(),
    presence = new Map();
  const hub = liveHub({
    server,
    presence,
    now: () => time,
    heartbeatMs: 20,
    authorize: async (id, token, sourceRevision) => {
      reads++;
      if (token === "bad")
        throw Object.assign(Error("Denied"), { status: 403 });
      return {
        actor: token === "share" ? null : token,
        file: { generation: 0 },
        sourceRevision,
        sourceAvailable: sourceRevision === "rev",
        expires: 50000,
      };
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const sockets = [];
  t.after(async () => {
    hub.close();
    for (const s of sockets) s.terminate();
    await new Promise((r) => server.close(r));
  });
  async function connect(token = "alice", sid = "session") {
    const ws = new WebSocket(
        `ws://127.0.0.1:${server.address().port}/api/files/file/live`,
      ),
      messages = [];
    sockets.push(ws);
    ws.on("error", () => {});
    ws.on("message", (d) => messages.push(JSON.parse(d)));
    await once(ws, "open");
    const ready = once(ws, "message");
    ws.send(
      JSON.stringify({
        type: "auth",
        token,
        sessionId: sid,
        sourceRevision: "rev",
      }),
    );
    await ready;
    return { ws, messages, send: (m) => ws.send(JSON.stringify(m)) };
  }
  return {
    connect,
    presence,
    hub,
    reads: () => reads,
    advance: () => {
      time = 60000;
    },
  };
}
const wait = () => new Promise((r) => setTimeout(r, 30));
test("cursor traffic retains snapshot without authorization queries; expiry removes presence", async (t) => {
  const f = await fixture(t),
    a = await f.connect();
  a.send({
    type: "presence",
    presence: {
      sessionId: "session",
      sourceRevision: "rev",
      snapshot: {
        schema: 1,
        sourceRevision: "rev",
        state: { count: 4 },
        view: { x: 0, y: 0 },
      },
    },
  });
  await wait();
  const snapshot = f.presence.get("file").session.snapshot;
  for (let i = 0; i < 20; i++)
    a.send({ type: "cursor", cursor: { nodeId: "node", x: i / 20, y: 0.5 } });
  await wait();
  assert.equal(f.reads(), 1);
  assert.equal(f.presence.get("file").session.snapshot, snapshot);
  assert.equal(f.presence.get("file").session.cursor.x, 0.95);
  const closed = once(a.ws, "close");
  f.advance();
  await closed;
  await wait();
  assert.ok(!f.presence.get("file")?.session);
});
test("read capabilities cannot broadcast, malformed frames and session impersonation close safely", async (t) => {
  const f = await fixture(t);
  for (const [token, message] of [
    [
      "share",
      {
        type: "presence",
        presence: { sessionId: "session", sourceRevision: "rev" },
      },
    ],
    [
      "alice",
      {
        type: "presence",
        presence: { sessionId: "someone-else", sourceRevision: "rev" },
      },
    ],
    ["alice", { type: "unknown" }],
  ]) {
    const a = await f.connect(token),
      closed = once(a.ws, "close");
    a.send(message);
    await closed;
    assert.ok(a.messages.some((m) => m.type === "error"));
    assert.ok(!f.presence.get("file")?.session);
  }
  const a = await f.connect(),
    closed = once(a.ws, "close");
  a.ws.send("{broken");
  await closed;
});
test("reconnect replaces only the same identity and disconnect removes its cursor", async (t) => {
  const f = await fixture(t),
    a = await f.connect();
  a.send({
    type: "presence",
    presence: { sessionId: "session", sourceRevision: "rev" },
  });
  await wait();
  const closed = once(a.ws, "close"),
    replacement = await f.connect();
  await closed;
  replacement.send({
    type: "presence",
    presence: { sessionId: "session", sourceRevision: "rev" },
  });
  await wait();
  assert.equal(f.presence.get("file").session.actor, "alice");
  const impostor = await f.connect("bob");
  await once(impostor.ws, "close");
  assert.equal(f.presence.get("file").session.actor, "alice");
  const gone = once(replacement.ws, "close");
  replacement.ws.close();
  await gone;
  await wait();
  assert.ok(!f.presence.get("file")?.session);
});

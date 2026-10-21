import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { createService, addAccount } from "../src/server.js";
import { testDatabase } from "./postgres.js";

test(
  "live rooms authenticate, isolate files, push cursors/comments, remove departures and revoke sockets",
  { timeout: 20000 },
  async () => {
    const db = await testDatabase();
    await addAccount(db, "alice", "correct horse battery");
    await addAccount(db, "bob", "second correct battery");
    await addAccount(db, "carol", "third correct battery");
    const service = createService(db),
      sockets = [];
    await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${service.server.address().port}`;
    async function req(path, token, body, method = body ? "POST" : "GET") {
      const r = await fetch(origin + path, {
        method,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.ok(r.ok, `HTTP ${r.status}`);
      return r.json();
    }
    async function connect(pub, token, id) {
      const ws = new WebSocket(
        origin.replace("http", "ws") + `/api/files/${pub.id}/live`,
      );
      sockets.push(ws);
      const messages = [];
      ws.on("message", (d) => messages.push(JSON.parse(d)));
      ws.on("error", () => {});
      await once(ws, "open");
      ws.send(
        JSON.stringify({
          type: "auth",
          token,
          sessionId: id,
          sourceRevision: "1",
        }),
      );
      return {
        ws,
        messages,
        send: (m) => ws.send(JSON.stringify(m)),
        wait: async (predicate) => {
          const until = Date.now() + 3000;
          while (Date.now() < until) {
            const i = messages.findIndex(predicate);
            if (i >= 0) return messages.splice(i, 1)[0];
            await new Promise((r) => setTimeout(r, 10));
          }
          assert.fail("Expected live message did not arrive");
        },
      };
    }
    try {
      const alice = (
        await req("/api/login", "", {
          username: "alice",
          password: "correct horse battery",
        })
      ).token;
      const bob = (
        await req("/api/login", "", {
          username: "bob",
          password: "second correct battery",
        })
      ).token;
      const pub = await req("/api/publish", alice, {
        source: "<h1>hello</h1>",
        requestId: "live",
        visibility: "unlisted",
        linkRole: "commenter",
      });
      const other = await req("/api/publish", alice, {
        source: "<h1>other</h1>",
        requestId: "other",
        visibility: "unlisted",
        linkRole: "viewer",
      });
      const carol = (
        await req("/api/login", "", {
          username: "carol",
          password: "third correct battery",
        })
      ).token;
      // Hosted views hand signed-in viewers a document grant bound to one page.
      const grant = async (account) =>
        (await req(`/api/library/${pub.id}/host`, account)).boot.token;
      const scoped = await grant(bob);
      const a = await connect(pub, alice, "a"),
        b = await connect(pub, scoped, "b"),
        guest = await connect(pub, await grant(carol), "guest"),
        isolated = await connect(other, alice, "other");
      for (const c of [a, b, guest, isolated])
        await c.wait((m) => m.type === "ready");
      const snap = {
        schema: 1,
        sourceRevision: "1",
        state: { count: 7 },
        view: { x: 0, y: 0 },
      };
      b.send({
        type: "presence",
        presence: {
          sessionId: "b",
          sourceRevision: "1",
          snapshot: snap,
        },
      });
      await a.wait(
        (m) => m.type === "viewers" && m.viewers.some((v) => v.actor === "bob"),
      );
      b.send({ type: "cursor", cursor: { nodeId: "h", x: 0.2, y: 0.4 } });
      const seen = await guest.wait(
        (m) =>
          m.type === "viewers" && m.viewers.some((v) => v.cursor?.x === 0.2),
      );
      assert.equal(seen.viewers[0].snapshot, undefined);
      assert.ok(
        !isolated.messages.some(
          (m) => m.type === "viewers" && m.viewers.length,
        ),
      );
      b.send({
        type: "presence",
        presence: {
          sessionId: "b",
          sourceRevision: "1",
          shareCursor: false,
          shareView: false,
        },
      });
      await a.wait(
        (m) =>
          m.type === "viewers" &&
          m.viewers.some((v) => !v.shareView && !v.cursor),
      );
      b.send({ type: "cursor", cursor: { nodeId: "h", x: 0.9, y: 0.4 } });
      await new Promise((r) => setTimeout(r, 80));
      assert.ok(
        !a.messages.some(
          (m) =>
            m.type === "viewers" && m.viewers.some((v) => v.cursor?.x === 0.9),
        ),
      );
      await req(`/api/files/${pub.id}/comments`, scoped, {
        comment: { nodeId: null, quote: "", body: "pushed", state: snap.state },
      });
      await a.wait((m) => m.type === "changed");
      await guest.wait((m) => m.type === "changed");
      b.ws.close();
      await once(b.ws, "close");
      await a.wait(
        (m) =>
          m.type === "viewers" && !m.viewers.some((v) => v.actor === "bob"),
      );
      const invalid = await connect(other, scoped, "wrong");
      await once(invalid.ws, "close");
      assert.ok(!invalid.messages.some((m) => m.type === "ready"));
      const guestClosed = once(guest.ws, "close");
      await req(`/api/files/${pub.id}/revoke`, alice, {});
      await guestClosed;
    } finally {
      for (const ws of sockets) ws.terminate();
      await service.close();
      await new Promise((r) => service.server.close(r));
      await db.cleanup();
    }
  },
);

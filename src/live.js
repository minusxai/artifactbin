import { WebSocketServer, WebSocket } from "ws";
import { validateLoadedSnapshot } from "./comment-model.ts";
import { presenceUpdate, visiblePresence, text, fail } from "./model.ts";

/** Single-process ephemeral rooms. Durable state remains behind the HTTP repository. */
export function liveHub({
  server,
  presence,
  authorize,
  now = Date.now,
  heartbeatMs = 10000,
  acceptUpgrade = /** @param {import("node:http").IncomingMessage} request */ (
    request,
  ) => true,
}) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * 1024 * 1024,
    perMessageDeflate: false,
  });
  const clients = new Map(),
    epochs = new Map();
  const clock = (generation) => ({ now: now(), generation });
  function send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) {
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify(message));
  }
  function broadcast(id, generation) {
    const message = {
      type: "viewers",
      viewers: visiblePresence(presence.get(id) || {}, clock(generation)),
    };
    for (const [ws, c] of clients)
      if (c.id === id && c.auth) {
        if (c.auth.expires <= now()) {
          ws.close(4403, "Access expired");
          continue;
        }
        send(ws, message);
      }
  }
  const upgrade = (req, socket, head) => {
    const match = /^\/api\/files\/([^/?]+)\/live$/.exec(req.url);
    if (!acceptUpgrade(req) || !match || wss.clients.size >= 1000) {
      socket.destroy();
      return;
    }
    // file:// uses Origin:null. No cookies or ambient credentials are accepted.
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, match[1]),
    );
  };
  server.on("upgrade", upgrade);
  wss.on("connection", (ws, id) => {
    const c = {
      id,
      auth: null,
      sessionId: null,
      alive: true,
      busy: false,
      shareCursor: true,
      window: now(),
      count: 0,
    };
    clients.set(ws, c);
    const timeout = setTimeout(
      () => ws.close(4401, "Authentication required"),
      5000,
    );
    timeout.unref();
    ws.on("error", () => {});
    ws.on("pong", () => {
      c.alive = true;
      const entry = presence.get(id)?.[c.sessionId];
      if (entry && c.auth && entry.actor === c.auth.actor)
        entry.lastSeen = now();
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      clients.delete(ws);
      if (c.auth && c.sessionId) {
        const entries = presence.get(id);
        if (entries?.[c.sessionId]?.actor === c.auth.actor)
          delete entries[c.sessionId];
        broadcast(id, c.auth.file.generation);
      }
    });
    ws.on("message", async (raw, binary) => {
      try {
        if (binary) fail(422, "Text messages required");
        if (now() - c.window >= 1000) {
          c.window = now();
          c.count = 0;
        }
        if (++c.count > 60) fail(429, "Too many updates");
        const m = JSON.parse(raw.toString());
        if (c.busy && c.auth && m.type === "cursor") return;
        if (c.busy) fail(429, "Wait for authentication");
        if (!c.auth) {
          if (m.type !== "auth") fail(401, "Authentication required");
          text(m.token, 200);
          text(m.sessionId, 100);
          if (Object.hasOwn(Object.prototype, m.sessionId))
            fail(422, "Invalid session ID");
          text(m.sourceRevision, 100);
          c.busy = true;
          const epoch = epochs.get(id) || 0;
          const auth = await authorize(id, m.token, m.sourceRevision);
          if (ws.readyState !== WebSocket.OPEN) return;
          if (epoch !== (epochs.get(id) || 0)) fail(403, "Access revoked");
          for (const [oldSocket, other] of clients)
            if (
              other !== c &&
              other.id === id &&
              other.sessionId === m.sessionId
            ) {
              if (other.auth?.actor && other.auth.actor !== auth.actor)
                fail(403, "Session belongs to another viewer");
              other.sessionId = null;
              oldSocket.terminate();
            }
          c.auth = auth;
          c.token = m.token;
          c.sessionId = m.sessionId;
          c.busy = false;
          clearTimeout(timeout);
          send(ws, { type: "ready" });
          broadcast(id, auth.file.generation);
          return;
        }
        if (c.auth.expires <= now()) fail(403, "Access expired");
        if (!c.auth.actor) fail(401, "Sign in to share presence");
        if (m.type === "presence") {
          const input = m.presence;
          if (input.sessionId !== c.sessionId) fail(403, "Session mismatch");
          if (input.snapshot && input.shareView !== false) {
            if (c.auth.sourceRevision !== input.sourceRevision) {
              c.busy = true;
              const epoch = epochs.get(id) || 0;
              const auth = await authorize(id, c.token, input.sourceRevision);
              if (ws.readyState !== WebSocket.OPEN) return;
              if (epoch !== (epochs.get(id) || 0)) fail(403, "Access revoked");
              c.auth = auth;
              c.busy = false;
            }
            validateLoadedSnapshot(
              c.auth.sourceAvailable,
              input.snapshot,
              input.sourceRevision,
            );
          }
          c.shareCursor = input.shareCursor !== false;
          presence.set(
            id,
            presenceUpdate(
              presence.get(id) || {},
              c.auth.actor,
              input,
              clock(c.auth.file.generation),
            ),
          );
        } else if (m.type === "cursor") {
          const entries = presence.get(id) || {},
            old = entries[c.sessionId];
          if (!old || !c.shareCursor) return;
          // Validate only the cursor; never clone the app snapshot for mouse movement.
          const next = presenceUpdate(
            entries,
            c.auth.actor,
            {
              sessionId: c.sessionId,
              sourceRevision: old.sourceRevision,
              cursor: m.cursor,
            },
            clock(c.auth.file.generation),
          );
          next[c.sessionId].snapshot = old.snapshot;
          next[c.sessionId].selection = old.selection;
          presence.set(id, next);
        } else fail(422, "Unknown live message");
        broadcast(id, c.auth.file.generation);
      } catch (e) {
        send(ws, {
          type: "error",
          message: e.status ? e.message : "Live connection failed",
        });
        ws.close(
          e.status === 403
            ? 4403
            : e.status || e instanceof SyntaxError
              ? 4400
              : 1011,
          "Live request rejected",
        );
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive || c.auth?.expires <= now()) {
        ws.terminate();
        continue;
      }
      c.alive = false;
      ws.ping();
      if (c.auth) send(ws, { type: "heartbeat" });
    }
    for (const [id, entries] of presence) {
      let changed = false,
        generation = 0;
      for (const [sid, e] of Object.entries(entries)) {
        generation = e.generation;
        if (now() - e.lastSeen >= 30000) {
          delete entries[sid];
          changed = true;
        }
      }
      if (changed) broadcast(id, generation);
      if (!Object.keys(entries).length) presence.delete(id);
    }
  }, heartbeatMs);
  heartbeat.unref();
  return {
    presenceChanged: broadcast,
    /** @param {string} id @param {boolean | "policy"} revoke */
    changed(id, revoke = false) {
      if (revoke) {
        epochs.set(id, (epochs.get(id) || 0) + 1);
        presence.delete(id);
      }
      for (const [ws, c] of clients)
        if (c.id === id && c.auth) {
          if (revoke || c.auth.expires <= now())
            ws.close(revoke === "policy" ? 1012 : 4403, "Access changed");
          else send(ws, { type: "changed" });
        }
    },
    close() {
      clearInterval(heartbeat);
      server.off("upgrade", upgrade);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
    },
  };
}

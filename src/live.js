import { LIVE_QUEUE_LIMITS } from "./live-contracts.ts";
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
  function closeRevoked(ws, c) {
    const entries = presence.get(c.id);
    if (entries?.[c.sessionId] && c.auth && entries[c.sessionId].actor === c.auth.actor) delete entries[c.sessionId];
    ws.close(4403, "Access changed");
  }
  // A live authorization is a single-operation fact, never a durable socket grant.
  // Rechecking the repository also observes revocation by another server process.
  async function refresh(ws, c, revision = c.auth.sourceRevision) {
    if (stopped || ws.readyState !== WebSocket.OPEN) return false;
    const epoch = epochs.get(c.id) || 0;
    const auth = await authorize(c.id, c.token, revision);
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (epoch !== (epochs.get(c.id) || 0) || auth.expires <= now() || auth.actor !== c.auth.actor)
      fail(403, "Access revoked");
    return auth;
  }
  const broadcasts = new Map();
  let stopped = false;
  function scheduleBroadcast(id, viewers, changed) {
    if (stopped) return;
    let job = broadcasts.get(id);
    if (job) {
      job.viewers ||= viewers;
      job.changed ||= changed;
      return;
    }
    job = { viewers, changed };
    broadcasts.set(id, job);
    void (async () => {
      try {
        while (!stopped && (job.viewers || job.changed)) {
          const sendViewers = job.viewers, sendChanged = job.changed;
          job.viewers = job.changed = false;
          await Promise.all([...clients].map(async ([ws, c]) => {
            if (c.id !== id || !c.auth || ws.readyState !== WebSocket.OPEN) return;
            try {
              const auth = await refresh(ws, c);
              if (!auth || stopped) return;
              if (sendViewers) send(ws, {
                type: "viewers",
                viewers: visiblePresence(presence.get(id) || {}, clock(auth.file.generation)),
              });
              if (sendChanged) send(ws, { type: "changed" });
            } catch { closeRevoked(ws, c); }
          }));
        }
      } finally { broadcasts.delete(id); }
    })();
  }
  const broadcast = (id, generation) => scheduleBroadcast(id, true, false);
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
      // Pong proves transport liveness only. Authorization is refreshed on the
      // heartbeat before extending a viewer's presence lifetime.
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      clients.delete(ws);
      queue.length = 0;
      if (c.auth && c.sessionId) {
        const entries = presence.get(id);
        if (entries?.[c.sessionId] && entries[c.sessionId].actor === c.auth.actor)
          delete entries[c.sessionId];
        broadcast(id, c.auth.file.generation);
      }
    });
    const queue = [];
    let pendingBytes = 0, processing = false;
    const handleMessage = async (raw, binary) => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      try {
        if (binary) fail(422, "Text messages required");
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
        const revision = m.type === "presence" && m.presence?.snapshot && m.presence?.shareView !== false
          ? m.presence.sourceRevision : c.auth.sourceRevision;
        const refreshed = await refresh(ws, c, revision);
        if (!refreshed) return;
        c.auth = refreshed;
        if (!c.auth.actor) fail(401, "Sign in to share presence");
        if (m.type === "presence") {
          const input = m.presence;
          if (input.sessionId !== c.sessionId) fail(403, "Session mismatch");
          if (input.snapshot && input.shareView !== false) {
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
        const entries = presence.get(id);
        if (entries?.[c.sessionId] && c.auth && entries[c.sessionId].actor === c.auth.actor) delete entries[c.sessionId];
        ws.close(
          e.status === 403
            ? 4403
            : e.status || e instanceof SyntaxError
              ? 4400
              : 1011,
          "Live request rejected",
        );
      }
    };
    // Bound admission synchronously, including the executing frame, while
    // serializing async authorization. Closed sockets discard queued work.
    ws.on("message", (raw, binary) => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (now() - c.window >= 1000) { c.window = now(); c.count = 0; }
      const bytes = raw.length;
      if (++c.count > LIVE_QUEUE_LIMITS.framesPerSecond ||
          queue.length + (processing ? 1 : 0) >= LIVE_QUEUE_LIMITS.pendingFrames ||
          pendingBytes + bytes > LIVE_QUEUE_LIMITS.pendingBytes) {
        queue.length = 0;
        ws.close(4400, "Too many pending updates");
        return;
      }
      pendingBytes += bytes;
      queue.push({ raw, binary, bytes });
      if (processing) return;
      processing = true;
      void (async () => {
        try {
          while (queue.length && !stopped && ws.readyState === WebSocket.OPEN) {
            const frame = queue.shift();
            await handleMessage(frame.raw, frame.binary);
            pendingBytes -= frame.bytes;
          }
        } finally {
          queue.length = 0;
          pendingBytes = 0;
          processing = false;
        }
      })();
    });
  });
  let heartbeatBusy = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
    for (const [ws, c] of clients) {
      if (!c.alive || c.auth?.expires <= now()) {
        ws.terminate();
        continue;
      }
      c.alive = false;
      ws.ping();
      if (c.auth) {
        try {
          if (!await refresh(ws, c) || stopped) continue;
          const entry = presence.get(c.id)?.[c.sessionId];
          if (entry && entry.actor === c.auth.actor) entry.lastSeen = now();
          send(ws, { type: "heartbeat" });
        } catch { closeRevoked(ws, c); }
      }
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
    } finally { heartbeatBusy = false; }
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
          else scheduleBroadcast(id, false, true);
        }
    },
    /** Awaitable durable invalidation dispatch; legacy changed callers stay fire-and-forget.
     * @param {string} id */
    async changedAndWait(id) {
      const results = await Promise.allSettled([...clients].map(async ([ws, c]) => {
        if (c.id !== id || !c.auth || ws.readyState !== WebSocket.OPEN) return;
        try {
          const auth = await refresh(ws, c);
          if (auth && !stopped) send(ws, { type: "changed" });
        } catch (error) {
          if (error && typeof error === "object" && "status" in error && [401,403,404,410].includes(Number(error.status))) {
            closeRevoked(ws, c);
            return;
          }
          throw error;
        }
      }));
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    },
    close() {
      stopped = true;
      broadcasts.clear();
      clearInterval(heartbeat);
      server.off("upgrade", upgrade);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
    },
  };
}

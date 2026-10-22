import { isStableNodeId } from "./domain/stable-node-id.ts";
import type {
  LiveClient,
  LiveClientOptions,
  LiveSocket,
} from "./live-client-contracts.ts";
/** Owns one reconnecting subscription. Durable state is re-fetched by onReady. */
export function connectLive(options: LiveClientOptions): LiveClient {
  const clock = options.clock ?? {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: unknown) =>
      clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const create =
    options.socket ??
    ((url: string) => new WebSocket(url) as unknown as LiveSocket);
  let socket: LiveSocket | undefined,
    retry: unknown,
    watchdog: unknown,
    stopped = false,
    attempts = 0,
    ready = false;
  const current = (ws: LiveSocket) => !stopped && ws === socket;
  function arm(ws: LiveSocket, ms: number) {
    clock.clearTimeout(watchdog);
    watchdog = clock.setTimeout(() => {
      if (current(ws)) ws.close();
    }, ms);
  }
  function open() {
    if (stopped) return;
    clock.clearTimeout(retry);
    ready = false;
    options.onStatus("connecting");
    let ws: LiveSocket;
    try {
      ws = create(options.url);
    } catch {
      reconnect();
      return;
    }
    socket = ws;
    arm(ws, 10000);
    ws.onopen = () => {
      if (current(ws)) {
        try {
          ws.send(JSON.stringify({ type: "auth", ...options.auth() }));
        } catch {
          ws.close();
        }
      }
    };
    ws.onmessage = (e) => {
      if (!current(ws) || typeof e.data !== "string") return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!m || typeof m !== "object") return;
      if (
        !["ready", "heartbeat", "viewers", "changed", "error"].includes(m.type)
      )
        return;
      if (
        m.type === "viewers" &&
        (!Array.isArray(m.viewers) ||
          !m.viewers.every((v: unknown) => {
            if (!v || typeof v !== "object") return false;
            const viewer = v as Record<string, unknown>;
            if (
              ![viewer.actor, viewer.sessionId, viewer.sourceRevision].every(
                (value) => typeof value === "string",
              ) ||
              typeof viewer.shareView !== "boolean"
            )
              return false;
            if (viewer.cursor === null) return true;
            if (!viewer.cursor || typeof viewer.cursor !== "object")
              return false;
            const cursor = viewer.cursor as Record<string, unknown>;
            return (
              isStableNodeId(cursor.nodeId) &&
              typeof cursor.x === "number" &&
              Number.isFinite(cursor.x) &&
              typeof cursor.y === "number" &&
              Number.isFinite(cursor.y)
            );
          }))
      )
        return;
      if (m.type === "error" && typeof m.message !== "string") return;
      arm(ws, 35000);
      if (m.type === "ready" && !ready) {
        ready = true;
        attempts = 0;
        options.onStatus("live");
        options.onReady();
      }
      if (m.type === "viewers") options.onViewers(m.viewers);
      if (m.type === "changed") options.onChanged();
      if (m.type === "error") options.onStatus("error", m.message);
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (!current(ws)) return;
      socket = undefined;
      clock.clearTimeout(watchdog);
      ready = false;
      if ([4400, 4401, 4403].includes(e.code)) {
        stopped = true;
        options.onStatus(
          "error",
          "Connection rejected. Connect again to restore access.",
        );
        return;
      }
      reconnect();
    };
  }
  function reconnect() {
    options.onStatus("reconnecting");
    retry = clock.setTimeout(
      open,
      Math.min(15000, 500 * 2 ** Math.min(attempts++, 5)) +
        (options.random ?? Math.random)() * 250,
    );
  }
  open();
  return {
    send(message) {
      if (
        !stopped &&
        ready &&
        socket?.readyState === 1 &&
        socket.bufferedAmount < 2 * 1024 * 1024
      ) {
        try {
          socket.send(JSON.stringify(message));
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
    close() {
      stopped = true;
      ready = false;
      clock.clearTimeout(retry);
      clock.clearTimeout(watchdog);
      socket?.close();
      socket = undefined;
    },
  };
}

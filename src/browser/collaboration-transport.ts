import { connectLive } from "../live-client.ts";
import type { PlatformOperation } from "./platform-contracts.ts";
import { wireRequest, wireResult } from "./comment-wire.ts";
import type {
  LiveCallbacks,
  OperationResults,
  SessionTransport,
} from "./collaboration-session-contracts.ts";
import type {
  CollaborationTransportOptions,
  BrokerCollaborationOptions,
  BrokerCollaborationTransport,
} from "./collaboration-transport-contracts.ts";
export function createCollaborationTransport(
  options: CollaborationTransportOptions,
): SessionTransport {
  return {
    async request<O extends PlatformOperation>(
      op: O,
      signal: AbortSignal,
    ): Promise<OperationResults[O["kind"]]> {
      const connection = options.connection(),
        page = {
          version: connection.version ?? null,
          revision: connection.sourceRevision,
        },
        request = wireRequest(op, page);
      const response = await (options.fetch ?? fetch)(
        connection.origin +
          "/api/files/" +
          encodeURIComponent(connection.fileId) +
          request.path,
        {
          method: request.method ?? "GET",
          signal,
          headers: {
            Authorization: "Bearer " + connection.token,
            ...(request.body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
            ...request.headers,
          },
          body:
            request.body !== undefined
              ? JSON.stringify(request.body)
              : undefined,
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw Object.assign(
          new Error(data.error ?? "Platform request failed"),
          { status: response.status },
        );
      return wireResult(op, data, page) as OperationResults[O["kind"]];
    },
    connect(callbacks) {
      const connection = options.connection(),
        url = new URL(
          "/api/files/" + encodeURIComponent(connection.fileId) + "/live",
          connection.origin,
        );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const live = (options.openLive ?? connectLive)({
        url: url.href,
        auth: () => {
          const c = options.connection();
          return {
            token: c.token,
            sessionId: options.sessionId,
            sourceRevision: c.sourceRevision,
          };
        },
        onReady: callbacks.ready,
        onViewers: callbacks.viewers,
        onChanged: callbacks.changed,
        onStatus: callbacks.status,
      });
      return {
        close: () => live.close(),
        send: (presence) => live.send({ type: "presence", presence }),
        cursor: (cursor) => live.send({ type: "cursor", cursor }),
      };
    },
  };
}
/** Broker credentials never enter the document; retired callbacks cannot receive events. */
export function createBrokerCollaborationTransport(
  options: BrokerCollaborationOptions,
): BrokerCollaborationTransport {
  let handlers: LiveCallbacks | null = null;
  return {
    request: (op) => options.client().request(op),
    event(event) {
      if (!handlers) return;
      if (event.type === "live-ready") handlers.ready();
      if (event.type === "viewers")
        handlers.viewers(
          event.viewers as Parameters<LiveCallbacks["viewers"]>[0],
        );
      if (event.type === "changed") handlers.changed();
      if (event.type === "status") handlers.status(event.status, event.error);
    },
    connect(callbacks) {
      const client = options.client();
      handlers = callbacks;
      client.startLive(options.binding()).catch((error) => {
        if (handlers === callbacks) callbacks.status("error", error.message);
      });
      return {
        close() {
          if (handlers === callbacks) {
            handlers = null;
            client.stopLive().catch(() => {});
          }
        },
        send(presence) {
          if (handlers === callbacks)
            client.sendPresence(presence).catch(() => {});
        },
        cursor(cursor) {
          if (handlers === callbacks)
            client
              .sendPresence({ ...options.presence(), cursor })
              .catch(() => {});
        },
      };
    },
  };
}

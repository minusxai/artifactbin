/** Page side of backend calls: a RemotePort that posts to the platform frame. */
import { RemoteUnreachable } from "../apollo/apollo-contracts.ts";
import type {
  RemoteBridgeResponse,
  RemoteClient,
  RemoteClientOptions,
} from "./remote-bridge-contracts.ts";

type Reply = NonNullable<RemoteBridgeResponse["response"]>;

export function createRemoteClient(options: RemoteClientOptions): RemoteClient {
  let disposed = false;
  const listeners = new Set<() => void>();
  const pending = new Map<
    string,
    { resolve(reply: Reply): void; reject(error: Error): void; cancel(): void }
  >();
  return {
    port: {
      online: () => !disposed && options.online(),
      subscribe(listener) {
        if (disposed) return () => {};
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      execute(request) {
        if (disposed || !options.online())
          return Promise.reject(new RemoteUnreachable());
        if (pending.size >= 16)
          return Promise.reject(
            new RemoteUnreachable("Too many backend calls at once"),
          );
        const id = options.id();
        return new Promise<Reply>((resolve, reject) => {
          const cancel = options.schedule(() => {
            pending.delete(id);
            reject(
              new Error("No reply from the platform; the outcome is unknown"),
            );
          }, options.timeoutMs ?? 30_000);
          pending.set(id, { resolve, reject, cancel });
          try {
            options.send({
              kind: "remote-request",
              id,
              request: {
                query: request.query,
                variables: request.variables,
                operation: request.operation,
              },
            });
          } catch (error) {
            pending.delete(id);
            cancel();
            reject(
              new RemoteUnreachable(
                error instanceof Error ? error.message : String(error),
              ),
            );
          }
        });
      },
    },
    invalidate() {
      if (!disposed) for (const listener of [...listeners]) listener();
    },
    receive(message) {
      const item =
        message && typeof message.id === "string"
          ? pending.get(message.id)
          : undefined;
      if (!item) return;
      pending.delete(message.id);
      item.cancel();
      if (message.error)
        item.reject(
          message.error.sent === false
            ? new RemoteUnreachable(message.error.message)
            : new Error(message.error.message),
        );
      else if (message.response && typeof message.response === "object")
        item.resolve(message.response);
      else
        item.reject(new Error("Invalid backend reply; the outcome is unknown"));
    },
    dispose() {
      disposed = true;
      listeners.clear();
      for (const item of pending.values()) {
        item.cancel();
        item.reject(
          new Error(
            "Page closed before the backend replied; the outcome is unknown",
          ),
        );
      }
      pending.clear();
    },
  };
}

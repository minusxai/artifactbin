import type {
  AttachmentAccess,
  AttachmentAccessPorts,
} from "./dataset-attachment-access-contracts.ts";
import type { AttachmentPort } from "./dataset-attachment-bridge-contracts.ts";
/** A revocable view of the existing bridge; never fetches or grants write authority. */
export function createAttachmentAccess(
  ports: AttachmentAccessPorts,
): AttachmentAccess & { dispose(): void } {
  let disposed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* One adapter cannot prevent revocation of another. */
      }
    }
  };
  const stop = ports.subscribe(notify);
  const authority: AttachmentAccess["authority"] = () => {
    const access = ports.access();
    if (disposed || !access?.context || access.epoch === null) return null;
    return {
      generation: JSON.stringify([access.epoch, access.context]),
      allowed: access.state === "allowed",
    };
  };
  const available = () => {
    const current = authority();
    return current?.allowed && ports.transport() ? current.generation : null;
  };
  const request = <T>(
    write: boolean,
    signal: AbortSignal | undefined,
    run: (port: AttachmentPort, signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const generation = available(),
      port = ports.transport();
    if (!generation || !port || signal?.aborted)
      return Promise.reject(Error("Attachment unavailable"));
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      let settled = false,
        dispatched = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        listeners.delete(changed);
        signal?.removeEventListener("abort", cancelled);
        action();
      };
      const cancelled = () =>
        finish(() => {
          controller.abort();
          reject(
            Error(
              write && dispatched
                ? "Attachment outcome unknown"
                : "Attachment unavailable",
            ),
          );
        });
      const changed = () => {
        if (available() !== generation) cancelled();
      };
      listeners.add(changed);
      signal?.addEventListener("abort", cancelled, { once: true });
      try {
        if (available() !== generation) {
          cancelled();
          return;
        }
        dispatched = true;
        void run(port, controller.signal).then(
          (value) => {
            if (available() !== generation) cancelled();
            else finish(() => resolve(value));
          },
          (error) => finish(() => reject(error)),
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });
  };
  const transport: AttachmentPort = {
    availability: (value, signal) =>
      request(false, signal, (port, abort) => port.availability(value, abort)),
    read: (value, signal) =>
      request(false, signal, (port, abort) => port.read(value, abort)),
    upload: (value, signal) =>
      request(true, signal, (port, abort) => port.upload(value, abort)),
  };
  return {
    authority,
    transport: () => (available() ? transport : null),
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      notify();
      listeners.clear();
    },
  };
}

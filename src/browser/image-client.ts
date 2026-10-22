import type {
  ImageBridgeClient,
  ImageBridgeClientOptions,
} from "./image-bridge-contracts.ts";
import { platformImageBlob } from "./platform-image.ts";
import { parseSupplementalAddress } from "../media/supplemental-address.ts";
export function createImageClient(
  options: ImageBridgeClientOptions,
): ImageBridgeClient {
  let context: string | null = null,
    disposed = false;
  const pending = new Map<
    string,
    {
      context: string;
      resolve: (value: Blob) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();
  function cancelAll() {
    for (const [id, item] of pending) {
      pending.delete(id);
      item.cleanup();
      options.send({ kind: "image-cancel", id });
      item.reject(Error("Image caller changed"));
    }
  }
  return {
    setAuthority(next) {
      if (context !== next) {
        context = next;
        cancelAll();
      }
    },
    load(url, signal) {
      if (
        disposed ||
        !context ||
        signal?.aborted ||
        parseSupplementalAddress(url)?.kind !== "person"
      )
        return Promise.reject(Error("Image unavailable"));
      if (pending.size >= 16)
        return Promise.reject(Error("Too many image reads"));
      const id = options.id(),
        epoch = context;
      return new Promise((resolve, reject) => {
        const abort = () => {
          const item = pending.get(id);
          if (!item) return;
          pending.delete(id);
          item.cleanup();
          options.send({ kind: "image-cancel", id });
          reject(Error("Image read cancelled"));
        };
        const cancel = options.schedule(abort, 15000);
        pending.set(id, {
          context: epoch,
          resolve,
          reject,
          cleanup: () => {
            cancel();
            signal?.removeEventListener("abort", abort);
          },
        });
        signal?.addEventListener("abort", abort, { once: true });
        try {
          options.send({
            kind: "image-request",
            id,
            url,
            authorizationContext: epoch,
          });
        } catch (error) {
          pending.delete(id);
          cancel();
          signal?.removeEventListener("abort", abort);
          reject(error);
        }
      });
    },
    receive(reply) {
      const item = pending.get(reply.id);
      if (!item) return;
      pending.delete(reply.id);
      item.cleanup();
      if (disposed || item.context !== context || reply.error) {
        item.reject(Error(reply.error || "Image caller changed"));
        return;
      }
      try {
        item.resolve(platformImageBlob(reply.image));
      } catch (error) {
        item.reject(error as Error);
      }
    },
    dispose() {
      disposed = true;
      context = null;
      cancelAll();
    },
  };
}

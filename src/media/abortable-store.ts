import type { MediaStore } from "./contracts.ts";
/** Await only until abort, while retaining responsibility for a late-opened descriptor. */
function untilAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      reject(signal.reason ?? Error("Image read cancelled"));
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    work.then(
      (value) => {
        if (settled) {
          late?.(value);
          return;
        }
        settled = true;
        signal.removeEventListener("abort", cancel);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
  });
}
/** Scope one opened object and its reads to the HTTP request; cancellation also closes late handles. */
export function abortableMediaStore(
  store: MediaStore,
  signal?: AbortSignal,
): MediaStore {
  if (!signal) return store;
  return {
    async open(descriptor) {
      signal.throwIfAborted();
      const object = await untilAbort(
        store.open(descriptor),
        signal,
        (late) => {
          void late.close().catch(() => {});
        },
      );
      let closed = false;
      const close = () => {
        if (closed) return Promise.resolve();
        closed = true;
        signal.removeEventListener("abort", cancel);
        return object.close();
      };
      const cancel = () => {
        void close().catch(() => {});
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cancel();
        signal.throwIfAborted();
      }
      return {
        close,
        async *stream(range) {
          const iterator = object.stream(range)[Symbol.asyncIterator]();
          try {
            for (;;) {
              signal.throwIfAborted();
              const next = await untilAbort(iterator.next(), signal);
              signal.throwIfAborted();
              if (next.done) break;
              yield next.value;
            }
          } finally {
            signal.removeEventListener("abort", cancel);
            void iterator.return?.().catch(() => {});
            void close().catch(() => {});
          }
        },
      };
    },
  };
}

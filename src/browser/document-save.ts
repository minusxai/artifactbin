import type {
  DocumentSave,
  SaveClock,
  SaveOptions,
  SaveResult,
  SaveStatus,
} from "./document-save-contracts.ts";
/** Owns durability bookkeeping, not transport or UI. A download is never a write acknowledgement. */
export function createDocumentSave<T>(options: SaveOptions<T>): DocumentSave {
  const clock: SaveClock = options.clock ?? {
    set: (fn, delay) => setTimeout(fn, delay),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const delay = options.delayMs ?? 350;
  if (!Number.isFinite(delay) || delay < 0)
    throw Error("Invalid autosave delay");
  let version = 0,
    acknowledged = 0,
    epoch = 0,
    suspended = false,
    disposed = false,
    etag = options.etag;
  let timer: unknown,
    hasTimer = false;
  let flight:
    | {
        promise: Promise<SaveResult>;
        controller: AbortController;
        epoch: number;
      }
    | undefined;
  const status = (): SaveStatus => ({
    dirty: version !== acknowledged,
    version,
    saving: !!flight,
    suspended,
    disposed,
    etag,
  });
  function notify() {
    if (!disposed)
      try {
        options.onChange?.(status());
      } catch {
        /* Observer failures never change durability. */
      }
  }
  function clear() {
    if (hasTimer) {
      clock.clear(timer);
      hasTimer = false;
      timer = undefined;
    }
  }
  function error(reason: string) {
    return new Error("Document save " + reason);
  }
  function schedule() {
    clear();
    if (
      disposed ||
      suspended ||
      !options.write ||
      flight ||
      version === acknowledged
    )
      return;
    hasTimer = true;
    timer = clock.set(() => {
      hasTimer = false;
      timer = undefined;
      save().catch((e) => {
        if (!disposed && !suspended)
          try {
            options.onError?.(e instanceof Error ? e : new Error(String(e)));
          } catch {}
      });
    }, delay);
  }
  function save(): Promise<SaveResult> {
    if (disposed || suspended)
      return Promise.reject(error(disposed ? "disposed" : "suspended"));
    if (flight) return flight.promise;
    clear();
    const capturedVersion = version,
      capturedEpoch = epoch,
      controller = new AbortController();
    let snapshot!: T,
      captureFailed = false,
      captureError: unknown;
    let abortHandler: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abortHandler = () => reject(error(disposed ? "disposed" : "suspended"));
      controller.signal.addEventListener("abort", abortHandler, { once: true });
    });
    // Deferral ensures reentrant observers see the established in-flight operation.
    const work = Promise.resolve().then(async (): Promise<SaveResult> => {
      if (controller.signal.aborted)
        throw error(disposed ? "disposed" : "suspended");
      if (captureFailed) throw captureError;
      if (!options.write) {
        options.download(snapshot);
        return "download-started";
      }
      const receipt = await options.write({
        snapshot,
        etag,
        version: capturedVersion,
        signal: controller.signal,
      });
      if (
        disposed ||
        suspended ||
        epoch !== capturedEpoch ||
        controller.signal.aborted
      )
        throw error("obsolete");
      if (!receipt || typeof receipt.etag !== "string" || !receipt.etag)
        throw error("missing write acknowledgement");
      etag = receipt.etag;
      acknowledged = capturedVersion;
      return "written";
    });
    const promise = Promise.race([work, cancelled]).finally(() => {
      controller.signal.removeEventListener("abort", abortHandler);
      if (flight?.epoch === capturedEpoch) {
        flight = undefined;
        notify();
        if (version !== capturedVersion || epoch !== capturedEpoch) schedule();
      }
    });
    flight = { promise, controller, epoch: capturedEpoch };
    try {
      snapshot = structuredClone(options.capture());
    } catch (e) {
      captureFailed = true;
      captureError = e;
    }
    notify();
    return promise;
  }
  return {
    get status() {
      return status();
    },
    touch() {
      if (disposed) throw error("disposed");
      if (suspended) throw error("suspended");
      version++;
      schedule();
      notify();
    },
    save,
    suspend() {
      if (disposed || suspended) return;
      suspended = true;
      epoch++;
      clear();
      flight?.controller.abort();
      notify();
    },
    resume() {
      if (disposed) throw error("disposed");
      if (!suspended) return;
      suspended = false;
      schedule();
      notify();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      suspended = true;
      epoch++;
      clear();
      flight?.controller.abort();
    },
  };
}

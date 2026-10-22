import {
  PLATFORM_MAX_BYTES,
  PLATFORM_MAX_PENDING,
  type PlatformBinding,
  type PlatformClient,
  type PlatformCommand,
  type PlatformEvent,
  type PlatformMessage,
} from "./platform-contracts.ts";
export interface PlatformClientOptions extends PlatformBinding {
  origin: string;
  onEvent?: (event: PlatformEvent) => void;
}
/** The parent owns only public data; the service-origin frame owns credentials. */
export function createPlatformClient(
  options: PlatformClientOptions,
): PlatformClient {
  const url = new URL(options.origin);
  if (
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw Error("Use HTTPS for a remote server, or HTTP on localhost.");
  const origin = url.origin,
    session = crypto.randomUUID();
  if (
    window.location?.origin &&
    window.location.origin !== "null" &&
    window.location.origin === origin
  )
    throw Error(
      "Local documents require a separate origin from the credential service. Use the hosted platform shell.",
    );
  let liveGeneration = 0,
    pairGeneration = 0;
  let sequence = 0,
    disposed = false,
    loaded = false;
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.title = "Pagegi connection";
  // Platform UI, so a downloaded file's bridge and saved copy leave it out.
  frame.setAttribute("data-pagegi-ui", "");
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.sandbox.add("allow-scripts", "allow-same-origin");
  frame.referrerPolicy = "no-referrer";
  const pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const quota = (value: unknown) => {
    if (
      new TextEncoder().encode(JSON.stringify(value)).length >
      PLATFORM_MAX_BYTES
    )
      throw Error("Platform message too large");
  };
  function send(command: PlatformCommand, timeout = 15000): Promise<any> {
    if (disposed) return Promise.reject(Error("Platform disposed"));
    if (pending.size >= PLATFORM_MAX_PENDING)
      return Promise.reject(Error("Too many platform requests"));
    const id = crypto.randomUUID(),
      message = { pagegiPlatform: 1, session, seq: ++sequence, id, command };
    try {
      quota(message);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Platform request timed out"));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      try {
        if (!frame.contentWindow) throw Error("Platform frame unavailable");
        frame.contentWindow.postMessage(message, origin);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }
  function receive(event: MessageEvent) {
    if (
      disposed ||
      event.source !== frame.contentWindow ||
      event.origin !== origin
    )
      return;
    const message = event.data as PlatformMessage;
    if (!message || message.pagegiPlatform !== 1 || message.session !== session)
      return;
    try {
      quota(message);
    } catch {
      return;
    }
    if (message.kind === "event") {
      if (message.event.type === "pairing") {
        if (
          pairGeneration === 0 ||
          message.event.pairGeneration !== pairGeneration
        )
          return;
      } else if (
        liveGeneration === 0 ||
        message.event.liveGeneration !== liveGeneration
      )
        return;
      options.onEvent?.(message.event);
      return;
    }
    if (message.kind !== "response" || typeof message.id !== "string") return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    message.ok
      ? request.resolve(message.value)
      : request.reject(
          Object.assign(Error(message.error || "Platform request failed"), {
            status: message.status,
          }),
        );
  }
  window.addEventListener("message", receive);
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});
  function destroy(reason: Error) {
    if (disposed) return;
    liveGeneration++;
    pairGeneration++;
    try {
      frame.contentWindow?.postMessage(
        {
          pagegiPlatform: 1,
          session,
          seq: ++sequence,
          id: crypto.randomUUID(),
          command: { kind: "dispose" },
        },
        origin,
      );
    } catch {}
    disposed = true;
    clearTimeout(loadTimeout);
    rejectReady(reason);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(reason);
    }
    pending.clear();
    window.removeEventListener("message", receive);
    frame.remove();
  }
  const loadTimeout = setTimeout(
    () => destroy(Error("Platform frame did not load")),
    15000,
  );
  frame.addEventListener("load", () => {
    if (loaded || disposed) return;
    loaded = true;
    const binding: PlatformBinding = {
      sourceRevision: options.sourceRevision,
      sessionId: options.sessionId,
      ...(options.fileId
        ? {
            fileId: options.fileId,
            ...(options.share === undefined ? {} : { share: options.share }),
            ...(options.version === undefined ? {} : { version: options.version }),
          }
        : {
            source: options.source,
            requestId: options.requestId,
            sources: options.sources,
          }),
    };
    send({ kind: "init", binding }).then(
      () => {
        clearTimeout(loadTimeout);
        resolveReady();
      },
      (error) => {
        clearTimeout(loadTimeout);
        destroy(error);
      },
    );
  });
  frame.src = origin + "/platform-frame";
  document.body.append(frame);
  const command = async (value: PlatformCommand, timeout?: number) => {
    await ready;
    return send(value, timeout);
  };
  return {
    ready,
    pair: () =>
      command({ kind: "pair", pairGeneration: ++pairGeneration }, 305000),
    request: (operation) => command({ kind: "request", operation }),
    page: () => command({ kind: "page" }),
    backend: (path, method, body, authorizationContext) =>
      command(
        { kind: "backend", path, method, ...(body === undefined ? {} : { body }), ...(authorizationContext === undefined ? {} : {authorizationContext}) },
        35000,
      ),
    startLive: (args) =>
      command({
        kind: "live.start",
        ...args,
        liveGeneration: ++liveGeneration,
      }),
    sendPresence: (presence) => command({ kind: "live.presence", presence }),
    stopLive: () => {
      liveGeneration++;
      return command({ kind: "live.stop" });
    },
    disconnect: () => {
      liveGeneration++;
      pairGeneration++;
      return command({ kind: "disconnect" });
    },
    dispose: () => destroy(Error("Platform disposed")),
  };
}

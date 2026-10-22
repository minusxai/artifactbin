import { pairingExchange } from "./pairing-exchange.ts";
import { readBoundedJSON } from "./bounded-response.ts";
import { wireRequest, wireResult } from "./comment-wire.ts";
import { connectLive } from "../live-client.ts";
import {
  PLATFORM_MAX_BYTES,
  PLATFORM_MAX_PENDING,
  type PlatformBinding,
  type PlatformCommand,
  type PlatformEvent,
  type PlatformLiveEvent,
  type PlatformMessage,
  type PlatformOperation,
  type PlatformPage,
} from "./platform-contracts.ts";
const size = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
const text = (value: unknown, max = 256) => {
  if (typeof value !== "string" || !value || value.length > max)
    throw Error("Invalid platform data");
  return value;
};
function bindingOf(value: PlatformBinding): PlatformBinding {
  if (!value || size(value) > PLATFORM_MAX_BYTES)
    throw Error("Platform message too large");
  text(value.sourceRevision);
  text(value.sessionId);
  if (value.fileId) {
    text(value.fileId);
    // A downloaded file binds without a capability; the frame takes the link's from the page it opens.
    if (value.share !== undefined) text(value.share, 2048);
    if (
      value.version !== undefined &&
      (!Number.isSafeInteger(value.version) || value.version < 1)
    )
      throw Error("Invalid platform data");
  } else {
    text(value.source, 4e6);
    text(value.requestId, 100);
  }
  return JSON.parse(JSON.stringify(value));
}
const BACKEND_PATHS: readonly string[] = ["graphql", "backends"];
/**
 * The hosted representation without what stays in the frame: the link's
 * capability and the page grant. Everything else is public to the document.
 */
function publicPage(value: any): PlatformPage {
  const state = value?.state,
    boot = value?.boot;
  if (!state || typeof state !== "object" || !boot || typeof boot !== "object")
    throw Error("Invalid page");
  const { token: _token, ...publicBoot } = boot;
  return JSON.parse(
    JSON.stringify({
      state: {
        ...state,
        remote: state.remote ? { ...state.remote, share: "" } : null,
      },
      seed: value.seed ?? null,
      boot: publicBoot,
    }),
  );
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(Error("Platform request cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
interface Dependencies {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  emit: (event: PlatformEvent) => void;
  openLive?: typeof connectLive;
}
export function createPlatformSession(
  origin: string,
  initial: PlatformBinding,
  deps: Dependencies,
) {
  const binding = bindingOf(initial),
    fetcher = deps.fetch ?? ((url, init) => fetch(url, init)),
    sleep = deps.sleep ?? wait,
    now = deps.now ?? Date.now;
  let token: string | null = null,
    disposed = false,
    pairing = false,
    generation = 0,
    liveEpoch = 0,
    abort = new AbortController(),
    live: ReturnType<typeof connectLive> | undefined;
  let identityEpoch = 0;
  let authorizationContext: string | null = null;
  const active = (version: number) => {
    if (disposed || version !== generation || abort.signal.aborted)
      throw Error("Platform request cancelled");
  };
  const emit = (event: PlatformEvent, version = generation) => {
    if (
      !disposed &&
      version === generation &&
      size(event) <= PLATFORM_MAX_BYTES
    )
      deps.emit(event);
  };
  async function call(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    headers: Record<string, string> = {},
  ) {
    const version = generation;
    active(version);
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]);
    const response = await fetcher(origin + path, {
      method,
      credentials: "omit",
      signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await readBoundedJSON(response, PLATFORM_MAX_BYTES);
    active(version);
    if (!response.ok && response.status !== 202)
      throw Object.assign(
        Error(
          typeof value?.error === "string"
            ? value.error.slice(0, 500)
            : "Platform request failed",
        ),
        { status: response.status },
      );
    return { response, value };
  }
  function stop() {
    generation++;
    liveEpoch++;
    abort.abort();
    abort = new AbortController();
    live?.close();
    live = undefined;
    token = null;
    authorizationContext = null;
    identityEpoch++;
    pairing = false;
  }
  function credential() {
    return { Authorization: "Bearer " + (token || binding.share || "") };
  }
  /** GET /api/library/:id/host as whoever the frame is now; the capability it returns stays here. */
  async function page(): Promise<PlatformPage> {
    if (!binding.fileId) throw Error("Publish this file first");
    const { value } = await call(
      "/api/library/" + encodeURIComponent(binding.fileId) + "/host",
      undefined,
      "GET",
      credential(),
    );
    const share = value?.state?.remote?.share;
    if (typeof share === "string" && share && !binding.share) binding.share = share;
    return publicPage(value);
  }
  /** A backend route under the page, with the frame's credential; the status and body come back as they are. */
  async function backend(path: unknown, method: unknown, body: unknown, expectedContext?: string) {
    if (expectedContext !== undefined && (pairing || expectedContext !== authorizationContext))
      throw Error("Caller changed before the backend request was sent");
    if (!binding.fileId) throw Error("Publish this file first");
    if (typeof path !== "string" || !BACKEND_PATHS.includes(path))
      throw Error("Unsupported backend route");
    if (method !== "GET" && method !== "POST") throw Error("Unsupported backend route");
    const version = generation;
    active(version);
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]);
    const response = await fetcher(
      origin + "/api/files/" + encodeURIComponent(binding.fileId) + "/" + path,
      {
        method,
        credentials: "omit",
        signal,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...credential(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const value = await readBoundedJSON(response, PLATFORM_MAX_BYTES).catch(() => null);
    active(version);
    return { status: response.status, body: value };
  }
  async function pair(pairGeneration: number) {
    if (!Number.isSafeInteger(pairGeneration) || pairGeneration < 1)
      throw Error("Invalid pair generation");
    if (pairing) throw Error("Connection already pending");
    pairing = true;
    authorizationContext = null;
    identityEpoch++;
    const version = generation;
    try {
      const value = await pairingExchange({
        origin,
        binding,
        signal: abort.signal,
        fetch: fetcher,
        sleep,
        now,
        approve: (url) =>
          emit({ type: "pairing", pairGeneration, url }, version),
      });
      active(version);
      if (value.publication) {
        binding.fileId = value.publication.fileId;
        binding.share = value.publication.share;
        binding.sourceRevision = value.publication.sourceRevision;
      }
      token = value.token;
      return {
        username: value.username,
        ...(value.publication ? { publication: value.publication } : {}),
      };
    } finally {
      if (version === generation) pairing = false;
    }
  }
  async function request(op: PlatformOperation) {
    if (!binding.fileId) throw Error("Publish this file first");
    if (!op || typeof op !== "object")
      throw Error("Unsupported platform operation");
    if (op.kind === "comments.resolve") {
      if (!Number.isSafeInteger(op.revision) || op.revision < 0)
        throw Error("Invalid comment revision");
      if (op.resolved !== undefined && typeof op.resolved !== "boolean")
        throw Error("Invalid comment resolution");
    }
    if (op.kind === "comments.resolve" || op.kind === "context.get")
      text(op.id);
    if (op.kind === "presence.capture") text(op.sessionId);
    const page = {
      version: binding.version ?? null,
      revision: binding.sourceRevision,
    };
    let wire;
    try {
      wire = wireRequest(op, page);
    } catch {
      throw Error("Unsupported platform operation");
    }
    if (!wire) throw Error("Unsupported platform operation");
    const callerEpoch = identityEpoch;
    const value = (
      await call(
        "/api/files/" + encodeURIComponent(binding.fileId) + wire.path,
        wire.body,
        wire.method ?? "GET",
        { ...credential(), ...wire.headers },
      )
    ).value;
    if (callerEpoch !== identityEpoch || pairing) throw Error("Platform caller changed");
    if (op.kind === "permissions") authorizationContext = typeof value?.authorizationContext === "string" ? value.authorizationContext : null;
    return wireResult(op, value, page);
  }
  return {
    async handle(command: PlatformCommand): Promise<any> {
      if (disposed) throw Error("Platform disposed");
      if (size(command) > PLATFORM_MAX_BYTES)
        throw Error("Platform message too large");
      switch (command.kind) {
        case "pair":
          return pair(command.pairGeneration);
        case "request":
          return request(command.operation);
        case "page":
          return page();
        case "backend":
          return backend(command.path, command.method, command.body, command.authorizationContext);
        case "live.start": {
          if (!binding.fileId) throw Error("Publish this file first");
          if (command.sessionId !== binding.sessionId)
            throw Error("Invalid presence session");
          text(command.sourceRevision);
          const liveGeneration = command.liveGeneration;
          if (!Number.isSafeInteger(liveGeneration) || liveGeneration < 1)
            throw Error("Invalid live generation");
          live?.close();
          const version = generation,
            epoch = ++liveEpoch;
          const emitLive = (event: PlatformLiveEvent) => {
            if (epoch === liveEpoch)
              emit({ ...event, liveGeneration }, version);
          };
          const url = new URL(
            "/api/files/" + encodeURIComponent(binding.fileId) + "/live",
            origin,
          );
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          live = (deps.openLive ?? connectLive)({
            url: url.href,
            auth: () => ({
              token: token || binding.share || "",
              sessionId: binding.sessionId,
              sourceRevision: command.sourceRevision,
            }),
            onReady: () => emitLive({ type: "live-ready" }),
            onViewers: (viewers: unknown[]) =>
              emitLive({ type: "viewers", viewers }),
            onChanged: () => emitLive({ type: "changed" }),
            onStatus: (status: string, error?: string) =>
              emitLive({ type: "status", status, ...(error ? { error } : {}) }),
          });
          return null;
        }
        case "live.presence": {
          if (
            !command.presence ||
            typeof command.presence !== "object" ||
            Array.isArray(command.presence)
          )
            throw Error("Invalid presence");
          return (
            live?.send({
              type: "presence",
              presence: { ...command.presence, sessionId: binding.sessionId },
            }) ?? false
          );
        }
        case "live.stop":
          liveEpoch++;
          live?.close();
          live = undefined;
          return null;
        case "disconnect":
          stop();
          return null;
        case "dispose":
          stop();
          disposed = true;
          return null;
        default:
          throw Error("Unsupported platform command");
      }
    },
    dispose() {
      if (!disposed) {
        stop();
        disposed = true;
      }
    },
  };
}
interface ReceiverOptions {
  parent: unknown;
  send: (message: PlatformMessage, origin: string) => void;
  create: (
    binding: PlatformBinding,
    emit: (event: PlatformEvent) => void,
  ) => { handle(command: PlatformCommand): Promise<any>; dispose(): void };
  now?: () => number;
}
/** Receives only one document binding from its exact embedding Window. */
export function createFrameReceiver(options: ReceiverOptions) {
  let session = "",
    origin = "",
    sequence = 0,
    active = 0,
    closed = false,
    windowStart = 0,
    count = 0;
  let engine: ReturnType<ReceiverOptions["create"]> | undefined;
  const now = options.now ?? Date.now;
  return async (event: { source: unknown; origin: string; data: any }) => {
    if (closed || event.source !== options.parent) return;
    const message = event.data;
    if (
      !message ||
      message.pagegiPlatform !== 1 ||
      typeof message.session !== "string" ||
      message.session.length < 16 ||
      message.session.length > 100 ||
      !Number.isSafeInteger(message.seq) ||
      message.seq <= sequence ||
      typeof message.id !== "string" ||
      message.id.length > 100 ||
      !message.command
    )
      return;
    if (session && (message.session !== session || event.origin !== origin))
      return;
    try {
      if (size(message) > PLATFORM_MAX_BYTES) return;
    } catch {
      return;
    }
    if (!session) {
      if (message.command.kind !== "init") return;
      session = message.session;
      origin = event.origin;
      try {
        engine = options.create(message.command.binding, (event) =>
          options.send(
            { pagegiPlatform: 1, session, kind: "event", event },
            origin,
          ),
        );
      } catch {
        closed = true;
        options.send(
          {
            pagegiPlatform: 1,
            session,
            kind: "response",
            id: message.id,
            ok: false,
            error: "Invalid platform binding",
          },
          origin,
        );
        return;
      }
    } else if (message.command.kind === "init") return;
    sequence = message.seq;
    if (message.command.kind === "dispose") {
      closed = true;
      engine!.dispose();
      return;
    }
    if (now() - windowStart > 1000) {
      windowStart = now();
      count = 0;
    }
    if (++count > 64 || active >= PLATFORM_MAX_PENDING) {
      options.send(
        {
          pagegiPlatform: 1,
          session,
          kind: "response",
          id: message.id,
          ok: false,
          error: "Platform request quota exceeded",
        },
        origin,
      );
      return;
    }
    active++;
    try {
      const value =
        message.command.kind === "init"
          ? null
          : await engine!.handle(message.command);
      if (message.command.kind === "dispose") {
        closed = true;
        engine!.dispose();
      }
      if (!closed)
        options.send(
          {
            pagegiPlatform: 1,
            session,
            kind: "response",
            id: message.id,
            ok: true,
            value,
          },
          origin,
        );
    } catch (error) {
      if (!closed)
        options.send(
          {
            pagegiPlatform: 1,
            session,
            kind: "response",
            id: message.id,
            ok: false,
            status: (error as { status?: number })?.status,
            error:
              error instanceof Error
                ? error.message
                : "Platform request failed",
          },
          origin,
        );
    } finally {
      active--;
    }
  };
}
if (typeof window !== "undefined" && window.parent !== window) {
  const receive = createFrameReceiver({
    parent: window.parent,
    send: (message, origin) =>
      window.parent.postMessage(message, origin === "null" ? "*" : origin),
    create: (binding, emit) =>
      createPlatformSession(location.origin, binding, { emit }),
  });
  window.addEventListener("message", (event) => void receive(event));
}

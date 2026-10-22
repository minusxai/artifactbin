import { imageProcessingListener } from "../media/image-processing/listener.ts";
import { datasetSqlListener } from "./dataset-sql-transport.ts";
import { request as httpRequest, type RequestListener } from "node:http";
import { request as httpsRequest } from "node:https";
import { timingSafeEqual } from "node:crypto";
import {
  BackendHostError,
  boundedDetail,
  checkedBackendReuse,
  type BackendErrorCode,
  type BackendHost,
  type BackendJson,
} from "./contracts.ts";
import type {
  ExecutionLimits,
  ExecutionServiceLifecycle,
  RemoteBackendHost,
  ExecutionServiceOptions,
  RemoteBackendOptions,
} from "./execution-contracts.ts";
import { checkedBackendEnv } from "./container/env-policy.mjs";
export type ExecutionService = RequestListener & ExecutionServiceLifecycle;
type Frame = Record<string, any>;
function limits(options: ExecutionLimits) {
  const result = {
    // Above the host's own limit (8 running + its admission queue), so the queue is what governs.
    maxConcurrent: options.maxConcurrent ?? 16,
    // Above a compile's 20 s package budget plus its 10 s sandbox watchdog (packages.ts,
    // container-host.ts), so a slow package is reported by name, not as a deadline.
    deadlineMs: options.deadlineMs ?? 40000,
    maxFrameBytes: options.maxFrameBytes ?? 2500000,
    maxFrames: options.maxFrames ?? 256,
  };
  for (const value of Object.values(result))
    if (!Number.isSafeInteger(value) || value < 1)
      throw Error("Invalid execution limits");
  return result;
}
function validateSecret(secret: string) {
  if (!/^[\x21-\x7e]{32,256}$/.test(secret))
    throw Error(
      "Execution secret must contain 32–256 printable nonspace characters",
    );
}
function parser(
  maxBytes: number,
  maxFrames: number,
  receive: (frame: Frame) => void,
) {
  let pending = "";
  let count = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return (chunk: Buffer) => {
    pending += decoder.decode(chunk, { stream: true });
    for (;;) {
      const end = pending.indexOf("\n");
      if (end < 0) {
        if (Buffer.byteLength(pending) > maxBytes) throw Error("frame limit");
        return;
      }
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (Buffer.byteLength(line) > maxBytes || ++count > maxFrames)
        throw Error("frame limit");
      const frame: unknown = JSON.parse(line);
      if (!frame || typeof frame !== "object" || Array.isArray(frame))
        throw Error("invalid frame");
      receive(frame as Frame);
    }
  };
}
function encode(frame: Frame, max: number) {
  const data = JSON.stringify(frame) + "\n";
  if (Buffer.byteLength(data) > max) throw new BackendHostError("output_quota");
  return data;
}
/** The error frame for a host failure: its code, and the bounded detail when it has one. */
function failure(error: unknown): Frame {
  if (!(error instanceof BackendHostError))
    return { kind: "error", code: "backend_rejected" };
  return error.detail === undefined
    ? { kind: "error", code: error.code }
    : { kind: "error", code: error.code, detail: error.detail };
}
const CODES: readonly BackendErrorCode[] = [
  "source_quota",
  "input_quota",
  "output_quota",
  "build_rejected",
  "schema_rejected",
  "deployment_invalid",
  "field_rejected",
  "backend_rejected",
  "backend_unavailable",
  "backend_busy",
  "cancelled",
  "deadline",
  "memory_limit",
  "cleanup_failed",
  "store_limit",
  "dataset_changed",
  "dataset_mutation_rejected",
];
/** The invoke frame's `env`: required and validated by the shared environment policy. */
function envOf(value: unknown): Readonly<Record<string, string>> | null {
  try {
    return Object.freeze(checkedBackendEnv(value));
  } catch {
    return null;
  }
}
export function createExecutionService(
  options: ExecutionServiceOptions,
): ExecutionService {
  validateSecret(options.secret);
  const config = limits(options);
  const datasetSql = options.datasetSql
    ? datasetSqlListener(options.datasetSql, options.secret)
    : undefined;
  const imageProcessor = options.imageProcessor
    ? imageProcessingListener(options.imageProcessor, options.secret)
    : undefined;
  let active = 0;
  const expected = Buffer.from("Bearer " + options.secret);
  let closed = false,
    closePromise: Promise<void> | undefined;
  const owned = new Map<() => void, Promise<void>>();
  const listener: RequestListener = (req, res) => {
    if (!closed && req.url === "/v1/image-process" && imageProcessor) {
      imageProcessor(req, res);
      return;
    }
    if (
      !closed &&
      ["/v1/dataset-sql", "/v1/dataset-query"].includes(req.url ?? "") &&
      datasetSql
    ) {
      datasetSql(req, res);
      return;
    }
    if (closed) {
      res.writeHead(503).end();
      return;
    }
    const actual = Buffer.from(req.headers.authorization ?? "");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/execute") {
      res.writeHead(404).end();
      return;
    }
    if (active >= config.maxConcurrent) {
      res.writeHead(503).end();
      return;
    }
    active++;
    const controller = new AbortController();
    let cleaned!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      cleaned = resolve;
    });
    const cancel = () => finish({ kind: "error", code: "cancelled" });
    const release = () => {
      owned.delete(cancel);
      cleaned();
    };
    owned.set(cancel, cleanup);
    let started = false,
      running = false,
      done = false,
      id = 0;
    const pending = new Map<
      number,
      { resolve: (v: BackendJson) => void; reject: (e: Error) => void }
    >();
    /** Capabilities the host cancelled while the client still runs them. */
    const abandoned = new Set<number>();
    const finish = (frame?: Frame) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!running) {
        active--;
        release();
      }
      controller.abort();
      for (const item of pending.values())
        item.reject(new BackendHostError("cancelled"));
      pending.clear();
      if (frame && !res.destroyed) {
        try {
          res.end(encode(frame, config.maxFrameBytes));
        } catch {
          res.destroy();
        }
      } else if (!res.destroyed) res.destroy();
    };
    const timer = setTimeout(
      () => finish({ kind: "error", code: "deadline" }),
      config.deadlineMs,
    );
    res.writeHead(200, {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    });
    res.flushHeaders();
    res.on("close", () => finish());
    req.on("error", () => finish());
    const parse = parser(config.maxFrameBytes, config.maxFrames, (frame) => {
      if (done) return;
      if (frame.kind === "capability-result") {
        const item = pending.get(frame.id);
        if (!item) {
          if (abandoned.delete(frame.id)) return;
          throw Error("unknown capability");
        }
        pending.delete(frame.id);
        if (frame.ok === true) item.resolve(frame.value);
        // The app's handler refused: the sandbox may learn the store_limit code, nothing else.
        else
          item.reject(
            new BackendHostError(
              frame.code === "store_limit"
                ? "store_limit"
                : frame.code === "dataset_changed"
                  ? "dataset_changed"
                  : frame.code === "dataset_mutation_rejected"
                    ? "dataset_mutation_rejected"
                    : "backend_rejected",
            ),
          );
        return;
      }
      if (started) throw Error("duplicate request");
      started = true;
      let operation: Promise<unknown>;
      if (frame.kind === "compile" && typeof frame.source === "string")
        operation = options.host.compile(frame.source, controller.signal);
      else if (
        frame.kind === "invoke" &&
        frame.principal &&
        typeof frame.principal.tenant === "string" &&
        (frame.principal.subject === null ||
          (typeof frame.principal.subject === "string" &&
            frame.principal.subject)) &&
        frame.input &&
        typeof frame.input.field === "string" &&
        envOf(frame.env)
      ) {
        const env = envOf(frame.env)!;
        const principal = {
          tenant: frame.principal.tenant,
          subject: frame.principal.subject,
        };
        operation = options.host.invoke({
          deployment: frame.deployment,
          principal: principal,
          input: frame.input,
          signal: controller.signal,
          capabilityHandler: async (_p, request, signal) => {
            if (signal?.aborted) throw new BackendHostError("cancelled");
            if (done || pending.size >= 8)
              throw new BackendHostError("backend_busy");
            const capabilityId = ++id;
            return new Promise<BackendJson>((resolve, reject) => {
              // The host gave up on this capability (its own deadline or cancellation):
              // settle now so its call, slot and sandbox are released; a late reply is ignored.
              const abort = () => {
                if (!pending.delete(capabilityId)) return;
                abandoned.add(capabilityId);
                reject(new BackendHostError("cancelled"));
              };
              const settle =
                <T>(fn: (value: T) => void) =>
                (value: T) => {
                  signal?.removeEventListener("abort", abort);
                  fn(value);
                };
              pending.set(capabilityId, {
                resolve: settle(resolve),
                reject: settle(reject),
              });
              signal?.addEventListener("abort", abort, { once: true });
              try {
                res.write(
                  encode(
                    { kind: "capability", id: capabilityId, request },
                    config.maxFrameBytes,
                  ),
                );
              } catch (error) {
                pending.get(capabilityId)?.reject(error as Error);
                pending.delete(capabilityId);
              }
            });
          },
          env: env,
          reuse: checkedBackendReuse(frame.reuse),
        });
      } else throw Error("invalid request");
      running = true;
      void operation.then(
        (value) => {
          active--;
          release();
          if (!done) {
            finish({ kind: "result", value });
          }
        },
        (error) => {
          active--;
          release();
          if (!done) {
            finish(failure(error));
          }
        },
      );
    });
    req.on("data", (chunk: Buffer) => {
      try {
        parse(chunk);
      } catch {
        finish({ kind: "error", code: "backend_rejected" });
      }
    });
    req.on("end", () => {
      if (!started) finish({ kind: "error", code: "backend_rejected" });
    });
  };
  return Object.assign(listener, {
    close() {
      if (!closePromise) {
        closed = true;
        const sqlCleanup = datasetSql?.close();
        const work = [...owned.values()];
        for (const cancel of owned.keys()) cancel();
        closePromise = Promise.allSettled([
          sqlCleanup,
          imageProcessor?.close(),
          Promise.all(work).then(() => options.host.close?.()),
        ]).then((results) => {
          const failure = results.find((r) => r.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
        });
      }
      return closePromise;
    },
  });
}
export function remoteBackendHost(
  options: RemoteBackendOptions,
): RemoteBackendHost {
  validateSecret(options.secret);
  const config = limits(options);
  if (Boolean(options.endpoint) === Boolean(options.socketPath))
    throw Error("Configure exactly one execution endpoint or socketPath");
  if (
    options.socketPath &&
    (!options.socketPath.startsWith("/") || options.socketPath.includes("\0"))
  )
    throw Error("Invalid execution socket path");
  const endpoint = new URL(options.endpoint ?? "http://localhost/v1/execute");
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.pathname !== "/v1/execute" ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  )
    throw Error("Invalid execution endpoint");
  let active = 0;
  let closed = false,
    closePromise: Promise<void> | undefined;
  const owned = new Map<() => void, Promise<void>>();
  const run = (
    frame: Frame,
    signal?: AbortSignal,
    handler = options.capabilityHandler,
  ): Promise<any> => {
    if (closed)
      return Promise.reject(new BackendHostError("backend_unavailable"));
    if (signal?.aborted)
      return Promise.reject(new BackendHostError("cancelled"));
    if (active >= config.maxConcurrent)
      return Promise.reject(new BackendHostError("backend_busy"));
    active++;
    return new Promise((resolve, reject) => {
      let done = false;
      const controller = new AbortController();
      const capabilityIds = new Set<number>();
      let pendingCapabilities = 0;
      const handlers = new Set<Promise<unknown>>();
      let cleaned!: () => void;
      const cleanup = new Promise<void>((resolve) => {
        cleaned = resolve;
      });
      let socketClosed!: () => void;
      const socketCleanup = new Promise<void>((resolve) => {
        socketClosed = resolve;
      });
      const finish = (error?: Error, value?: unknown) => {
        if (done) return;
        done = true;
        active--;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        controller.abort();
        req.destroy();
        void Promise.allSettled([socketCleanup, ...handlers]).then(() => {
          owned.delete(abort);
          cleaned();
        });
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => finish(new BackendHostError("cancelled"));
      const req = (endpoint.protocol === "https:" ? httpsRequest : httpRequest)(
        endpoint,
        {
          ...(options.socketPath
            ? {
                socketPath: options.socketPath,
                path: "/v1/execute",
                agent: false,
              }
            : {}),
          method: "POST",
          headers: {
            authorization: "Bearer " + options.secret,
            "content-type": "application/x-ndjson",
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            finish(
              new BackendHostError(
                res.statusCode === 503 ? "backend_busy" : "backend_unavailable",
              ),
            );
            return;
          }
          const parse = parser(
            config.maxFrameBytes,
            config.maxFrames,
            (reply) => {
              if (done) return;
              if (reply.kind === "result") finish(undefined, reply.value);
              else if (reply.kind === "error")
                finish(
                  new BackendHostError(
                    CODES.includes(reply.code)
                      ? reply.code
                      : "backend_rejected",
                    boundedDetail(reply.detail),
                  ),
                );
              else if (
                reply.kind === "capability" &&
                Number.isSafeInteger(reply.id) &&
                reply.id > 0 &&
                frame.kind === "invoke"
              ) {
                if (capabilityIds.has(reply.id) || pendingCapabilities >= 8)
                  throw Error("Invalid capability sequence");
                capabilityIds.add(reply.id);
                pendingCapabilities++;
                const task = Promise.resolve()
                  .then(() => {
                    if (!handler || done || controller.signal.aborted)
                      throw Error();
                    return handler(
                      frame.principal,
                      reply.request,
                      controller.signal,
                    );
                  })
                  .then(
                    (value) => {
                      if (!done)
                        req.write(
                          encode(
                            {
                              kind: "capability-result",
                              id: reply.id,
                              ok: true,
                              value,
                            },
                            config.maxFrameBytes,
                          ),
                        );
                    },
                    (error: unknown) => {
                      if (!done)
                        req.write(
                          encode(
                            {
                              kind: "capability-result",
                              id: reply.id,
                              ok: false,
                              ...((error as { code?: unknown })?.code ===
                              "store_limit"
                                ? { code: "store_limit" }
                                : error instanceof BackendHostError &&
                                    error.code === "dataset_changed"
                                  ? { code: "dataset_changed" }
                                  : error instanceof BackendHostError &&
                                      error.code === "dataset_mutation_rejected"
                                    ? { code: "dataset_mutation_rejected" }
                                    : {}),
                            },
                            config.maxFrameBytes,
                          ),
                        );
                    },
                  )
                  .catch(() => finish(new BackendHostError("backend_rejected")))
                  .finally(() => {
                    pendingCapabilities--;
                    handlers.delete(task);
                  });
                handlers.add(task);
              } else throw Error("invalid response");
            },
          );
          res.on("data", (chunk: Buffer) => {
            try {
              parse(chunk);
            } catch {
              finish(new BackendHostError("backend_rejected"));
            }
          });
          res.on("end", () => {
            if (!done) finish(new BackendHostError("backend_unavailable"));
          });
          res.on("error", () =>
            finish(new BackendHostError("backend_unavailable")),
          );
        },
      );
      req.once("close", socketClosed);
      owned.set(abort, cleanup);
      const timer = setTimeout(
        () => finish(new BackendHostError("deadline")),
        config.deadlineMs,
      );
      req.on("error", () =>
        finish(new BackendHostError("backend_unavailable")),
      );
      signal?.addEventListener("abort", abort, { once: true });
      try {
        req.write(encode(frame, config.maxFrameBytes));
      } catch (error) {
        finish(error as Error);
      }
    });
  };
  return {
    close() {
      if (!closePromise) {
        closed = true;
        const work = [...owned.values()];
        for (const cancel of owned.keys()) cancel();
        closePromise = Promise.all(work).then(() => {});
      }
      return closePromise;
    },
    compile: (source, signal) => run({ kind: "compile", source }, signal),
    invoke({
      deployment,
      principal,
      input,
      signal,
      capabilityHandler,
      env,
      reuse,
    }) {
      // A malformed env or reuse is a rejected invocation, never a synchronous throw;
      // env is the caller's quota (as the container host reports it), reuse the platform's.
      return Promise.resolve().then(() => {
        let checkedEnv: Record<string, string>;
        try {
          checkedEnv = checkedBackendEnv(env);
        } catch {
          throw new BackendHostError("input_quota");
        }
        const frame: Frame = {
          kind: "invoke",
          deployment,
          principal,
          input,
          env: checkedEnv,
          reuse: checkedBackendReuse(reuse),
        };
        return run(frame, signal, capabilityHandler);
      });
    },
  };
}

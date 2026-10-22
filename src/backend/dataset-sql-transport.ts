import { decodeDatasetSqlOutcome } from "../datasets/sql/outcome.ts";
import { request as httpRequest, type RequestListener } from "node:http";
import { request as httpsRequest } from "node:https";
import { timingSafeEqual } from "node:crypto";
import { DATASET_SQL_LIMITS as limits } from "../datasets/mutation/contracts.ts";
import { validateDatasetSqlJob } from "../datasets/sql/job.ts";
import type {
  DatasetSqlExecutor,
  RemoteDatasetSqlOptions,
} from "./dataset-sql-contracts.ts";
import type { MutationOutcome } from "../datasets/sql/engine/sql-contracts.ts";
const RESPONSE_LIMIT = limits.outputBytes + 1024;
function secret(value: string) {
  if (!/^[\x21-\x7e]{32,256}$/.test(value))
    throw Error("Invalid execution secret");
  return Buffer.from("Bearer " + value);
}
/** Same execution-controller authentication; bounded raw bytes are checked before JSON parsing. */
export function datasetSqlListener(
  executor: DatasetSqlExecutor,
  key: string,
): RequestListener & { close(): Promise<void> } {
  const expected = secret(key);
  let closed = false;
  const owned = new Map<AbortController, Promise<void>>();
  const listener: RequestListener = (req, res) => {
    const actual = Buffer.from(req.headers.authorization ?? "");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.writeHead(401).end();
      return;
    }
    if (closed) {
      res.writeHead(503).end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/dataset-sql") {
      res.writeHead(404).end();
      return;
    }
    // No unbounded admission queue, and at most two large incoming SQL frames per controller.
    if (owned.size >= 2) {
      res.writeHead(503).end();
      return;
    }
    const controller = new AbortController();
    let release!: () => void;
    owned.set(
      controller,
      new Promise((r) => {
        release = r;
      }),
    );
    let total = 0,
      done = false,
      running = false;
    const chunks: Buffer[] = [];
    const releaseInput = () => {
      if (!running) {
        owned.delete(controller);
        release();
      }
    };
    const finish = (status: number, data?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chunks.length = 0;
      controller.abort();
      if (!running) req.once("close", releaseInput);
      if (!res.destroyed)
        res
          .writeHead(status, {
            "content-type": "application/json",
            "cache-control": "no-store",
          })
          .end(data, () => {
            if (!req.complete) req.destroy();
            releaseInput();
          });
      else {
        req.destroy();
        releaseInput();
      }
    };
    const timer = setTimeout(() => finish(504), 25000);
    controller.signal.addEventListener(
      "abort",
      () => {
        if (!done) finish(499);
      },
      { once: true },
    );
    res.once("close", () => {
      if (!done) finish(499);
    });
    req.once("error", () => finish(400));
    req.once("aborted", () => finish(400));
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > limits.inputBytes) {
        finish(413);
        return;
      }
      chunks.push(chunk);
    });
    req.once("end", () => {
      if (done) return;
      let job: unknown;
      try {
        job = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
        validateDatasetSqlJob(job);
        chunks.length = 0;
      } catch {
        finish(400);
        return;
      }
      running = true;
      void executor
        .execute(job, controller.signal)
        .then(
          (value) => {
            let data: string;
            try {
              data = JSON.stringify(value);
              if (Buffer.byteLength(data) > RESPONSE_LIMIT) throw Error();
            } catch {
              finish(502);
              return;
            }
            finish(200, data);
          },
          () => finish(502),
        )
        .finally(() => {
          owned.delete(controller);
          release();
        });
    });
  };
  return Object.assign(listener, {
    async close() {
      closed = true;
      const work = [...owned.values()];
      for (const c of owned.keys()) c.abort();
      await Promise.all(work);
      await executor.close();
    },
  });
}
/** App-side client: only HTTP/socket authority, no Docker access or engine import. */
export function remoteDatasetSqlExecutor(
  options: RemoteDatasetSqlOptions,
): DatasetSqlExecutor {
  const authorization = secret(options.secret).toString();
  if (Boolean(options.endpoint) === Boolean(options.socketPath))
    throw Error("Configure exactly one execution endpoint or socket");
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
  endpoint.pathname = "/v1/dataset-sql";
  if (
    options.socketPath &&
    (!options.socketPath.startsWith("/") || options.socketPath.includes("\0"))
  )
    throw Error("Invalid execution socket");
  let closed = false;
  const active = new Map<AbortController, Promise<void>>();
  return {
    async execute(job, signal) {
      validateDatasetSqlJob(job);
      if (closed || signal?.aborted) throw Error("sql_unavailable");
      if (active.size >= 2) throw Error("sql_busy");
      const body = JSON.stringify(job),
        controller = new AbortController();
      let release!: () => void;
      active.set(
        controller,
        new Promise((r) => {
          release = r;
        }),
      );
      const forward = () => controller.abort();
      signal?.addEventListener("abort", forward, { once: true });
      try {
        return await new Promise<MutationOutcome>((resolve, reject) => {
          let done = false,
            total = 0;
          const chunks: Buffer[] = [];
          const finish = (error?: Error, value?: MutationOutcome) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", cancel);
            req.destroy();
            error ? reject(error) : resolve(value!);
          };
          const cancel = () => finish(Error("cancelled"));
          const timer = setTimeout(() => finish(Error("sql_deadline")), 26000);
          const req = (
            endpoint.protocol === "https:" ? httpsRequest : httpRequest
          )(
            endpoint,
            {
              method: "POST",
              ...(options.socketPath
                ? {
                    socketPath: options.socketPath,
                    path: "/v1/dataset-sql",
                    agent: false,
                  }
                : {}),
              headers: { authorization, "content-type": "application/json" },
            },
            (res) => {
              if (res.statusCode !== 200) {
                res.resume();
                finish(Error("sql_rejected"));
                return;
              }
              res.on("data", (chunk: Buffer) => {
                if (done) return;
                total += chunk.length;
                if (total > RESPONSE_LIMIT) finish(Error("sql_output_limit"));
                else chunks.push(chunk);
              });
              res.once("end", () => {
                if (done) return;
                try {
                  const value: unknown = JSON.parse(
                    Buffer.concat(chunks, total).toString("utf8"),
                  );
                  if (
                    !value ||
                    typeof value !== "object" ||
                    Array.isArray(value)
                  )
                    throw Error();
                  finish(undefined, decodeDatasetSqlOutcome(job, value));
                } catch {
                  finish(Error("sql_invalid_result"));
                }
              });
              res.once("error", () => finish(Error("sql_unavailable")));
            },
          );
          req.once("error", () => finish(Error("sql_unavailable")));
          controller.signal.addEventListener("abort", cancel, { once: true });
          req.end(body);
        });
      } finally {
        signal?.removeEventListener("abort", forward);
        active.delete(controller);
        release();
      }
    },
    async close() {
      closed = true;
      const work = [...active.values()];
      for (const c of active.keys()) c.abort();
      await Promise.all(work);
    },
  };
}

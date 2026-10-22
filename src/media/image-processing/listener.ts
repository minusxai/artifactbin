import type { RequestListener } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { ImageJobExecutor } from "./contracts.ts";
import { IMAGE_PROCESS_LIMITS as limits } from "./contracts.ts";
export function imageProcessingListener(
  executor: ImageJobExecutor,
  secret: string,
): RequestListener & { close(): Promise<void> } {
  if (!/^[\x21-\x7e]{32,256}$/.test(secret))
    throw Error("Invalid execution secret");
  const expected = Buffer.from("Bearer " + secret),
    active = new Map<AbortController, Promise<void>>();
  let closed = false;
  const listener: RequestListener = (req, res) => {
    const actual = Buffer.from(req.headers.authorization ?? "");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.writeHead(401).end(() => req.destroy());
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/image-process") {
      res.writeHead(404).end(() => req.destroy());
      return;
    }
    if (closed || active.size) {
      res.writeHead(503).end(() => req.destroy());
      return;
    }
    const declared = req.headers["content-length"];
    if (
      declared !== undefined &&
      (!/^[0-9]+$/.test(declared) ||
        Number(declared) < 1 ||
        Number(declared) > limits.inputBytes)
    ) {
      res.writeHead(413).end(() => req.destroy());
      return;
    }
    const abort = new AbortController();
    const stopInput = () => {
      if (!req.complete) req.destroy();
    };
    abort.signal.addEventListener("abort", stopInput, { once: true });
    let release!: () => void;
    active.set(abort, new Promise((r) => (release = r)));
    const timer = setTimeout(
      () => abort.abort(Error("image_deadline")),
      limits.transportMs,
    );
    const disconnect = () => {
      if (!res.writableEnded) abort.abort(Error("image_cancelled"));
    };
    res.once("close", disconnect);
    async function* input() {
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > limits.inputBytes) throw Error("image_input_limit");
        yield chunk;
      }
      if (!total) throw Error("image_input_limit");
    }
    let outputBytes = 0;
    void executor
      .execute(
        input(),
        async (chunk) => {
          abort.signal.throwIfAborted();
          outputBytes += chunk.length;
          if (outputBytes > limits.outputBytes)
            throw Error("image_output_limit");
          if (!res.headersSent)
            res.writeHead(200, {
              "content-type": "application/octet-stream",
              "cache-control": "no-store",
            });
          await new Promise<void>((resolve, reject) =>
            res.write(chunk, (error) => (error ? reject(error) : resolve())),
          );
        },
        abort.signal,
      )
      .then(
        () => {
          if (!res.destroyed) res.end();
        },
        () => {
          if (res.headersSent) res.destroy();
          else res.writeHead(503).end();
        },
      )
      .finally(() => {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", stopInput);
        res.off("close", disconnect);
        abort.abort();
        if (!req.complete) req.destroy();
        active.delete(abort);
        release();
      });
  };
  return Object.assign(listener, {
    async close() {
      closed = true;
      const work = [...active.values()];
      for (const abort of active.keys()) abort.abort();
      await Promise.all(work);
      await executor.close();
    },
  });
}

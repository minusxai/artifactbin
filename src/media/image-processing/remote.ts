import { constants } from "node:fs";
import { open, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ImageProcessor } from "./contracts.ts";
import { IMAGE_PROCESS_LIMITS as limits } from "./contracts.ts";
import { rasterType } from "./engine.ts";
import { readImageResponse } from "./response.ts";
/** App-side byte transport only. Native decoder and Docker access are absent from this module. */
export function remoteImageProcessor(options: {
  endpoint: string;
  secret: string;
  socketPath?: string;
}): ImageProcessor {
  const url = new URL(options.endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\S{32,256}$/.test(options.secret)
  )
    throw Error("image_configuration");
  url.pathname = "/v1/image-process";
  let closed = false;
  let active: { abort: AbortController; done: Promise<void> } | undefined;
  return {
    async process(source, signal) {
      if (closed || active) throw Error("image_unavailable");
      signal?.throwIfAborted();
      if (
        !Number.isSafeInteger(source.byteLength) ||
        source.byteLength < 1 ||
        source.byteLength > limits.inputBytes ||
        !["image/png", "image/jpeg", "image/webp"].includes(source.contentType)
      )
        throw Error("image_input_limit");
      const abort = new AbortController();
      const forward = () => abort.abort(signal?.reason);
      signal?.addEventListener("abort", forward, { once: true });
      let finish!: () => void;
      active = { abort, done: new Promise((r) => (finish = r)) };
      const timer = setTimeout(
        () => abort.abort(Error("image_deadline")),
        limits.transportMs,
      );
      let directory: string | undefined;
      let file: Awaited<ReturnType<typeof open>> | undefined;
      let upload: Promise<void> | undefined;
      let req: ReturnType<typeof httpRequest> | undefined;
      const cancel = () => req?.destroy();
      abort.signal.addEventListener("abort", cancel, { once: true });
      try {
        file = await open(
          source.path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const stat = await file.stat();
        abort.signal.throwIfAborted();
        if (!stat.isFile() || stat.size !== source.byteLength)
          throw Error("image_input_changed");
        directory = await mkdtemp(join(tmpdir(), "page-image-"));
        const outputDirectory = directory;
        const hash = createHash("sha256");
        let count = 0;
        let prefix = Buffer.alloc(0);
        const measured = new Transform({
          transform(chunk, _encoding, callback) {
            count += chunk.length;
            if (count > source.byteLength) {
              callback(Error("image_input_changed"));
              return;
            }
            if (prefix.length < 12)
              prefix = Buffer.concat([
                prefix,
                chunk.subarray(0, 12 - prefix.length),
              ]);
            hash.update(chunk);
            callback(null, chunk);
          },
          flush(callback) {
            callback(
              count !== source.byteLength ||
                rasterType(prefix) !== source.contentType
                ? Error("image_input_changed")
                : undefined,
            );
          },
        });
        const response = new Promise<import("node:http").IncomingMessage>(
          (resolve, reject) => {
            req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
              url,
              {
                method: "POST",
                socketPath: options.socketPath,
                headers: {
                  authorization: "Bearer " + options.secret,
                  "content-length": source.byteLength,
                  "content-type": "application/octet-stream",
                },
              },
              resolve,
            );
            req.on("error", reject);
            upload = pipeline(
              file!.createReadStream({ autoClose: false }),
              measured,
              req,
            );
            void upload.catch(reject);
          },
        );
        const res = await response;
        res.on("error", () => {});
        if (res.statusCode !== 200) {
          res.destroy();
          throw Error("image_unavailable");
        }
        const parsed = await readImageResponse(
          res,
          outputDirectory,
          source.byteLength,
          source.contentType,
          abort.signal,
        );
        await upload;
        abort.signal.throwIfAborted();
        const primary = parsed.primary ?? {
          path: source.path,
          byteLength: source.byteLength,
          contentType: source.contentType,
          sha256: hash.digest("hex"),
        };
        const small =
          parsed.small && parsed.manifest.small
            ? {
                ...parsed.small,
                contentType: "image/webp" as const,
                width: parsed.manifest.small.width,
                height: parsed.manifest.small.height,
              }
            : undefined;
        directory = undefined;
        return {
          primary,
          ...(small ? { small } : {}),
          width: parsed.manifest.primary.width,
          height: parsed.manifest.primary.height,
          placeholder: parsed.manifest.placeholder,
          totalBytes: primary.byteLength + (small?.byteLength ?? 0),
          dispose: () => rm(outputDirectory, { recursive: true, force: true }),
        };
      } catch (error) {
        abort.abort();
        req?.destroy();
        await upload?.catch(() => {});
        throw error;
      } finally {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", cancel);
        signal?.removeEventListener("abort", forward);
        await file?.close();
        if (directory) await rm(directory, { recursive: true, force: true });
        active = undefined;
        finish();
      }
    },
    async close() {
      closed = true;
      const current = active;
      current?.abort.abort(Error("image_closed"));
      await current?.done;
    },
  };
}

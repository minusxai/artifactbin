import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DatasetAttachmentHttpPorts } from "./dataset-attachment-http-contracts.ts";
import {
  DATASET_ATTACHMENT_LIMITS,
  DatasetAttachmentError,
} from "../datasets/attachments/contracts.ts";
import type { DatasetAttachmentMime } from "../datasets/attachments/contracts.ts";
import { preparePrivateMedia } from "../media/http.ts";
const base =
  /^\/api\/files\/([A-Za-z0-9]{6})\/dataset-attachments\/([A-Za-z_][A-Za-z0-9_-]{0,127})\/([A-Za-z_][A-Za-z0-9_-]{0,127})(?:\/([a-f0-9]{32}))?$/;
const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : "";
/** Dedicated raw-body boundary: binary data never enters the JSON capability/parser budget. */
export async function serveDatasetAttachments(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ports: DatasetAttachmentHttpPorts,
  credential: string,
): Promise<boolean> {
  if (!url.pathname.includes("/dataset-attachments/")) return false;
  preparePrivateMedia(res);
  const match = base.exec(url.pathname);
  const method = req.method || "GET";
  const send = (status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (
    !match ||
    url.search ||
    !["GET", "HEAD", "POST"].includes(method) ||
    (match[4] && method === "POST") ||
    (!match[4] && method === "HEAD")
  ) {
    send(404, { error: "Not found" });
    return true;
  }
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
    if (!req.complete) req.destroy();
  };
  const timer = setTimeout(abort, DATASET_ATTACHMENT_LIMITS.timeoutMs);
  timer.unref();
  req.once("aborted", abort);
  const disconnected = () => {
    if (!res.writableFinished) abort();
  };
  res.once("close", disconnected);
  try {
    if (method === "POST") {
      const origin = one(req.headers.origin);
      if (
        (origin && origin !== url.origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        throw new DatasetAttachmentError("denied");
      if (!credential) throw new DatasetAttachmentError("denied");
      const length = one(req.headers["content-length"]);
      if (
        length &&
        (!/^\d+$/.test(length) ||
          Number(length) > DATASET_ATTACHMENT_LIMITS.fileBytes)
      )
        throw new DatasetAttachmentError("too_large");
    }
    const context = await ports.resolve(
      {
        pageId: match[1]!,
        backendNamespace: match[2]!,
        bindingName: match[3]!,
        credential,
      },
      controller.signal,
    );
    if (!context) throw new DatasetAttachmentError("denied");
    if (method === "POST") {
      const encoded = one(req.headers["x-filename"]);
      if (encoded.length > 3060)
        throw new DatasetAttachmentError("invalid_request");
      let filename: string;
      try {
        filename = decodeURIComponent(encoded);
      } catch {
        throw new DatasetAttachmentError("invalid_request");
      }
      const contentType = one(req.headers["content-type"]);
      if (!["image/png", "image/jpeg", "image/webp"].includes(contentType))
        throw new DatasetAttachmentError("invalid_request");
      // Keep the response writable on bounded parser refusal; close the connection after responding.
      const body = (async function* () {
        for await (const chunk of req.iterator({ destroyOnReturn: false }))
          yield chunk as Uint8Array;
      })();
      const receipt = await ports.service.upload(
        context,
        {
          requestId: one(req.headers["idempotency-key"]),
          filename,
          contentType: contentType as DatasetAttachmentMime,
          body,
        },
        controller.signal,
      );
      send(200, receipt);
    } else if (!match[4])
      send(200, await ports.service.availability(context, controller.signal));
    else {
      const download = await ports.service.read(
        context,
        match[4],
        controller.signal,
      );
      if (!download) {
        send(404, { error: "Not found" });
        return true;
      }
      try {
        res.writeHead(200, {
          "Content-Type": download.record.object.contentType,
          "Content-Length": download.record.object.byteLength,
          "Content-Disposition": `inline; filename="image"; filename*=UTF-8''${encodeURIComponent(download.record.object.filename)}`,
        });
        if (method === "HEAD") res.end();
        else
          await pipeline(Readable.from(download.body), res, {
            signal: controller.signal,
          });
      } finally {
        await download.close();
      }
    }
  } catch (error) {
    if (res.headersSent) res.destroy();
    else {
      if (!req.complete) res.setHeader("Connection", "close");
      const code =
        error instanceof DatasetAttachmentError ? error.code : "unavailable";
      send(
        code === "denied"
          ? 404
          : code === "invalid_request"
            ? 400
            : code === "too_large"
              ? 413
              : code === "busy"
                ? 429
                : code === "conflict"
                  ? 409
                  : code === "quota"
                    ? 422
                    : 503,
        { error: code },
      );
    }
  } finally {
    clearTimeout(timer);
    req.off("aborted", abort);
    res.off("close", disconnected);
    if (!req.complete) {
      res.once("finish", () => req.destroy());
      if (res.writableFinished) req.destroy();
    }
  }
  return true;
}

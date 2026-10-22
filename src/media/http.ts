import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isMediaPath, parseMediaAddress } from "./address.ts";
import type { MediaRequest, MediaResponse } from "./contracts.ts";
export interface MediaService {
  read(request: MediaRequest): Promise<MediaResponse>;
}
export function preparePrivateMedia(res: ServerResponse) {
  for (const name of [
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Headers",
    "Access-Control-Expose-Headers",
    "Access-Control-Allow-Methods",
    "Access-Control-Allow-Credentials",
  ])
    res.removeHeader(name);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
}
export async function writePrivateMedia(
  req: IncomingMessage,
  res: ServerResponse,
  response: MediaResponse,
) {
  try {
    res.writeHead(response.status, response.headers);
    if (response.body && req.method !== "HEAD")
      await pipeline(Readable.from(response.body), res);
    else res.end();
  } catch {
    res.destroy();
  } finally {
    await response.close().catch(() => {});
  }
}
/** Removes the API's permissive CORS defaults before every media response, including denials. */
export async function serveMedia(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  service: MediaService,
  credential: string,
): Promise<boolean> {
  if (!isMediaPath(url.pathname)) return false;
  preparePrivateMedia(res);
  const address = parseMediaAddress(url.pathname);
  if (!address || url.search || !["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(404);
    res.end();
    return true;
  }
  let response: MediaResponse;
  try {
    response = await service.read({
      address,
      credential,
      method: req.method as "GET" | "HEAD",
      ...(req.headers.range !== undefined &&
      req.headers["if-range"] === undefined
        ? { range: req.headers.range }
        : {}),
    });
  } catch {
    res.writeHead(503);
    res.end();
    return true;
  }
  await writePrivateMedia(req, res, response);
  return true;
}

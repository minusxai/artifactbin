import type { IncomingMessage, ServerResponse } from "node:http";
import type { SupplementalService } from "./supplemental-contracts.ts";
import {
  isSupplementalPath,
  parseSupplementalAddress,
} from "./supplemental-address.ts";
import { preparePrivateMedia, writePrivateMedia } from "./http.ts";
export async function serveSupplemental(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  service: SupplementalService,
  credential: string,
): Promise<boolean> {
  if (!isSupplementalPath(url.pathname)) return false;
  preparePrivateMedia(res);
  const address = parseSupplementalAddress(url.pathname);
  if (!address || url.search || !["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(404);
    res.end();
    return true;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  req.once("aborted", cancel);
  res.once("close", cancel);
  try {
    const response = await service.read({
      address,
      credential,
      method: req.method as "GET" | "HEAD",
      signal: controller.signal,
      ...(req.headers.range !== undefined &&
      req.headers["if-range"] === undefined
        ? { range: req.headers.range }
        : {}),
    });
    await writePrivateMedia(req, res, response);
  } catch {
    if (!res.headersSent) {
      res.writeHead(503);
      res.end();
    } else res.destroy();
  } finally {
    req.off("aborted", cancel);
    res.off("close", cancel);
  }
  return true;
}

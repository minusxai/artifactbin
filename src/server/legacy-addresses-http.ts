import type { IncomingMessage, ServerResponse } from "node:http";
import { preparePrivateMedia, writePrivateMedia } from "../media/http.ts";
import {
  legacyPageURL,
  parseLegacyAddress,
  readLegacyRaw,
} from "./legacy-addresses.ts";
import type { LegacyAddressPorts } from "./legacy-addresses-contracts.ts";
/** Compose before normal page-address dispatch. The injected handler retains normal hosted/download authorization. */
export async function serveLegacyAddress(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  credential: string,
  ports: LegacyAddressPorts,
  servePage: (url: URL, id: string) => Promise<void>,
): Promise<boolean> {
  const address = parseLegacyAddress(url.pathname);
  if (!address) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    preparePrivateMedia(res);
    res.writeHead(404);
    res.end();
    return true;
  }
  if (address.kind !== "raw") {
    await servePage(legacyPageURL(url, address), address.id);
    return true;
  }
  // Remove API CORS defaults even if selector parsing or authorization fails.
  preparePrivateMedia(res);
  const response = await readLegacyRaw(
    url,
    req.method,
    credential,
    {
      ...(req.headers.range === undefined ? {} : { range: req.headers.range }),
      ...(req.headers["if-range"] === undefined
        ? {}
        : { ifRange: String(req.headers["if-range"]) }),
    },
    ports,
  );
  await writePrivateMedia(req, res, response);
  return true;
}

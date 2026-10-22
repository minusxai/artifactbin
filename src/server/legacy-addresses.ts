import { fail } from "../errors.ts";
import { parsePageRevision } from "./page-revision.ts";
import type {
  LegacyAddress,
  LegacyAddressPorts,
} from "./legacy-addresses-contracts.ts";
import type { MediaResponse } from "../media/contracts.ts";
/** Deliberately no catch-all suffix or claim to support the retired offline protocol. */
export function parseLegacyAddress(path: string): LegacyAddress | null {
  const page = /^\/a\/([A-Za-z0-9]{6})\/(raw|download|app\/?)$/.exec(path);
  if (page)
    return {
      id: page[1]!,
      kind: page[2]!.startsWith("app")
        ? "hosted"
        : (page[2] as "raw" | "download"),
    };
  const workspace = /^\/workspace\/([A-Za-z0-9]{6})$/.exec(path);
  return workspace ? { id: workspace[1]!, kind: "hosted" } : null;
}
/** Internal dispatch, not a cacheable redirect from a mutable head. */
export function legacyPageURL(url: URL, address: LegacyAddress): URL {
  if (address.kind === "raw")
    throw new TypeError("Raw addresses do not serve the hosted wrapper");
  const next = new URL(url);
  next.pathname = "/a/" + address.id;
  if (address.kind === "download") next.searchParams.set("download", "1");
  return next;
}
const headers = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-site",
  Vary: "Cookie, Authorization",
};
const missing = (): MediaResponse => ({
  status: 404,
  headers,
  async close() {},
});
export async function readLegacyRaw(
  url: URL,
  method: "GET" | "HEAD",
  credential: string,
  requestHeaders: { range?: string; ifRange?: string },
  ports: LegacyAddressPorts,
): Promise<MediaResponse> {
  const address = parseLegacyAddress(url.pathname);
  if (!address || address.kind !== "raw") return missing();
  const query = new URLSearchParams(url.searchParams);
  // Earlier media URLs used v; ambiguous selectors must never choose a different saved view.
  const old = query.getAll("v");
  if (old.length) {
    if (old.length !== 1 || query.has("version"))
      fail(400, "Invalid saved page version");
    query.set("version", old[0]!);
  }
  const selection = parsePageRevision(query);
  const found = await ports.raw.read(
    address.id,
    credential,
    selection.kind === "saved" ? selection.version : undefined,
  );
  if (!found) return missing();
  if (found.kind === "media") {
    if (
      found.address.pageId !== address.id ||
      found.address.variant !== "original" ||
      (selection.kind === "saved" &&
        found.address.revision !== String(selection.version))
    )
      return missing();
    return ports.media.read({
      address: found.address,
      credential,
      method,
      ...(requestHeaders.range !== undefined &&
      requestHeaders.ifRange === undefined
        ? { range: requestHeaders.range }
        : {}),
    });
  }
  const bytes = new TextEncoder().encode(found.source);
  return {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${address.id}.html"`,
      "Content-Length": String(bytes.byteLength),
    },
    ...(method === "GET"
      ? {
          body: (async function* () {
            yield bytes;
          })(),
        }
      : {}),
    async close() {},
  };
}

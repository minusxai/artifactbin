/** Explicit offline capture tool only. Neither compiler runner imports this module. */
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { FONT_CAPTURE_LIMITS } from "./capture-contracts.ts";
import { fontCaptureAddress, isPublicFontAddress } from "./capture-policy.ts";
interface FontCapturePorts {
  lookup: (
    hostname: string,
  ) => Promise<readonly { address: string; family: number }[]>;
  request: typeof request;
}
export function createFontCaptureTransport(ports: FontCapturePorts) {
  return async function fetchFontResource(
    raw: string,
    kind: "stylesheet" | "font",
    options: { signal: AbortSignal; maxBytes: number },
  ): Promise<Uint8Array> {
    const url = fontCaptureAddress(raw, kind);
    const signal = AbortSignal.any([
      options.signal,
      AbortSignal.timeout(FONT_CAPTURE_LIMITS.deadlineMs),
    ]);
    if (signal.aborted) throw Error("Font capture cancelled");
    if (
      !Number.isSafeInteger(options.maxBytes) ||
      options.maxBytes < 1 ||
      options.maxBytes >
        (kind === "stylesheet"
          ? FONT_CAPTURE_LIMITS.stylesheetBytes
          : FONT_CAPTURE_LIMITS.fontBytes)
    )
      throw Error("Font capture resource limit");
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(Error("Font capture cancelled"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const addresses = await Promise.race([
      aborted,
      Promise.resolve().then(() => {
        if (signal.aborted) throw Error("Font capture cancelled");
        return ports.lookup(url.hostname);
      }),
    ]).finally(() => signal.removeEventListener("abort", onAbort));
    if (signal.aborted) throw Error("Font capture cancelled");
    if (
      !addresses.length ||
      addresses.some((a) => !isPublicFontAddress(a.address))
    )
      throw Error("Font capture DNS refused");
    const pinned = addresses[0]!;
    return new Promise((resolve, reject) => {
      const req = ports.request(
        url,
        {
          method: "GET",
          agent: false,
          signal,
          servername: url.hostname,
          lookup: ((_host: any, lookupOptions: any, callback: any) =>
            lookupOptions.all
              ? callback(null, [
                  { address: pinned.address, family: pinned.family },
                ])
              : callback(null, pinned.address, pinned.family)) as any,
          headers: {
            Accept: kind === "stylesheet" ? "text/css" : "font/woff2",
            "Accept-Encoding": "identity",
            "User-Agent":
              "Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
          },
        },
        (res) => {
          if (
            res.statusCode !== 200 ||
            (res.headers["content-encoding"] &&
              res.headers["content-encoding"] !== "identity")
          ) {
            res.destroy();
            reject(Error("Font capture response refused"));
            return;
          }
          const type = String(res.headers["content-type"] ?? "")
            .split(";")[0]
            ?.trim()
            .toLowerCase();
          if (
            kind === "stylesheet"
              ? type !== "text/css"
              : !["font/woff2", "application/octet-stream"].includes(type ?? "")
          ) {
            res.destroy();
            reject(Error("Font capture content type refused"));
            return;
          }
          const declared = Number(res.headers["content-length"]);
          if (Number.isFinite(declared) && declared > options.maxBytes) {
            res.destroy();
            reject(Error("Font capture byte limit"));
            return;
          }
          let total = 0,
            ended = false;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > options.maxBytes) {
              res.destroy(Error("Font capture byte limit"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", () => reject(Error("Font capture response failed")));
          res.on("aborted", () =>
            reject(Error("Font capture response aborted")),
          );
          res.on("close", () => {
            if (!ended) reject(Error("Font capture response incomplete"));
          });
          res.on("end", () => {
            ended = true;
            resolve(Buffer.concat(chunks, total));
          });
        },
      );
      req.on("error", () => reject(Error("Font capture request failed")));
      req.end();
    });
  };
}
export const fetchFontResource = createFontCaptureTransport({
  lookup: (host) => lookup(host, { all: true, verbatim: true }),
  request,
});

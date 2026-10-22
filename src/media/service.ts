import type {
  MediaReadRepository,
  MediaStore,
  MediaRequest,
  MediaResponse,
  MediaDescriptor,
} from "./contracts.ts";
import { mediaAddress } from "./address.ts";
import { mediaRange } from "./range.ts";
const securityHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-site",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  Vary: "Cookie, Authorization",
};
function disposition(descriptor: MediaDescriptor): string {
  const inline = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ].includes(descriptor.contentType);
  const filename = Array.from(
    descriptor.filename || `asset-${descriptor.pageId}`,
  )
    .map((character) => {
      const point = character.codePointAt(0)!;
      return point >= 0xd800 && point <= 0xdfff ? "\ufffd" : character;
    })
    .join("");
  const ascii =
    filename.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 255) || "asset";
  const encoded = encodeURIComponent(
    Array.from(filename).slice(0, 255).join(""),
  ).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
const empty = (
  status: MediaResponse["status"],
  headers: Record<string, string> = {},
): MediaResponse => ({
  status,
  headers: { ...securityHeaders, ...headers },
  async close() {},
});
export function createMediaService(
  repository: MediaReadRepository,
  store: MediaStore,
) {
  return {
    async read(request: MediaRequest): Promise<MediaResponse> {
      try {
        mediaAddress(request.address);
      } catch {
        return empty(404);
      }
      const descriptor = await repository.read(
        request.address,
        request.credential,
      );
      if (
        !descriptor ||
        descriptor.pageId !== request.address.pageId ||
        descriptor.revision !== request.address.revision ||
        descriptor.variant !== request.address.variant ||
        descriptor.sha256 !== request.address.sha256 ||
        descriptor.storageKey !== descriptor.sha256 ||
        !Number.isSafeInteger(descriptor.byteLength) ||
        descriptor.byteLength < 0
      )
        return empty(404);
      if (
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(
          descriptor.contentType,
        )
      )
        return empty(503);
      let range;
      try {
        range = mediaRange(
          request.method === "GET" ? request.range : undefined,
          descriptor.byteLength,
        );
      } catch {
        return empty(416, {
          "Content-Range": `bytes */${descriptor.byteLength}`,
          "Accept-Ranges": "bytes",
        });
      }
      let object;
      try {
        object = await store.open(descriptor);
      } catch {
        return empty(503);
      }
      const headers = {
        ...securityHeaders,
        "Content-Type": descriptor.contentType,
        "Content-Disposition": disposition(descriptor),
        "Accept-Ranges": "bytes",
        "Content-Length": String(
          range ? range.end - range.start + 1 : descriptor.byteLength,
        ),
        ...(range
          ? {
              "Content-Range": `bytes ${range.start}-${range.end}/${descriptor.byteLength}`,
            }
          : {}),
      };
      return {
        status: range ? 206 : 200,
        headers,
        ...(request.method === "GET"
          ? { body: object.stream(range ?? undefined) }
          : {}),
        close: () => object.close(),
      };
    },
  };
}

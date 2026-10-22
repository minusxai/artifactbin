import type { SupplementalAddress } from "../media/supplemental-contracts.ts";
import { supplementalAddress } from "../media/supplemental-address.ts";
/** Fits the bounded JSON bridge including base64 expansion. HTTP delivery itself may be larger. */
export const PLATFORM_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
import type { PlatformImage } from "./platform-contracts.ts";
export async function readPlatformImage(
  response: Response,
  signal?: AbortSignal,
): Promise<PlatformImage> {
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(Error("Image unavailable"), {
      status: response.status,
    });
  }
  if (response.headers.get("content-type")?.split(";")[0] !== "image/webp") {
    await response.body?.cancel();
    throw Error("Invalid image response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("Empty image response");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      signal?.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > PLATFORM_IMAGE_MAX_BYTES)
        throw Error("Image response too large");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  signal?.throwIfAborted();
  let raw = "";
  for (const chunk of chunks)
    for (let offset = 0; offset < chunk.length; offset += 8192)
      raw += String.fromCharCode(...chunk.subarray(offset, offset + 8192));
  return { mimeType: "image/webp", base64: btoa(raw) };
}
export function platformImageBlob(value: unknown): Blob {
  if (
    !value ||
    typeof value !== "object" ||
    !("mimeType" in value) ||
    value.mimeType !== "image/webp" ||
    !("base64" in value) ||
    typeof value.base64 !== "string" ||
    value.base64.length > Math.ceil(PLATFORM_IMAGE_MAX_BYTES / 3) * 4 ||
    !value.base64 ||
    value.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)
  )
    throw Error("Invalid platform image");
  const raw = atob(value.base64);
  if (raw.length > PLATFORM_IMAGE_MAX_BYTES)
    throw Error("Image response too large");
  return new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))], {
    type: "image/webp",
  });
}
export function imagePath(
  address: SupplementalAddress,
  fileId: string,
): string {
  if (address.pageId !== fileId) throw Error("Image belongs to another page");
  return supplementalAddress(address);
}

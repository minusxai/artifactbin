import type { CompiledWasmPayload } from "./wasm-contracts.ts";
/** Self-contained browser function: streaming limit applies before joining or instantiating bytes. */
export async function decodeCompiledWasm(
  payload: CompiledWasmPayload,
): Promise<Uint8Array<ArrayBuffer>> {
  const maxPacked = 1024 * 1024,
    maxUnpacked = 2 * 1024 * 1024;
  if (
    !payload ||
    payload.compression !== "gzip" ||
    typeof payload.base64 !== "string" ||
    payload.base64.length > Math.ceil(maxPacked / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      payload.base64,
    ) ||
    !/^[a-f0-9]{64}$/.test(payload.sha256) ||
    !Number.isSafeInteger(payload.uncompressedBytes) ||
    payload.uncompressedBytes < 8 ||
    payload.uncompressedBytes > maxUnpacked
  )
    throw Error("Invalid embedded engine payload");
  if (typeof DecompressionStream !== "function" || !globalThis.crypto?.subtle)
    throw Error("This browser cannot load the embedded engine");
  const packed = Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0));
  if (packed.byteLength > maxPacked)
    throw Error("Embedded engine exceeds packed limit");
  const reader = new Blob([packed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > payload.uncompressedBytes || length > maxUnpacked)
        throw Error("Embedded engine exceeds expanded limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (length !== payload.uncompressedBytes)
    throw Error("Embedded engine length mismatch");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== payload.sha256) throw Error("Embedded engine digest mismatch");
  return bytes;
}

import type { CompiledJavascriptPayload } from "./javascript-payload-contracts.ts";
/** Self-contained browser decoder. Keep all limits inside the emitted function. */
export async function decodeCompiledJavascript(
  payload: CompiledJavascriptPayload,
  signal?: AbortSignal,
): Promise<string> {
  const maxPacked = 3 * 1024 * 1024,
    maxUnpacked = 32 * 1024 * 1024;
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 4 ||
    Object.keys(payload).some(
      (key) =>
        !["compression", "base64", "sha256", "uncompressedBytes"].includes(key),
    ) ||
    payload.compression !== "gzip" ||
    typeof payload.base64 !== "string" ||
    payload.base64.length > Math.ceil(maxPacked / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      payload.base64,
    ) ||
    typeof payload.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.sha256) ||
    !Number.isSafeInteger(payload.uncompressedBytes) ||
    payload.uncompressedBytes < 1 ||
    payload.uncompressedBytes > maxUnpacked
  )
    throw Error("Invalid compiled module payload");
  const check = () => {
    if (signal?.aborted) throw Error("Compiled module load cancelled");
  };
  check();
  if (typeof DecompressionStream !== "function" || !globalThis.crypto?.subtle)
    throw Error("This browser cannot load the compiled module");
  const packed = Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0));
  if (packed.byteLength > maxPacked)
    throw Error("Compiled module exceeds packed limit");
  // Generated payloads contain one member. Its final ISIZE must describe the
  // entire verified module, rejecting appended empty/trailing gzip members.
  if (
    packed.byteLength < 18 ||
    new DataView(packed.buffer, packed.byteOffset, packed.byteLength).getUint32(
      packed.byteLength - 4,
      true,
    ) !== payload.uncompressedBytes
  )
    throw Error("Compiled module gzip length mismatch");
  const reader = new Blob([packed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    check();
    while (true) {
      const { value, done } = await reader.read();
      check();
      if (done) break;
      length += value.byteLength;
      if (length > payload.uncompressedBytes || length > maxUnpacked)
        throw Error("Compiled module exceeds expanded limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  if (length !== payload.uncompressedBytes)
    throw Error("Compiled module length mismatch");
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
  check();
  if (digest !== payload.sha256) throw Error("Compiled module digest mismatch");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

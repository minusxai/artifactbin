/** Trusted offline compiler transport; no network resources or executable source. */
export interface CompiledWasmPayload {
  compression: "gzip";
  base64: string;
  sha256: string;
  uncompressedBytes: number;
}
export const MAX_PACKED_WASM_BYTES = 1024 * 1024;
export const MAX_UNPACKED_WASM_BYTES = 2 * 1024 * 1024;

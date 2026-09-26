/**
 * THE OFFLINE FILE'S SQLITE ENGINE: the same official wasm the server and the
 * reader's page run, carried INSIDE the offline bundle (scripts/build-offline
 * defines `__AFBIN_SQLITE_WASM__` as its base64) — a file:// page can fetch
 * nothing, so the bytes are handed to the core directly
 * (lib/story-runtime/page-sqlite). Undefined outside that bundle (the app, a
 * test), where a file then runs nothing itself and answers from its snapshot.
 */
declare const __AFBIN_SQLITE_WASM__: string | undefined;

let decoded: Uint8Array | undefined;

export function offlineSqliteWasm(): Uint8Array | undefined {
  if (decoded || typeof __AFBIN_SQLITE_WASM__ !== 'string') return decoded;
  const raw = atob(__AFBIN_SQLITE_WASM__);
  decoded = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) decoded[i] = raw.charCodeAt(i);
  return decoded;
}

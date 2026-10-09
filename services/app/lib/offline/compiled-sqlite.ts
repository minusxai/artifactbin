/** Embedded SQLite for held imports. The file never asks a URL for wasm or data. */
import type { PageEngine } from '@/lib/story-runtime/page-engine';
import type { ImportTables } from '@/lib/dataflow/compiled-flow';
import { pageEngine } from '@/lib/islands/sqlite-engine';

/** The page's own engine (the online one), over the wasm this file carries in `#afbin-wasm`, decoded once. */
export function offlinePageEngine(hold: (name: string) => Promise<ImportTables[string]>): PageEngine {
  return pageEngine(() => decodeEmbeddedWasm(document), hold);
}

/** The wasm a file carries base64 in `#afbin-wasm`: gzipped, or raw in a file saved before that. */
export async function decodeEmbeddedWasm(doc: { getElementById(id: string): { textContent: string | null } | null }): Promise<Uint8Array> {
  const encoded = doc.getElementById('afbin-wasm')?.textContent?.trim();
  if (!encoded) throw new Error('offline: the SQLite engine is unavailable');
  const raw = atob(encoded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  return new Uint8Array(await new Response(new Response(bytes as Uint8Array<ArrayBuffer>).body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

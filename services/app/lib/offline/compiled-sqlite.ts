/** Embedded SQLite for held imports. The file never asks a URL for wasm or data. */
import { createPageEngine, type PageEngine } from '@/lib/story-runtime/page-engine';
import { sqliteFrom } from '@/lib/story-runtime/page-sqlite';
import type { ImportTables } from '@/lib/story/compiled-flow';

export function offlinePageEngine(hold: (name: string) => Promise<ImportTables[string]>): PageEngine {
  const encoded = document.getElementById('afbin-wasm')?.textContent?.trim();
  if (!encoded) throw new Error('offline: the SQLite engine is unavailable');
  const raw = atob(encoded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return createPageEngine({ load: () => wasmBytes(bytes).then((wasm) => sqliteFrom(wasm)()), fetch: hold });
}

/** A file carries its wasm gzipped (a file saved before that carries it raw): either way, the wasm. */
async function wasmBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  return new Uint8Array(await new Response(new Response(bytes as Uint8Array<ArrayBuffer>).body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

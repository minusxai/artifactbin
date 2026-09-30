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
  return createPageEngine({ load: sqliteFrom(bytes), fetch: hold });
}

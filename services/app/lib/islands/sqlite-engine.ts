/**
 * THE PAGE'S OWN SQLITE ENGINE, for a compiled page (docs/phase2-architecture.md §2.3): the page
 * engine (lib/story-runtime/page-engine — the SQLite core over the imports this reader holds, the
 * dataflow evaluator, the optimistic overlay) over the wasm loader (lib/story-runtime/page-sqlite
 * `sqliteFrom`), unchanged.
 *
 * Bundled ALONE by the island build (scripts/build/build-islands.mjs STANDALONE_LAZY): framework-free, its
 * shared code and the SQLite core copied in, loaded by boot only when the page may hold something
 * (IslandPageData `hold` and `sqliteWasm`), behind the first paint. The shared runtime's closure never
 * carries it.
 */
import { createPageEngine, type PageEngine, type PageEngineSource } from '@/lib/story-runtime/page-engine';
import { sqliteFrom, type WasmSource } from '@/lib/story-runtime/page-sqlite';

/**
 * The engine over `wasm` — a URL (fetched once, credential-free) or the bytes the page already has
 * (the offline file's embedded copy, read once) — holding each dataset through `hold` (the transport's
 * scoped POST, or the offline file's snapshot).
 */
export function pageEngine(wasm: WasmSource, hold: PageEngineSource['fetch']): PageEngine {
  return createPageEngine({ load: sqliteFrom(wasm), fetch: hold });
}

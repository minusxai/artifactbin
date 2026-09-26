/**
 * WHERE THE PAGE'S ENGINE COMES FROM. The SQLite core is a LAZY chunk — the
 * one exception to top-level imports here, and deliberate: a document that
 * runs nothing in the page (prose, a chart over a dataset the reader may not
 * hold) never downloads it (lib/__tests__/reader-bundle-hygiene pins this).
 * Its wasm is fetched once from this origin at a content-addressed URL the
 * runtime build records (StoryIslandData.sqliteWasm), cached `immutable`; the
 * offline file hands its embedded bytes in instead.
 *
 * `pageEngineFor` decides, once per document lifetime, whether the page runs
 * anything itself: only when the island says what this reader may hold AND the
 * transport can fetch it. Otherwise the store keeps sending everything to the
 * server, exactly as before.
 */
import type { SqliteEngine } from '@artifactbin/sql/core';
import type { StoryIslandData } from './contract';
import { createPageEngine, type PageEngine } from './page-engine';
import type { QueryTransport } from './store';

type Core = Pick<SqliteEngine, 'run' | 'mutate'>;

/** The core over wasm bytes: fetched from `wasm` (a URL) once, or given. */
export function sqliteFrom(wasm: string | Uint8Array): () => Promise<Core> {
  let loading: Promise<Core> | null = null;
  const bytes = async (): Promise<Uint8Array | ArrayBuffer> => {
    if (typeof wasm !== 'string') return wasm;
    const response = await fetch(wasm, { credentials: 'omit' });
    if (!response.ok) throw new Error(`the SQLite engine did not load (${response.status})`);
    return response.arrayBuffer();
  };
  return () => (loading ??= Promise.all([import('@artifactbin/sql/core'), bytes()])
    .then(([core, wasmBytes]) => core.loadSqlite(wasmBytes)));
}

/**
 * The page's own engine for this document, or null when everything runs on
 * the server. `userId` is `$_me.id` as the DOOR the page queries through binds
 * it — the page must answer exactly what that door would: the session's reader
 * for the app page and the offline file, nobody for the credential-free
 * document served at /raw, whatever its island says about who is looking.
 */
export function pageEngineFor(
  island: Pick<StoryIslandData, 'dataflow' | 'sqliteWasm'>,
  transport: QueryTransport | null | undefined,
  userId: string | null,
  wasm: string | Uint8Array | undefined = island.sqliteWasm,
): { engine: PageEngine; userId: string | null } | null {
  const hold = transport?.hold;
  if (!wasm || !island.dataflow?.hold || !hold) return null;
  return { engine: createPageEngine({ load: sqliteFrom(wasm), fetch: (name) => hold.call(transport, name) }), userId };
}

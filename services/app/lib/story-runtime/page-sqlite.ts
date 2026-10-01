/**
 * WHERE THE PAGE'S ENGINE COMES FROM. The SQLite core is a LAZY chunk — the
 * one exception to top-level imports here, and deliberate: a document that
 * runs nothing in the page (prose, a chart over a dataset the reader may not
 * hold) never downloads it (lib/__tests__/reader-bundle-hygiene pins this).
 * Its wasm is fetched once from this origin at a content-addressed URL the
 * island build records (StoryIslandData.sqliteWasm), cached `immutable`; the
 * offline file hands its embedded bytes in instead.
 */
import type { PageCore } from './page-engine';

/** The core over wasm bytes: fetched from `wasm` (a URL) once, or given. */
export function sqliteFrom(wasm: string | Uint8Array): () => Promise<PageCore> {
  let loading: Promise<PageCore> | null = null;
  const bytes = async (): Promise<Uint8Array | ArrayBuffer> => {
    if (typeof wasm !== 'string') return wasm;
    const response = await fetch(wasm, { credentials: 'omit' });
    if (!response.ok) throw new Error(`the SQLite engine did not load (${response.status})`);
    return response.arrayBuffer();
  };
  return () => (loading ??= Promise.all([import('@artifactbin/sql/core'), bytes()])
    .then(([core, wasmBytes]) => core.loadSqlite(wasmBytes)));
}

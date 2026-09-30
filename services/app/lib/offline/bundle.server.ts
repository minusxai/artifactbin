/**
 * The offline bundle a downloaded file carries in `#afbin-code`, read from what
 * scripts/build-offline.mjs wrote under lib/build-assets/offline/, shipped
 * with the server.
 *
 * gzip then base64, exactly as the file stores it. Read, checked against the
 * build's manifest and encoded ONCE per process per kind: every download of a
 * process serves the same bytes, and a missing or damaged build fails the
 * first download loudly instead of shipping a file that cannot open.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { retainedIslandFile } from '@/lib/compiled-page/shared-builds.server';
import { loadOfflineHalf, packCompiledBrowserModule } from './compiled-bundle.server';
import type { ArtifactFile } from './file-format';
import type { ArtifactFileParts } from './file-html';
import type { JsxNode } from '@/lib/jsx';

export type OfflineBundleKind = 'solid';

interface OfflineBundleManifest {
  bundles: Record<OfflineBundleKind, { file: string; sha256: string; raw: number; gzip: number }>;
  /** Code view's source editor and prettier, which the file loads on demand (lib/offline/extras). */
  extras?: { file: string; path: string; integrity: string; sha256: string };
}

const dir = () => path.join(process.cwd(), 'lib', 'build-assets', 'offline');
const loaded = new Map<OfflineBundleKind, Promise<string>>();

const readManifest = async () => JSON.parse(await readFile(path.join(dir(), 'manifest.json'), 'utf8')) as OfflineBundleManifest;

async function load(kind: OfflineBundleKind): Promise<string> {
  const manifest = await readManifest();
  const entry = manifest.bundles?.[kind];
  if (!entry) throw new Error(`offline bundle: the build names no ${kind} bundle (run npm run build)`);
  const gz = await readFile(path.join(dir(), entry.file));
  const code = gunzipSync(gz);
  if (createHash('sha256').update(code).digest('hex') !== entry.sha256) throw new Error(`offline bundle: ${entry.file} does not match its manifest`);
  return gz.toString('base64');
}

/** The `kind` offline bundle, gzip-compressed then base64-encoded. */
export function offlineBundle(kind: OfflineBundleKind): Promise<string> {
  let bundle = loaded.get(kind);
  if (!bundle) {
    bundle = load(kind);
    loaded.set(kind, bundle);
    // A failed read is not cached: the next download tries again (a build may have landed since).
    bundle.catch(() => { if (loaded.get(kind) === bundle) loaded.delete(kind); });
  }
  return bundle;
}

const PACKED_KEPT = 32;
const packedMemo = new Map<string, Promise<{ compiledCode: string; templates: Record<string, string> } | null>>();

/**
 * A compiled module packed for file:// and gzipped, remembered per process: it is a pure function of
 * the stored module (content-addressed), the build's offline half, the pinned manifest an older module
 * names its chunks by, and the two engine flags, so every later download of the same version skips the
 * transform and the level-9 compression.
 */
async function packedModule(page: NonNullable<ArtifactFile['compiled']>, sqlite: boolean, chart: boolean) {
  const half = await loadOfflineHalf();
  const key = JSON.stringify([page.module?.sha ?? null, page.sharedBuild?.manifest ?? null, half.entries, sqlite, chart]);
  let made = packedMemo.get(key);
  if (!made) {
    made = packCompiledBrowserModule(page, { half, offline: { sqlite, chart } })
      .then((packed) => packed && { compiledCode: gzipSync(packed.code, { level: 9 }).toString('base64'), templates: packed.templates });
    packedMemo.set(key, made);
    if (packedMemo.size > PACKED_KEPT) packedMemo.delete(packedMemo.keys().next().value!);
    made.catch(() => { if (packedMemo.get(key) === made) packedMemo.delete(key); });
  }
  return made;
}

/** The exact inline resources a newly downloaded Solid file needs. */
export async function offlineFileParts(file: ArtifactFile): Promise<ArtifactFileParts> {
  if (file.bundle !== 'solid') throw new Error('offline: a legacy file must be migrated before export');
  const code = await offlineBundle('solid');
  if (!file.compiled) return { file, code };
  const sqlite = !!file.island.dataflow?.hold?.length;
  // A compiled Question can be a table; those have no Vega drawing to update.
  const hasChart = (nodes: JsxNode[]): boolean => nodes.some((node) => node.type === 'element' && (
    (node.tag === 'Question' && node.attributes.some((attribute) => attribute.name === 'viz'
      && attribute.value.static && typeof attribute.value.json === 'object' && attribute.value.json !== null
      && 'kind' in attribute.value.json && attribute.value.json.kind === 'vega-lite')) || hasChart(node.children)
  ));
  const chart = file.compiled.kit.islands.includes('Question') && hasChart(file.island.nodes);
  const packed = await packedModule(file.compiled, sqlite, chart);
  const wasmUrl = file.compiled.sharedBuild?.sqliteWasm;
  const wasmName = /^\/islands\/(sqlite3-[0-9a-f]{16}\.wasm)$/.exec(wasmUrl ?? '')?.[1];
  if (sqlite && !wasmName) throw new Error('offline: the compiled build has no SQLite engine');
  const wasm = wasmName && sqlite ? (await readFile(path.join(process.cwd(), 'public', 'islands', wasmName)).catch(() => retainedIslandFile(wasmName)))?.toString('base64') : undefined;
  return { file, code, ...(packed ? { compiledCode: packed.compiledCode, templates: packed.templates } : {}),
    ...(wasm ? { wasm } : {}) };
}

/** A read that is not cached when it fails: the next download tries again (a build may have landed since). */
function once<T>(make: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | null = null;
  return () => {
    if (value) return value;
    const next = make();
    value = next;
    next.catch(() => { if (value === next) value = null; });
    return next;
  };
}

const EXTRAS_NAME = /^extras-[0-9a-f]{16}\.js$/;

const extras = once(async () => {
  const entry = (await readManifest()).extras;
  if (!entry || !EXTRAS_NAME.test(entry.file)) throw new Error('offline bundle: the build names no extras (run npm run build)');
  const code = await readFile(path.join(dir(), entry.file));
  if (createHash('sha256').update(code).digest('hex') !== entry.sha256) throw new Error(`offline bundle: ${entry.file} does not match its manifest`);
  // The build's brotli/gzip siblings (scripts/build-offline), each kept only if it decodes to exactly these bytes.
  const sibling = async (suffix: '.br' | '.gz', decode: (bytes: Buffer) => Buffer) => {
    const bytes = await readFile(path.join(dir(), entry.file + suffix)).catch(() => null);
    try { return bytes && decode(bytes).equals(code) ? bytes : undefined; } catch { return undefined; }
  };
  const [br, gzip] = await Promise.all([sibling('.br', brotliDecompressSync), sibling('.gz', gunzipSync)]);
  return { ref: { path: entry.path, integrity: entry.integrity }, file: entry.file, code, encoded: { ...(br ? { br } : {}), ...(gzip ? { gzip } : {}) } };
});

/** What a downloaded file records to load its extras: their address on this server and their SRI hash. */
export async function offlineExtrasRef(): Promise<{ path: string; integrity: string }> {
  return (await extras()).ref;
}

/**
 * The bytes behind `GET /offline/<name>` — the current build's extras, and
 * nothing else (an older hash is not kept: see scripts/build-offline.mjs).
 * Null for any other name.
 */
export async function offlineExtrasAsset(name: string): Promise<Buffer | null> {
  if (!EXTRAS_NAME.test(name)) return null;
  const current = await extras().catch(() => null);
  return current && current.file === name ? current.code : null;
}

/** The build-time brotli/gzip encodings of `GET /offline/<name>`, verified against its bytes; empty when there are none. */
export async function offlineExtrasEncoded(name: string): Promise<{ br?: Buffer; gzip?: Buffer }> {
  if (!EXTRAS_NAME.test(name)) return {};
  const current = await extras().catch(() => null);
  return current && current.file === name ? current.encoded : {};
}

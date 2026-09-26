/**
 * The offline bundle a downloaded file carries in `#afbin-code`, read from what
 * scripts/build-offline.mjs wrote beside the SSR bundle
 * (lib/story-runtime/dist/offline/, shipped with the server) and located the
 * way lib/story/ssr.server finds its bundle.
 *
 * gzip then base64, exactly as the file stores it. Read, checked against the
 * build's manifest and encoded ONCE per process per kind: every download of a
 * process serves the same bytes, and a missing or damaged build fails the
 * first download loudly instead of shipping a file that cannot open.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export type OfflineBundleKind = 'core' | 'mermaid';

interface OfflineBundleManifest {
  bundles: Record<OfflineBundleKind, { file: string; sha256: string; raw: number; gzip: number }>;
  /** Code view's source editor and prettier, which the file loads on demand (lib/offline/extras). */
  extras?: { file: string; path: string; integrity: string; sha256: string };
}

const dir = () => path.join(process.cwd(), 'lib', 'story-runtime', 'dist', 'offline');
const loaded = new Map<OfflineBundleKind, Promise<string>>();

const readManifest = async () => JSON.parse(await readFile(path.join(dir(), 'manifest.json'), 'utf8')) as OfflineBundleManifest;

async function load(kind: OfflineBundleKind): Promise<string> {
  const manifest = await readManifest();
  const entry = manifest.bundles?.[kind];
  if (!entry) throw new Error(`offline bundle: the build names no ${kind} bundle (run npm run build:runtime)`);
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
  if (!entry || !EXTRAS_NAME.test(entry.file)) throw new Error('offline bundle: the build names no extras (run npm run build:runtime)');
  const code = await readFile(path.join(dir(), entry.file));
  if (createHash('sha256').update(code).digest('hex') !== entry.sha256) throw new Error(`offline bundle: ${entry.file} does not match its manifest`);
  return { ref: { path: entry.path, integrity: entry.integrity }, file: entry.file, code };
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

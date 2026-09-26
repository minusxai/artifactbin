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
}

const dir = () => path.join(process.cwd(), 'lib', 'story-runtime', 'dist', 'offline');
const loaded = new Map<OfflineBundleKind, Promise<string>>();

async function load(kind: OfflineBundleKind): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(dir(), 'manifest.json'), 'utf8')) as OfflineBundleManifest;
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

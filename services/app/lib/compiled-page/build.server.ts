/**
 * THE SERVER'S VIEW OF THE SHARED ISLAND BUILD (contract CompilerBuild; spec §3, §6).
 *
 * `scripts/build-islands.mjs` writes `public/islands/manifest.json` once per
 * deploy: `{ build, manifest, files }`, where `build` is the compiler build id
 * a stored compile is keyed by and `manifest` maps each import specifier
 * (`solid-js/web`, `@mx/rt`, `@mx/kit/tabs`) to its content-addressed chunk
 * URL. This reads it — once per process in production, where the file cannot
 * change under a running server, and on every call in development, where the
 * build is rerun at will (as prepared-page's `buildId` does). A development
 * read whose text is unchanged hands back the same object, so a caller can
 * still compare builds by identity.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IS_DEV } from '@/lib/config';
import type { CompilerBuild } from './contract';

/** Relative to the app's cwd (services/app — the cwd contract every runner keeps). */
export const ISLANDS_MANIFEST_PATH = 'public/islands/manifest.json';

/** A file of the shared build (`rt-<hash>.js`, `manifest.json`) on this server's disk. */
export const islandFile = (name: string, root = process.cwd()): string => path.resolve(root, path.dirname(ISLANDS_MANIFEST_PATH), name);

const BUILD_ID_RE = /^[0-9a-f]{16}$/;
/** The server half is ONE same-origin file directly under /islands/; the server evaluates it, so nothing else is accepted. */
const SSR_URL_RE = /^\/islands\/[\w-]+\.js$/;

let cached: { text: string; build: CompilerBuild } | null = null;

/** Validate the manifest the build wrote; a malformed one is an error, never a build a compile could key on. */
export function parseCompilerBuild(text: string, file: string): CompilerBuild {
  const raw = JSON.parse(text) as { files?: Record<string, { imports?: string[] }>; build?: unknown; manifest?: unknown; sqliteWasm?: unknown; ssr?: { url?: unknown; exports?: unknown } };
  if (typeof raw.build !== 'string' || !BUILD_ID_RE.test(raw.build)) throw new Error(`island build: ${file} has no 16-hex build id`);
  if (!raw.manifest || typeof raw.manifest !== 'object' || Array.isArray(raw.manifest)) throw new Error(`island build: ${file} has no manifest`);
  const manifest: Record<string, string> = {};
  for (const [specifier, url] of Object.entries(raw.manifest)) {
    // Every chunk is a same-origin file under /islands/: the page imports it under `script-src 'self'`.
    if (typeof url !== 'string' || !url.startsWith('/islands/')) throw new Error(`island build: ${file} maps ${specifier} outside /islands/`);
    manifest[specifier] = url;
  }
  if (raw.sqliteWasm !== undefined && (typeof raw.sqliteWasm !== 'string' || !/^\/islands\/sqlite3-[0-9a-f]{16}\.wasm$/.test(raw.sqliteWasm))) throw new Error(`island build: ${file} has an invalid SQLite wasm URL`);
  const ssr = raw.ssr;
  if (ssr !== undefined && (typeof ssr.url !== 'string' || !SSR_URL_RE.test(ssr.url) || !ssr.exports || typeof ssr.exports !== 'object' || Array.isArray(ssr.exports))) throw new Error(`island build: ${file} has an invalid server half`);
  const graph = Object.fromEntries(Object.entries(raw.files ?? {}).map(([url, file]) => [url, file.imports ?? []]));
  return Object.freeze({ id: raw.build, manifest: Object.freeze(manifest), graph: Object.freeze(graph), ...(raw.sqliteWasm ? { sqliteWasm: raw.sqliteWasm } : {}),
    ...(ssr ? { ssr: { url: ssr.url as string, exports: ssr.exports as Record<string, string> } } : {}) });
}

/** The shared island build this server serves with. Throws when the build has not been run (`node scripts/build-islands.mjs`). */
export function loadCompilerBuild(): CompilerBuild {
  if (cached && !IS_DEV) return cached.build;
  const text = readFileSync(islandFile('manifest.json'), 'utf8');
  if (cached?.text === text) return cached.build;
  cached = { text, build: parseCompilerBuild(text, ISLANDS_MANIFEST_PATH) };
  return cached.build;
}

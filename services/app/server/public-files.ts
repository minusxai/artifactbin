/**
 * PUBLIC FILES — every public, credential-free file the app serves, under one prefix, `/af/`, with one
 * cross-origin rule and one cache class per directory (the URL map, `@artifactbin/contracts` url-space):
 *
 *   /af/app/        the app's own Vite build (dist/web/af/app)            immutable
 *   /af/components/ af-* elements (routes: lib/document-serving)          entries no-cache, chunks immutable
 *   /af/fonts/      fonts by name (route) and by hashed file (public/fonts) immutable
 *   /af/lib/        hosted libraries (public/libraries)                   a day, stale for a week
 *   /af/geojson/    boundary files (public/geojson)                       a day
 *   /af/img/        logos, design-system previews (public/img)            a day
 *   /af/v1/         pinned content-addressed runtime copies (routes)      immutable
 *   /af/<name>      runtime modules, styles.css, import-map.json, manifest.json, host.js, url-space.json (routes)
 *
 * Every `/af/` answer carries `Access-Control-Allow-Origin: *` (an opaque-origin document, a raw frame, a portable
 * copy and a host page all load these cross-origin), and no `/af/` handler reads a credential
 * (server/__tests__/url-space.test.ts). Beside them, two root files by convention: `/favicon.ico`, `/og.png`.
 * `/assets/` is NOT here: it is stored user content with its own sandboxed policy (app/assets, APP__ASSETS_ORIGIN).
 *
 * OLD ADDRESSES (`/libraries/`, `/geojson/`, `/fonts/`, and the short links `/people/`, `/email/`,
 * `/workspace/`) answer through `publicFilePath`: the router sees the new address, so the answer is the same
 * handler's, byte for byte. The table and its reasons are contracts' legacy-public-paths.ts, the one place
 * old addresses are kept.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { getPath } from 'hono/utils/url';
import { CACHE_CONTROL, PUBLIC_FILES_PREFIX, canonicalPublicPath, publicFileClass } from '@artifactbin/contracts';
import { precompressedStatic } from './content-encoding';

/** Hono's request path, with an old address replaced by the one that owns it now (the legacy table). */
export const publicFilePath = (request: Request): string => canonicalPublicPath(getPath(request));

const IMMUTABLE = CACHE_CONTROL.immutable;

/** The `/af/` directories served from disk: URL prefix → directory under `publicDir`. */
const DIRECTORIES: ReadonlyArray<readonly [prefix: string, directory: string]> = [
  ['/af/fonts/', '/fonts/'],
  ['/af/lib/', '/libraries/'],
  ['/af/geojson/', '/geojson/'],
  ['/af/img/', '/img/'],
];

export interface PublicFileOptions {
  /** The built SPA (dist/web); its `af/app/` tree is served when it exists (development has none: Vite answers). */
  webDir: string;
  /** The static tree (public/): fonts, libraries, geojson, img and the two root files. */
  publicDir: string;
}

/** Mounts every public file. Call before the route table, so a directory miss falls through to its route (`/af/fonts/<name>`). */
export function mountPublicFiles(app: Hono, { webDir, publicDir }: PublicFileOptions): void {
  // One cross-origin rule for the whole prefix; the cache rule for the directories served from disk.
  app.use(`${PUBLIC_FILES_PREFIX}*`, async (c, next) => {
    await next();
    if (c.res.status >= 400) return;
    c.header('access-control-allow-origin', '*');
    const cls = publicFileClass(c.req.path);
    if (cls?.staticDirectory) c.header('cache-control', CACHE_CONTROL[cls.cache]);
  });
  // Stored bytes keep their own rule (immutable content addresses); signed exports own their private policy.
  app.use('/assets/*', async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/assets/export/')) c.header('cache-control', IMMUTABLE);
  });
  const quiet = { onFound: () => {}, onNotFound: () => {} };
  const publicRoot = path.relative(process.cwd(), publicDir) || '.';
  // In development Vite owns the app's modules and dist/web does not exist yet; production builds it first.
  if (existsSync(webDir)) app.use('/af/app/*', precompressedStatic({ root: path.relative(process.cwd(), webDir) || '.', ...quiet }));
  for (const [prefix, directory] of DIRECTORIES) {
    app.use(`${prefix}*`, precompressedStatic({ root: publicRoot, rewriteRequestPath: (p) => directory + p.slice(prefix.length), ...quiet }));
  }
  for (const file of ['/favicon.ico', '/og.png']) app.use(file, precompressedStatic({ root: publicRoot, ...quiet }));
}

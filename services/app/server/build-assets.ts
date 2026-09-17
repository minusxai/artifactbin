import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import type { Manifest } from 'vite';
import { serveStatic } from '@hono/node-server/serve-static';
import { BUILD_ASSET_HEADER, BUILD_ASSET_PATH } from '@artifactbin/contracts';
import { isBuildAssetPath } from '@artifactbin/utils';

/** The deployment-owned manifest is read once. Missing/malformed builds opt out. */
function allowedFiles(webDir: string): Set<string> {
  try {
    const manifest: Manifest = JSON.parse(readFileSync(path.join(webDir, '.vite/manifest.json'), 'utf8'));
    const files = Object.values(manifest).flatMap(chunk => [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]);
    return new Set(files.filter(file => typeof file === 'string' && isBuildAssetPath('/' + file)).map(file => '/' + file));
  } catch { return new Set(); }
}

/** App-owned manifest admission and bytes; never fall through to content routes. */
export function mountBuildAssets(app: Hono, webDir: string): void {
  const files = allowedFiles(webDir);
  if (!files.size) return;
  const staticFile = serveStatic({
    root: path.relative(process.cwd(), webDir) || '.',
    rewriteRequestPath: p => p.slice(BUILD_ASSET_PATH.length),
  });
  app.all(BUILD_ASSET_PATH + '/*', async c => {
    const url = new URL(c.req.url);
    if (!['GET', 'HEAD'].includes(c.req.method) || url.search || !files.has(url.pathname.slice(BUILD_ASSET_PATH.length))) return c.notFound();
    const response = await staticFile(c, async () => { c.res = await c.notFound(); });
    if (response && [200, 206].includes(response.status)) {
      response.headers.set(BUILD_ASSET_HEADER, '1');
      response.headers.set('cache-control', 'public, max-age=31536000, immutable');
      response.headers.set('x-content-type-options', 'nosniff');
    }
    return response ?? c.res;
  });
}

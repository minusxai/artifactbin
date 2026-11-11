/**
 * THE APP SHELL'S EAGER SCRIPTS for a document view: the app entry and the document page's chunk, each with every chunk
 * it imports statically, as the build's own manifest (services/app/dist/web/.vite/manifest.json) names them. These are
 * the scripts every view downloads before the app can adopt the framed document; a chunk imported dynamically (the
 * frame bridge, comment UI) is not one, whenever it happens to finish.
 *
 * Size target 4 sums the real wire bytes of exactly these scripts (scripts/lib/document-views.mjs), so it no longer
 * depends on whether lazily loaded chunks win the race against the frame's ready mark: an unthrottled size pass and a
 * throttled timing pass count the same set.
 *
 * `shellWireBytes` counts those bytes from a build alone, as the lab counts them, so pr fast judges target 4 on every
 * pull request without a browser (scripts/__tests__/shell-size.test.mjs).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { scriptBudgetBytes } from './document-views.mjs';

/** The view route's page module, as the manifest keys it (relative to the app's Vite root). */
const VIEW_PAGE_MODULE = 'solid/pages/Document.tsx';

/**
 * @param {Record<string, {file: string, isEntry?: boolean, imports?: string[]}>} manifest
 * @param {string} pageModule
 * @returns {Set<string>} served paths (`/af/app/…js`)
 */
export function shellScripts(manifest, pageModule = VIEW_PAGE_MODULE) {
  const page = Object.keys(manifest).find(key => key.replaceAll('\\', '/').endsWith(pageModule));
  if (!page) throw new Error(`The build manifest has no chunk for ${pageModule}`);
  const roots = [...Object.keys(manifest).filter(key => manifest[key].isEntry), page];
  const seen = new Set();
  for (const key of roots) {
    const stack = [key];
    while (stack.length) {
      const at = stack.pop();
      if (seen.has(at) || !manifest[at]) continue;
      seen.add(at);
      stack.push(...(manifest[at].imports ?? []));
    }
  }
  return new Set([...seen].map(key => '/' + manifest[key].file).filter(file => /\.m?js$/.test(file)));
}

/** The eager set of the build in `checkout` (a built repository root). */
export function shellScriptsOf(checkout) {
  return shellScripts(JSON.parse(readFileSync(path.join(checkout, 'services/app/dist/web/.vite/manifest.json'), 'utf8')));
}

/**
 * The lab's gateway (scripts/ci/performance-loads.mjs) gzips a script the server sends uncompressed (one the build
 * left without a sibling: under services/app/scripts/precompress.mjs's 256 bytes) through `createGzip` over chunked
 * HTTP/1.1, so its wire bytes are the gzip and the chunk framing around it: 16 bytes, two chunks (run 43055730990:
 * runtime-id 211 + 16 = 227, sign-in-required 151 + 16 = 167).
 */
export const GATEWAY_CHUNK_FRAMING = 16;

/**
 * The app shell's JS before the document frame is ready, in a build's own bytes (size target 4's metric): each eager
 * script's brotli sibling, which the server sends a browser (server/content-encoding), or the gateway's gzip of one
 * without; plus the entry page's inline scripts at their standalone gzip, as scripts/lib/document-views.mjs attributes them.
 * @param {string} webDir a built `services/app/dist/web`
 * @returns {{ scripts: Array<{ file: string, bytes: number }>, inline: number, gzip: number }}
 */
export function shellWireBytes(webDir) {
  const manifest = JSON.parse(readFileSync(path.join(webDir, '.vite/manifest.json'), 'utf8'));
  const scripts = [...shellScripts(manifest)].map((file) => {
    const source = path.join(webDir, file);
    const bytes = existsSync(`${source}.br`) ? statSync(`${source}.br`).size : gzipSync(readFileSync(source)).length + GATEWAY_CHUNK_FRAMING;
    return { file, bytes };
  });
  const html = readFileSync(path.join(webDir, 'solid-app.html'), 'utf8');
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes) && !/\btype\s*=\s*["']?(?!module\b|(?:text|application)\/(?:java|ecma)script\b)/i.test(attributes))
    .map(([, , body]) => body);
  const total = scriptBudgetBytes({ decoded: 0, gzip: scripts.reduce((sum, script) => sum + script.bytes, 0) }, inline);
  return { scripts, inline: total.inline.gzip, gzip: total.gzip };
}

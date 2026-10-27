/**
 * THE APP SHELL'S EAGER SCRIPTS for a document view: the app entry and the document page's chunk, each with every chunk
 * it imports statically, as the build's own manifest (services/app/dist/web/.vite/manifest.json) names them. These are
 * the scripts every view downloads before the app can adopt the framed document; a chunk imported dynamically (the
 * frame bridge, comment UI) is not one, whenever it happens to finish.
 *
 * Size target 4 sums the real wire bytes of exactly these scripts (scripts/lib/document-views.mjs), so it no longer
 * depends on whether lazily loaded chunks win the race against the frame's ready mark: an unthrottled size pass and a
 * throttled timing pass count the same set.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The view route's page module, as the manifest keys it (relative to the app's Vite root). */
const VIEW_PAGE_MODULE = 'solid/pages/Document.tsx';

/**
 * @param {Record<string, {file: string, isEntry?: boolean, imports?: string[]}>} manifest
 * @param {string} pageModule
 * @returns {Set<string>} served paths (`/assets/…js`)
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

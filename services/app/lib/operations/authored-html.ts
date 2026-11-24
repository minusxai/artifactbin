/**
 * THE AUTHOR'S HTML, BEFORE THE PUBLISH PIPELINE READS IT: an exported copy (a download, the skill's
 * `export.mjs --format html`) is reduced to the source its envelope carries (lib/html-runtime portable-source
 * verifiedPortableSource), so the rows its reader could read, the engine that queried them and the runtime are never
 * linked, bundled, validated or stored as a page. One that no longer verifies is refused, never stored stripped.
 * Ordinary HTML passes as it is.
 *
 * Here, above lib/publish, because lib/html-runtime sits above lib/publish in the module graph. The guarantee does not
 * rest on every caller passing through here: canonicalizeHtmlPage (lib/html-page) refuses an export's rows and engine
 * in any source the store writes.
 */
import { PortableSourceUnverified, verifiedPortableSource } from '@/lib/html-runtime/portable-source';
import type { ParsedHtml } from '@/lib/html-page/html-source';
import { Reply, reply } from '@/lib/http';

export function authoredHtml(body: Record<string, unknown>): {body: Record<string, unknown>; page?: ParsedHtml} | Reply {
  if (typeof body.html !== 'string') return {body};
  try {
    const {source:html,parsed:page} = verifiedPortableSource(body.html);
    return {body:html===body.html?body:{...body,html},page};
  } catch (error) {
    if (error instanceof PortableSourceUnverified) return reply({ error: 'portable_copy_unverified', details: [error.message] }, 400);
    throw error;
  }
}

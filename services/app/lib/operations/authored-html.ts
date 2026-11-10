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
import { json } from '@/lib/http';

export function authoredHtml<T extends Record<string, unknown>>(body: T): T | Response {
  if (typeof body.html !== 'string') return body;
  try {
    const html = verifiedPortableSource(body.html);
    return html === body.html ? body : { ...body, html };
  } catch (error) {
    if (error instanceof PortableSourceUnverified) return json({ error: 'portable_copy_unverified', details: [error.message] }, 400);
    throw error;
  }
}

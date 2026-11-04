/**
 * A region link's target, on its own so the page's link dialog (solid/document/RegionToolbar) refuses exactly what the
 * editor, the merge core and the server refuse without carrying the editor (Yjs, ProseMirror) into its chunk.
 *
 * The link targets a region may hold: http, https, mailto and relative URLs. Browsers drop ASCII tab and newline
 * anywhere in a URL and C0 controls and spaces at its ends, so `java\tscript:` is a script URL; they are removed
 * before the scheme is read. Returns the cleaned href, or null when the link must not exist.
 */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
  if (!cleaned) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(cleaned)) return null;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(cleaned);
  if (scheme) return ['http', 'https', 'mailto'].includes(scheme[1]!.toLowerCase()) ? cleaned : null;
  // A colon before any `/`, `?` or `#` would be read as a scheme by some parsers; refuse the ambiguity.
  const firstColon = cleaned.indexOf(':');
  if (firstColon >= 0 && !/[/?#]/.test(cleaned.slice(0, firstColon))) return null;
  return cleaned;
}

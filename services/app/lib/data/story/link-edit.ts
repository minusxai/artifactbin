/**
 * link-edit — href normalization for authored links in jsx stories.
 *
 * The one rule this module owns: what a user-typed URL is allowed to become
 * before it reaches a document. Its callers are the format toolbar's popover
 * (components/views/story/StoryFormatToolbar), the edit session that applies
 * the mark (lib/story-runtime/edit/session), and the clipboard/AST paths in
 * lib/editor-v2. Normalizing at that boundary means an href the publish
 * sanitizer would strip is refused where it is typed, rather than saved and
 * later stripped into a dead `<a>`.
 *
 * Pure: no DOM, no React, no session.
 */

/**
 * Sanity-normalize user-typed link input. Absolute http(s)/mailto/tel pass through, a bare
 * domain gains `https://`, site-relative (`/…`) and fragment (`#…`) forms pass; anything
 * with an active-content scheme (javascript:, data:, …) or unrecognizable is null — the
 * write-back sanitizer would drop a dangerous href anyway, leaving a dead `<a>` behind.
 */
export function normalizeLinkHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  // The scheme is case-insensitive; lower it so a downstream literal-prefix
  // check (the frame re-validates before writing the attribute) cannot read
  // `HTTPS://` as some scheme it has never heard of and drop the link.
  const scheme = /^(?:https?|mailto|tel):/i.exec(t);
  if (scheme) return scheme[0].toLowerCase() + t.slice(scheme[0].length);
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null; // any other scheme: active content or unknown
  if (t.startsWith('/') || t.startsWith('#')) return t;
  if (/^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(t)) return `https://${t}`;
  return null;
}

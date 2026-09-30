/*
 * The one set of markup escapers. Three variants, because their outputs differ on purpose:
 *
 *  - escapeText: `& < >` — element text; a quote is harmless there.
 *  - escapeHtml: `& < > "` — text and double-quoted attribute values (nothing is ever written unquoted).
 *  - escapeAttr: `& < > " '` — also safe inside a single-quoted attribute.
 *
 * `&` is always first in effect, so the order of the replacements never changes the output.
 * scriptJson is the JSON text that may sit inside a `<script>` element or be evaluated as script.
 */
const TEXT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const HTML: Record<string, string> = { ...TEXT, '"': '&quot;' };
const ATTR: Record<string, string> = { ...HTML, "'": '&#x27;' };

export const escapeText = (s: string): string => s.replace(/[&<>]/g, (c) => TEXT[c] ?? c);
export const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => HTML[c] ?? c);
export const escapeAttr = (s: string): string => s.replace(/[&<>"']/g, (c) => ATTR[c] ?? c);

/** JSON that cannot close its `<script>` element: every `<`, `>`, U+2028 and U+2029 is escaped. */
export const scriptJson = (value: unknown): string => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

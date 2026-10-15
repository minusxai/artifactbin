/**
 * A templated ATTRIBUTE, resolved and guarded (lib/jsx/template holds the grammar): the row attributes' rules (kit/basic
 * rowAttrs) applied after substitution. Apart from the grammar so the data store's graph, which reads template
 * names but never resolves an attribute, does not carry the URL rules.
 */
import { SVG_PAINT_ATTRS, URL_ATTRS, URL_LIST_ATTRS, paintHasExternalUrl, urlListUrls } from './url-attrs';
import { holeText, parseTemplate, resolveTemplate, type HoleReader } from './template';

// eslint-disable-next-line no-control-regex -- browsers remove controls and spaces within URL schemes
const dangerousUrl = (url: string): boolean => /^(?:javascript:|vbscript:|data:(?!image\/))/i.test(url.replace(/[\x00-\x20]/g, ''));
/** A value that could end a declaration, open a block, escape, or fetch: never substituted into `style`. */
const UNSAFE_CSS = /[;{}\\"'<>\r\n\u2028\u2029]|\/\*|@import|(?:url|image|image-set|cross-fade|element|expression|src|paint|env)\s*\(/i;
/** What one hole contributes to a `style` attribute: its value when inert, else nothing. */
const cssValue = (value: unknown): string => {
  const v = holeText(value);
  return UNSAFE_CSS.test(v) ? '' : v;
};

/**
 * One templated attribute's value, guarded: null when the attribute must not be written (a URL with a
 * dangerous scheme or a hole without a value, an external paint reference). `id` is never templated.
 */
export function resolveAttribute(name: string, value: string, read: HoleReader): string | null {
  const parts = parseTemplate(value);
  if (!parts) return value;
  const lower = name.toLowerCase();
  if (lower === 'id') return value;
  if (lower === 'style') return parts.map((p) => (typeof p === 'string' ? p : cssValue(read(p)))).join('');
  const url = URL_ATTRS.has(lower) || URL_LIST_ATTRS.has(lower);
  if (url && parts.some((p) => typeof p !== 'string' && holeText(read(p)) === '')) return null;
  const out = resolveTemplate(parts, read);
  if (URL_LIST_ATTRS.has(lower) ? urlListUrls(out, lower).some(dangerousUrl) : URL_ATTRS.has(lower) && dangerousUrl(out)) return null;
  if (SVG_PAINT_ATTRS.has(lower) && paintHasExternalUrl(out)) return null;
  return out;
}

/** Every templated attribute of an element, resolved and guarded (`resolveAttribute`); dropped ones are absent. */
export function resolveAttributes(attrs: Readonly<Record<string, unknown>>, read: HoleReader): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(attrs)) {
    if (typeof raw !== 'string') continue;
    const value = resolveAttribute(name, raw, read);
    if (value !== null) out[name] = value;
  }
  return out;
}

/**
 * The generator used to be Python, and its outputs (the pages' fences and data props, the specs' SVG
 * coordinates) are committed or published in Python's formatting. These helpers reproduce the three
 * behaviours that differ from JavaScript's defaults, so a regeneration is byte-identical to the last
 * Python run: `json.dumps` with its default separators and ASCII escaping, `html.escape` plus the JSX
 * brace escape, and `round()`'s half-to-even.
 */

/** `html.escape(s, quote=False)` then the JSX braces, exactly as the page builder escaped text. */
export function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

const escapeString = (s, ensureAscii) => {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (code < 0x20) out += '\\u' + code.toString(16).padStart(4, '0');
    else if (ensureAscii && code > 0x7e) {
      if (code > 0xffff) {
        const v = code - 0x10000;
        out += '\\u' + (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + '\\u' + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
      } else out += '\\u' + code.toString(16).padStart(4, '0');
    } else out += ch;
  }
  return out + '"';
};

/** Python's `json.dumps(value)`: `, ` and `: ` separators, non-ASCII escaped (`ensure_ascii`), insertion order kept. */
export function pyJson(value, { ensureAscii = true } = {}) {
  const go = (v) => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    if (typeof v === 'string') return escapeString(v, ensureAscii);
    if (Array.isArray(v)) return '[' + v.map(go).join(', ') + ']';
    return '{' + Object.entries(v).map(([k, x]) => `${escapeString(k, ensureAscii)}: ${go(x)}`).join(', ') + '}';
  };
  return go(value);
}

/** Python's `round()`: half to even. */
export function pyRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Python's `str()` of a float that is a whole number: `79.0`, not `79`. */
export const pyFloat = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));

/** `f'{i:02d}'`. */
export const pad2 = (i) => String(i).padStart(2, '0');

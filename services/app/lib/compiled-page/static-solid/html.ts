/**
 * STATIC CHUNKS (compiler `staticHtml`): Solid's server bytes for a static plain-HTML subtree, written
 * without Babel or Solid.
 *
 * A static subtree of plain HTML elements is rendered to its server HTML at compile time and carried by the
 * SSR module as one string (`$mxH[i]`, a `JSON.parse(<lit>)` constant), inside the same `<rt.NoHydration>`
 * boundary its JSX would sit in: the hydration tree, the browser module and the served bytes are unchanged,
 * and the module Babel transforms no longer grows with the document's static markup.
 *
 * The bytes are Solid's own for that JSX (babel-plugin-jsx-dom-expressions SSR, `hydratable`, under
 * `NoHydration`): a static attribute's name lowercased and its value escaped for `"` and `&`, `class` and
 * `style` whitespace-trimmed, a boolean attribute bare; a child run of two or more boxed in `<!--$-->…<!--/-->`;
 * text escaped for `&` and `<`, a JSX text child's whitespace runs collapsed. Anything outside those rules —
 * a component, a namespaced or camelCased attribute name, a fragment — keeps its JSX (`static-html.test.ts`
 * holds the two equal over the corpora).
 */
export const SOLID_BOOLEAN = new Set(['allowfullscreen', 'async', 'alpha', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'disabled', 'formnovalidate', 'hidden', 'indeterminate', 'inert', 'ismap', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed', 'seamless', 'selected', 'adauctionheaders', 'browsingtopics', 'credentialless', 'defaultchecked', 'defaultmuted', 'defaultselected', 'defer', 'disablepictureinpicture', 'disableremoteplayback', 'preservespitch', 'shadowrootclonable', 'shadowrootcustomelementregistry', 'shadowrootdelegatesfocus', 'shadowrootserializable', 'sharedstoragewritable']);
/** Tags whose Solid server template differs from a plain element's (or that the generator never closes as Solid does). */
export const SOLID_SPECIAL_TAGS = new Set(['head', 'param', 'keygen', 'menuitem']);
/** Attribute names Solid does not write as a plain attribute. */
const SOLID_SPECIAL_ATTRS = new Set(['children', 'ref']);
const BOOLEAN_JSX = /^(?:disabled|checked|selected|readOnly|hidden|open|multiple|required|inert|autoFocus|reversed)$/i;
export const solidText = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const solidAttrValue = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/** babel-plugin-jsx-dom-expressions `trimWhitespace`. */
const solidTrim = (text: string): string => {
  let out = text.replace(/\r/g, '');
  if (/\n/.test(out)) out = out.split('\n').map((line, i) => (i ? line.replace(/^\s*/g, '') : line)).filter((line) => !/^\s*$/.test(line)).join(' ');
  return out.replace(/\s+/g, ' ');
};
/** One element's attributes as Solid's server template writes them; null when one is outside the plain rules. */
export function solidAttrs(attrs: ReadonlyArray<readonly [string, string]>, checkName: (name: string) => string): string | null {
  let out = '';
  for (const [name, value] of attrs) {
    checkName(name);
    if (/[A-Z:]/.test(name) || SOLID_SPECIAL_ATTRS.has(name)) return null;
    if (SOLID_BOOLEAN.has(name) || (value === '' && BOOLEAN_JSX.test(name))) { out += ` ${name}`; continue; }
    let text = value;
    if (name === 'style' || name === 'class') {
      text = solidTrim(text);
      if (name === 'style') text = text.replace(/; /g, ';').replace(/: /g, ':');
    }
    out += text === '' ? ` ${name}` : ` ${name}="${solidAttrValue(text)}"`;
  }
  return out;
}

/**
 * A static element child's text, as Solid serves the JSX the compiler writes for it (compiler `emit`): `{lit}`
 * and the long-text marker reach Solid verbatim; a short JSX text has its whitespace runs collapsed (`jsxLiteral`
 * encodes U+2028/U+2029 as entities, so those survive the collapse).
 */
export const solidTextChild = (value: string): string => solidText(value.length > 1024 || /\r|\n/.test(value) ? value : value.replace(/[^\S\u2028\u2029]+/g, ' '));

/** An element's rendered children: a run of two or more is boxed child by child, as Solid's hydratable template boxes its holes. */
export const solidChildren = (parts: readonly string[]): string => (parts.length > 1 ? parts.map((part) => `<!--$-->${part}<!--/-->`).join('') : parts.join(''));

/** The skeleton's JSX for chunk `i`: its HTML is `$mxH[i]` (bundle.server `ssrModuleCode`), an object Solid's server inserts unescaped. */
export const staticChunkJsx = (i: number): string => `<rt.NoHydration>{{ t: $mxH[${i}] }}</rt.NoHydration>`;

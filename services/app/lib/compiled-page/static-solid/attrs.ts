/**
 * A STATIC ELEMENT'S ATTRIBUTES WITHOUT REACT (Phase 3 probe; the framework-free twin of compiler `domAttrs`).
 *
 * `domAttrs` asks React's server renderer to write one start tag and parses it back. This writes the same list
 * from React DOM 19's own rules (react-dom-server `pushAttribute`, `pushStyleAttribute`, and the per-element
 * cases of `pushStartInstance`), so a static element's attributes stay byte-identical to today's render once
 * React is gone. What it returns is the same contract: `[name, value]` pairs in React's order, values decoded
 * (the JSX that carries them re-escapes them). `attrs.test.ts` holds it equal to `domAttrs` over a prop matrix.
 */
export type Attr = [string, string];
type Props = Record<string, unknown>;

/** React's boolean attributes: any truthy value writes `name=""`, anything else writes nothing. */
const BOOLEAN = new Set(['inert', 'allowFullScreen', 'async', 'autoPlay', 'controls', 'default', 'defer', 'disabled', 'disablePictureInPicture', 'disableRemotePlayback', 'formNoValidate', 'hidden', 'loop', 'noModule', 'noValidate', 'open', 'playsInline', 'readOnly', 'required', 'reversed', 'scoped', 'seamless', 'itemScope']);
/** Booleans React writes under their lowercase name. */
const LOWER_BOOLEAN = new Set(['autoFocus', 'multiple', 'muted']);
/** Written as the value's string, booleans included (`"true"`/`"false"`). */
const BOOLEANISH = new Set(['contentEditable', 'spellCheck', 'draggable', 'value', 'autoReverse', 'externalResourcesRequired', 'focusable', 'preserveAlpha']);
/** Strings only (a boolean writes nothing), under the given name. */
const STRING: Readonly<Record<string, string>> = {
  className: 'class', tabIndex: 'tabindex', dir: 'dir', role: 'role', viewBox: 'viewBox', width: 'width', height: 'height',
  xlinkActuate: 'xlink:actuate', xlinkArcrole: 'xlink:arcrole', xlinkRole: 'xlink:role', xlinkShow: 'xlink:show', xlinkTitle: 'xlink:title', xlinkType: 'xlink:type',
  xmlBase: 'xml:base', xmlLang: 'xml:lang', xmlSpace: 'xml:space',
};
/** Props React never writes as an attribute. */
const SKIP = new Set(['children', 'dangerouslySetInnerHTML', 'defaultValue', 'defaultChecked', 'innerHTML', 'suppressContentEditableWarning', 'suppressHydrationWarning', 'ref', 'key']);
/** React's prop → attribute name table for everything else (react-dom-server `aliases`). */
const ALIASES: ReadonlyMap<string, string> = new Map(Object.entries({
  acceptCharset: 'accept-charset', htmlFor: 'for', httpEquiv: 'http-equiv', crossOrigin: 'crossorigin', accentHeight: 'accent-height', alignmentBaseline: 'alignment-baseline',
  arabicForm: 'arabic-form', baselineShift: 'baseline-shift', capHeight: 'cap-height', clipPath: 'clip-path', clipRule: 'clip-rule', colorInterpolation: 'color-interpolation',
  colorInterpolationFilters: 'color-interpolation-filters', colorProfile: 'color-profile', colorRendering: 'color-rendering', dominantBaseline: 'dominant-baseline',
  enableBackground: 'enable-background', fillOpacity: 'fill-opacity', fillRule: 'fill-rule', floodColor: 'flood-color', floodOpacity: 'flood-opacity', fontFamily: 'font-family',
  fontSize: 'font-size', fontSizeAdjust: 'font-size-adjust', fontStretch: 'font-stretch', fontStyle: 'font-style', fontVariant: 'font-variant', fontWeight: 'font-weight',
  glyphName: 'glyph-name', glyphOrientationHorizontal: 'glyph-orientation-horizontal', glyphOrientationVertical: 'glyph-orientation-vertical', horizAdvX: 'horiz-adv-x',
  horizOriginX: 'horiz-origin-x', imageRendering: 'image-rendering', letterSpacing: 'letter-spacing', lightingColor: 'lighting-color', markerEnd: 'marker-end', markerMid: 'marker-mid',
  markerStart: 'marker-start', overlinePosition: 'overline-position', overlineThickness: 'overline-thickness', paintOrder: 'paint-order', 'panose-1': 'panose-1',
  pointerEvents: 'pointer-events', renderingIntent: 'rendering-intent', shapeRendering: 'shape-rendering', stopColor: 'stop-color', stopOpacity: 'stop-opacity',
  strikethroughPosition: 'strikethrough-position', strikethroughThickness: 'strikethrough-thickness', strokeDasharray: 'stroke-dasharray', strokeDashoffset: 'stroke-dashoffset',
  strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', strokeMiterlimit: 'stroke-miterlimit', strokeOpacity: 'stroke-opacity', strokeWidth: 'stroke-width',
  textAnchor: 'text-anchor', textDecoration: 'text-decoration', textRendering: 'text-rendering', transformOrigin: 'transform-origin', underlinePosition: 'underline-position',
  underlineThickness: 'underline-thickness', unicodeBidi: 'unicode-bidi', unicodeRange: 'unicode-range', unitsPerEm: 'units-per-em', vAlphabetic: 'v-alphabetic',
  vHanging: 'v-hanging', vIdeographic: 'v-ideographic', vMathematical: 'v-mathematical', vectorEffect: 'vector-effect', vertAdvY: 'vert-adv-y', vertOriginX: 'vert-origin-x',
  vertOriginY: 'vert-origin-y', wordSpacing: 'word-spacing', writingMode: 'writing-mode', xmlnsXlink: 'xmlns:xlink', xHeight: 'x-height',
}));
/** Style properties whose numbers carry no unit (react-dom-server `unitlessNumbers`). */
const UNITLESS = new Set(('animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow '
  + 'flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp '
  + 'lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth '
  + 'MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink '
  + 'msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns '
  + 'WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp').split(' '));
// eslint-disable-next-line no-misleading-character-class -- React's own attribute-name grammar (isAttributeNameSafe)
const SAFE_NAME = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/;
// eslint-disable-next-line no-control-regex -- React's javascript: URL test (sanitizeURL)
const JAVASCRIPT_URL = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
const sanitizeURL = (url: string): string => (JAVASCRIPT_URL.test(url) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : url);

const unwritable = (value: unknown): boolean => typeof value === 'function' || typeof value === 'symbol';

/** A style object as React writes it: kebab-case names (`ms` prefixed as `-ms-`), numbers in px unless unitless or 0, `;`-joined, no trailing `;`. */
export function styleText(style: unknown): string | null {
  if (typeof style !== 'object' || style === null) return null;
  const parts: string[] = [];
  for (const [name, raw] of Object.entries(style as Props)) {
    if (raw === null || raw === undefined || typeof raw === 'boolean' || raw === '') continue;
    if (name.startsWith('--')) { parts.push(`${name}:${String(raw).trim()}`); continue; }
    const css = name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^ms-/, '-ms-');
    const value = typeof raw === 'number' ? (raw === 0 || UNITLESS.has(name) ? String(raw) : `${raw}px`) : String(raw).trim();
    parts.push(`${css}:${value}`);
  }
  return parts.length ? parts.join(';') : null;
}

/** One prop → the attribute React writes for it (react-dom-server `pushAttribute`), or nothing. */
function pushAttribute(out: Attr[], name: string, value: unknown, tag: string): void {
  if (value === null || value === undefined) return;
  if (SKIP.has(name)) return;
  if (name in STRING) { if (!unwritable(value) && typeof value !== 'boolean') out.push([STRING[name]!, String(value)]); return; }
  if (name === 'style') { const text = styleText(value); if (text !== null) out.push(['style', text]); return; }
  if (name === 'src' || name === 'href' || name === 'action' || name === 'formAction') {
    // An empty src/href writes nothing (an anchor's empty href is kept by the `<a>` case below).
    if ((name === 'src' || name === 'href') && value === '' && !(tag === 'a' && name === 'href')) return;
    if (unwritable(value) || typeof value === 'boolean') return;
    out.push([name, sanitizeURL(String(value))]);
    return;
  }
  if (name === 'xlinkHref') { if (!unwritable(value) && typeof value !== 'boolean') out.push(['xlink:href', sanitizeURL(String(value))]); return; }
  if (LOWER_BOOLEAN.has(name)) { if (value && !unwritable(value)) out.push([name.toLowerCase(), '']); return; }
  if (BOOLEANISH.has(name)) { if (!unwritable(value)) out.push([name, String(value)]); return; }
  if (BOOLEAN.has(name)) { if (value && !unwritable(value)) out.push([name, '']); return; }
  if (name === 'capture' || name === 'download') {
    if (value === true) out.push([name, '']);
    else if (value !== false && !unwritable(value)) out.push([name, String(value)]);
    return;
  }
  if (name === 'cols' || name === 'rows' || name === 'size' || name === 'span') {
    if (!unwritable(value) && !Number.isNaN(Number(value)) && Number(value) >= 1) out.push([name, String(value)]);
    return;
  }
  if (name === 'rowSpan' || name === 'start') { if (!unwritable(value) && !Number.isNaN(Number(value))) out.push([name, String(value)]); return; }
  // Event handlers never reach the DOM.
  if (name.length > 2 && (name[0] === 'o' || name[0] === 'O') && (name[1] === 'n' || name[1] === 'N')) return;
  const attr = ALIASES.get(name) ?? name;
  if (!SAFE_NAME.test(attr) || unwritable(value)) return;
  if (typeof value === 'boolean') { const prefix = attr.toLowerCase().slice(0, 5); if (prefix !== 'data-' && prefix !== 'aria-') return; }
  out.push([attr, String(value)]);
}

/** Form-owner props React writes after an input's or button's other attributes (`pushFormActionAttribute`). */
const FORM_TAIL = ['name', 'formAction', 'formEncType', 'formMethod', 'formTarget'] as const;

/**
 * An element's start-tag attributes exactly as React's server renderer writes them, per element: `<input>`
 * writes its form-owner props, then `checked`, then `value` last; `<button>` its form-owner props last; `<form>`
 * its action/encType/method/target last; `<select>` and `<textarea>` never write `value` (it is content);
 * `<option selected>` comes last. Values are the decoded strings (the caller escapes).
 */
export function reactAttrs(tag: string, props: Props): Attr[] {
  const out: Attr[] = [];
  const entries = Object.entries(props).filter(([, v]) => v !== null && v !== undefined);
  if (tag === 'input' || tag === 'button') {
    const tail: Props = {};
    let checked: unknown = null, defaultChecked: unknown = null, value: unknown = null, defaultValue: unknown = null;
    for (const [name, v] of entries) {
      if (tag === 'input' && name === 'checked') checked = v;
      else if (tag === 'input' && name === 'defaultChecked') defaultChecked = v;
      else if (tag === 'input' && name === 'value') value = v;
      else if (tag === 'input' && name === 'defaultValue') defaultValue = v;
      else if ((FORM_TAIL as readonly string[]).includes(name)) tail[name] = v;
      else pushAttribute(out, name, v, tag);
    }
    for (const name of FORM_TAIL) if (tail[name] !== undefined) pushAttribute(out, name, tail[name], tag);
    if (tag === 'input') {
      const on = checked !== null ? checked : defaultChecked;
      if (on !== null && on && !unwritable(on)) out.push(['checked', '']);
      const v = value !== null ? value : defaultValue;
      if (v !== null) pushAttribute(out, 'value', v, tag);
    }
    return out;
  }
  if (tag === 'form') {
    const tail: Props = {};
    for (const [name, v] of entries) {
      if (['action', 'encType', 'method', 'target'].includes(name)) tail[name] = v;
      else pushAttribute(out, name, v, tag);
    }
    for (const name of ['action', 'encType', 'method', 'target']) if (tail[name] !== undefined) pushAttribute(out, name, tail[name], tag);
    return out;
  }
  let selected: unknown = null;
  for (const [name, v] of entries) {
    if ((tag === 'select' || tag === 'textarea') && (name === 'value' || name === 'defaultValue')) continue;
    if (tag === 'option' && name === 'selected') { selected = v; continue; }
    pushAttribute(out, name, v, tag);
  }
  if (tag === 'option' && selected) out.push(['selected', '']);
  return out;
}

/**
 * THE GATE A HARVESTED DRAWING PASSES BEFORE IT IS STORED (lib/mermaid-images).
 *
 * The SVG came out of a browser rendering an author's document, so it is
 * treated as untrusted markup. It is served as an image (an `<img>` runs no
 * script and fetches nothing) under `nosniff` and `sandbox`, and this is the
 * third wall: only a drawing made entirely of inert SVG is kept.
 *
 * It ACCEPTS OR REFUSES; it never rewrites. A stored drawing is shown instead
 * of the one the engine would draw, so it must be the engine's bytes exactly —
 * a drawing this refuses is simply not stored, and its readers keep drawing it
 * with the engine as they always have (Mermaid's `foreignObject` labels, for
 * one, go that way).
 *
 * Refused: anything but the XML the browser's serializer writes (no DOCTYPE,
 * entity declarations, processing instructions, comments or CDATA); an
 * element outside the SVG vocabulary below (script, foreignObject, image,
 * anchors, animation, any other namespace); an event-handler attribute; an
 * `href` that is not a fragment of this drawing; `xml:base`; any `url()` —
 * in an attribute, a style attribute or a stylesheet — that does not name a
 * fragment; a stylesheet at-rule other than `@keyframes`/`@media`, or one that
 * does not parse.
 */
import { parse, walk } from '@/lib/story/css-parser';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
/** The largest drawing kept; the harvest bounds its answers below this too. */
export const MAX_MERMAID_SVG_BYTES = 2 * 1024 * 1024;

/** Inert SVG: shapes, text, paint servers, markers and filters (never feImage). */
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'title', 'desc', 'style',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath',
  'marker', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'stop',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting',
  'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting',
  'feSpotLight', 'feTile', 'feTurbulence',
]);
const AT_RULES = new Set(['keyframes', '-webkit-keyframes', 'media']);
/** CSS functions that fetch or embed another resource. */
const FETCHING_FUNCTIONS = /^(-webkit-)?(image|image-set|cross-fade|element|src|paint|expression)$/i;
const ENTITY = /&(?:amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/g;
const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;

/** Entity-decoded text, or null when it carries a reference XML would not define. */
function decode(text: string): string | null {
  if (/&(?!(?:amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});)/.test(text)) return null;
  return text.replace(ENTITY, (entity) => {
    switch (entity) {
      case '&amp;': return '&';
      case '&lt;': return '<';
      case '&gt;': return '>';
      case '&quot;': return '"';
      case '&apos;': return "'";
      default: {
        const code = entity[2] === 'x' ? Number.parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�';
      }
    }
  });
}

/** Every `url(...)` in a value names a fragment of this drawing (`url(#id)`, quoted or not). */
function urlsAreFragments(value: string): boolean {
  // CSS escapes could spell `url` another way; a drawing needs none.
  if (value.includes('\\')) return false;
  for (const match of value.matchAll(/url\s*\(/gi)) {
    const rest = value.slice((match.index ?? 0) + match[0].length).trimStart();
    if (!/^["']?#/.test(rest)) return false;
  }
  return !/(?:^|[^\w-])(?:image|image-set|cross-fade|element|expression)\s*\(/i.test(value);
}

/** A stylesheet the drawing carries: parses, and fetches nothing. */
function safeStylesheet(css: string): boolean {
  if (/<\/|\\|@import|@font-face|@namespace|javascript:|behavior\s*:|-moz-binding/i.test(css)) return false;
  let safe = true;
  let ast;
  try {
    ast = parse(css, { onParseError: () => { safe = false; } });
  } catch {
    return false;
  }
  walk(ast, (node) => {
    if (node.type === 'Url' && !node.value.startsWith('#')) safe = false;
    if (node.type === 'Atrule' && !AT_RULES.has(node.name.toLowerCase())) safe = false;
    if (node.type === 'Function' && FETCHING_FUNCTIONS.test(node.name)) safe = false;
  });
  return safe && urlsAreFragments(css);
}

function safeAttribute(element: string, name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('on') || lower === 'xml:base') return false;
  if (lower === 'xmlns') return element === 'svg' && value === SVG_NS;
  if (lower.startsWith('xmlns:')) return lower === 'xmlns:xlink' && value === XLINK_NS;
  if (lower === 'href' || lower === 'xlink:href' || lower.endsWith(':href')) return /^#[\w.:-]+$/.test(value);
  if (/javascript:|vbscript:/i.test(value)) return false;
  if (lower === 'style') return urlsAreFragments(value) && !/@import|expression\s*\(|behavior\s*:|-moz-binding/i.test(value);
  return urlsAreFragments(value);
}

/**
 * The drawing, unchanged, when every part of it is inert SVG this module
 * admits; null otherwise (then nothing is stored and the engine keeps drawing).
 */
export function sanitizeMermaidSvg(svg: string): string | null {
  if (typeof svg !== 'string' || !svg || svg.length > MAX_MERMAID_SVG_BYTES) return null;
  const stack: string[] = [];
  let seenRoot = false;
  let at = 0;
  while (at < svg.length) {
    const open = svg.indexOf('<', at);
    const text = svg.slice(at, open === -1 ? svg.length : open);
    if (text) {
      // Text outside the root is refused; inside it, it must decode cleanly.
      if (!stack.length) return null;
      const decoded = decode(text);
      if (decoded === null) return null;
      if (stack[stack.length - 1] === 'style' && !safeStylesheet(decoded)) return null;
    }
    if (open === -1) break;
    // DOCTYPE, entity declarations, comments, CDATA and processing instructions: none.
    if (svg[open + 1] === '!' || svg[open + 1] === '?') return null;
    const close = svg.indexOf('>', open);
    if (close === -1) return null;
    const tag = svg.slice(open + 1, close);
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      if (stack.pop() !== name) return null;
      at = close + 1;
      if (!stack.length) {
        // One root, and nothing after it.
        return svg.slice(at).trim() ? null : svg;
      }
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch) return null;
    const name = nameMatch[1];
    if (!ELEMENTS.has(name)) return null;
    if (!stack.length) {
      if (seenRoot || name !== 'svg') return null;
      seenRoot = true;
    }
    // `name="value"` pairs, as the serializer writes them: double-quoted,
    // with `"` and `<` escaped inside. Anything else in the tag is refused.
    let rest = body.slice(name.length);
    let declaresSvg = false;
    const seen = new Set<string>();
    for (;;) {
      const space = /^\s*/.exec(rest)![0];
      rest = rest.slice(space.length);
      if (!rest) break;
      if (!space) return null;
      const attribute = /^([^\s="'<>/]+)="([^"<]*)"/.exec(rest);
      if (!attribute) return null;
      const [whole, attrName, raw] = attribute;
      if (!NAME.test(attrName) || seen.has(attrName)) return null;
      seen.add(attrName);
      const value = decode(raw);
      if (value === null || !safeAttribute(name, attrName, value)) return null;
      if (attrName === 'xmlns') declaresSvg = true;
      rest = rest.slice(whole.length);
    }
    if (!stack.length && !declaresSvg) return null;
    if (!selfClosing) stack.push(name);
    else if (!stack.length) return svg.slice(close + 1).trim() ? null : svg;
    at = close + 1;
  }
  return null;
}

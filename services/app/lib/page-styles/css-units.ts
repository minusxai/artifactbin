/**
 * A STYLESHEET AS ITS TOP-LEVEL UNITS — the minimal CSS reading the shared-sheet split needs.
 *
 * A unit is one comment, one at-rule statement (`@import "x";`) or one block (`selector { … }`, nested
 * blocks and at-rules included), with the whitespace between units dropped. The scanner honours
 * comments, quoted strings and `url(...)`, so a `}` or `;` inside any of them never ends a unit. Pure
 * and total: unbalanced input ends the last unit at the end of the text, never throws.
 *
 * It is not a CSS parser and claims no more: the split only compares unit TEXT and asks two questions of
 * a unit (what it declares, which variant wraps it), both answered conservatively.
 */

/** The top-level units of `css`, in order, each trimmed. */
export function cssUnits(css: string): string[] {
  const units: string[] = [];
  const n = css.length;
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(css[i]!)) i++;
    if (i >= n) break;
    const start = i;
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      units.push(css.slice(start, i));
      continue;
    }
    let depth = 0;
    let parens = 0;
    for (; i < n; i++) {
      const ch = css[i]!;
      if (ch === '"' || ch === "'") {
        for (i++; i < n && css[i] !== ch; i++) if (css[i] === '\\') i++;
      } else if (ch === '/' && css[i + 1] === '*') {
        const end = css.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 1;
      } else if (ch === '\\') {
        i++;
      } else if (ch === '(') parens++;
      else if (ch === ')') parens = Math.max(0, parens - 1);
      else if (parens === 0 && ch === '{') depth++;
      else if (parens === 0 && ch === '}') {
        depth--;
        if (depth <= 0) { i++; break; }
      } else if (parens === 0 && ch === ';' && depth === 0) { i++; break; }
    }
    units.push(css.slice(start, i).trim());
  }
  return units;
}

/**
 * The variant chain a utility rule carries, from its class selector: Tailwind writes `md:flex` as the class
 * `.md\:flex`, so what precedes the last escaped colon is the variant (`md`, `\@2xl`, `dark`, `hover`, `md:hover`).
 * Empty for a plain utility and for any unit that is not a single-class rule.
 */
export function variantOf(unit: string): string {
  const selector = /^\.((?:[^\s{\\]|\\.)+)\s*\{/.exec(unit)?.[1];
  if (selector === undefined) return '';
  const colon = selector.lastIndexOf('\\:');
  return colon < 0 ? '' : selector.slice(0, colon);
}

/** Whether a unit is a utility under a variant (`.md\:flex`, `.\@2xl\:px-8`, `.dark\:bg-x`). */
export const isVariantUtility = (unit: string): boolean => variantOf(unit) !== '';

/** The declared property names inside a unit (nested blocks included); overreaching is harmless, missing one is not. */
export function declaredProperties(unit: string): Set<string> {
  const open = unit.indexOf('{');
  const body = open < 0 ? unit : unit.slice(open);
  const names = new Set<string>();
  for (const match of body.matchAll(/[{;}\s](-{0,2}[a-z][a-z0-9-]*)\s*:(?!:)/gi)) names.add(match[1]!.toLowerCase());
  return names;
}

/** Shorthands whose longhands share their name as a prefix: `background` covers every `background-*`, and so on. */
const PREFIX_SHORTHANDS = new Set(['background', 'outline', 'transition', 'animation', 'mask', 'list-style', 'text-decoration', 'font', 'columns', 'column-rule', 'flex-flow', 'overscroll-behavior', 'place-content', 'place-items', 'place-self', 'scroll-snap', 'grid-template', 'grid-row', 'grid-column', 'grid-area', 'overflow', 'flex', 'border-image', 'text-emphasis', 'container', 'offset', 'gap']);
const SIDE_FAMILIES = ['margin', 'padding', 'scroll-margin', 'scroll-padding', 'inset'];
const SIDES = ['top', 'right', 'bottom', 'left'];
const ALIASES: Record<string, string> = {
  'inline-size': 'width', 'block-size': 'height', 'min-inline-size': 'min-width', 'min-block-size': 'min-height', 'max-inline-size': 'max-width', 'max-block-size': 'max-height',
  'row-gap': 'gap-row', 'column-gap': 'gap-column', 'grid-gap': 'gap', 'grid-row-gap': 'gap-row', 'grid-column-gap': 'gap-column',
};

/** The atoms a property sets when it is a box shorthand or longhand: its physical sides (and, for borders, kinds); null otherwise. */
function boxAtoms(name: string): string[] | null {
  if (SIDES.includes(name)) return [`inset:${name}`];
  for (const family of SIDE_FAMILIES) {
    if (name !== family && !name.startsWith(`${family}-`)) continue;
    const rest = name.slice(family.length + 1);
    const sides = rest === '' ? SIDES : rest.startsWith('inline') ? ['left', 'right'] : rest.startsWith('block') ? ['top', 'bottom'] : SIDES.includes(rest) ? [rest] : null;
    if (sides) return sides.map((side) => `${family}:${side}`);
  }
  if (/radius$/.test(name)) return ['radius'];
  if (name === 'border' || (name.startsWith('border-') && !/^border-(?:spacing|collapse|image)/.test(name))) {
    const parts = name.split('-').slice(1);
    const kind = ['width', 'style', 'color'].find((k) => parts.includes(k));
    const side = parts.find((part) => [...SIDES, 'inline', 'block', 'x', 'y'].includes(part));
    const sides = !side ? SIDES : side === 'inline' || side === 'x' ? ['left', 'right'] : side === 'block' || side === 'y' ? ['top', 'bottom'] : [side];
    return sides.flatMap((s) => (kind ? [kind] : ['width', 'style', 'color']).map((k) => `border:${s}:${k}`));
  }
  return null;
}

/** Whether `a` is a shorthand that sets `b`. */
const covers = (a: string, b: string): boolean =>
  (PREFIX_SHORTHANDS.has(a) && b.startsWith(`${a}-`)) || (a === 'font' && b === 'line-height') || (a === 'gap' && b.startsWith('gap-'));

/** Whether two properties can set a common value: equal, or one a shorthand of the other. Deliberately generous. */
export function relatedProperties(first: string, second: string): boolean {
  const a = ALIASES[first] ?? first;
  const b = ALIASES[second] ?? second;
  if (a === b || a.startsWith('--') || b.startsWith('--')) return a === b;
  if (covers(a, b) || covers(b, a)) return true;
  const left = boxAtoms(a);
  const right = boxAtoms(b);
  return !!left && !!right && left.some((atom) => right.includes(atom));
}

/** The declarations inside a unit, name → value text (the last wins, as the cascade has it within one block). */
export function declaredValues(unit: string): Map<string, string> {
  const open = unit.indexOf('{');
  const body = open < 0 ? unit : unit.slice(open);
  const values = new Map<string, string>();
  for (const match of body.matchAll(/[{;}\s](-{0,2}[a-z][a-z0-9-]*)\s*:(?!:)([^;{}]*)/gi)) values.set(match[1]!.toLowerCase(), match[2]!.trim());
  return values;
}

/**
 * Whether the order of two rules of ONE element can decide the result: they set the same or related properties,
 * and either they sit under different variants (`px-5` against `@2xl:px-12` — the breakpoint wins by coming later) or
 * the properties differ (`py-14` against `pt-6` — the longhand wins by coming later). Two rules of one variant that
 * set one property are a contradiction, which the kit's twMerge removes from its own classes and which nobody relies on.
 */
export function orderMatters(a: { variant: string; properties: ReadonlySet<string> }, b: { variant: string; properties: ReadonlySet<string> }): boolean {
  const sameVariant = a.variant === b.variant;
  for (const x of a.properties) for (const y of b.properties) {
    if (!relatedProperties(x, y)) continue;
    if (!sameVariant || x !== y) return true;
  }
  return false;
}

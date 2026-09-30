/**
 * A FILE CARRIES ONLY THE FONT SUBSETS ITS TEXT CAN USE. The stylesheets split each face into
 * `unicode-range` subsets (Latin, Latin Extended, …), and a browser loads a subset only when a
 * character in its range is drawn. Online that costs nothing; a file inlines every face it keeps
 * as base64, so an unused subset is dead weight (Latin Extended alone is ~170 KB of Inter).
 *
 * `withoutUnusedFaces` drops each `@font-face` whose `unicode-range` meets no character of `text`
 * (everything the file can show: its source, data and comments). A face without a range is always
 * kept. Text typed into the file later that needs a dropped subset falls back to the next font in
 * the stack, as it would on a page that failed to load that subset.
 */

/** `U+0000-00FF,U+0131,U+4??` → inclusive code point intervals. */
export function unicodeRanges(value: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const part of value.split(',')) {
    const m = /^\s*U\+([0-9A-F?]{1,6})(?:-([0-9A-F]{1,6}))?\s*$/i.exec(part);
    if (!m) continue;
    const [lo, hi] = m[1]!.includes('?')
      ? [parseInt(m[1]!.replace(/\?/g, '0'), 16), parseInt(m[1]!.replace(/\?/g, 'F'), 16)]
      : [parseInt(m[1]!, 16), m[2] ? parseInt(m[2], 16) : parseInt(m[1]!, 16)];
    out.push([lo, hi]);
  }
  return out;
}

/** Every distinct code point in `text` — found by one regex scan past ASCII, which every text holds (a letter stands for it). */
function codePoints(text: string): Set<number> {
  const seen = new Set<number>([0x41]);
  for (const [ch] of text.matchAll(/[^\x00-\x7f]/gu)) seen.add(ch.codePointAt(0)!);
  return seen;
}

const FACE = /@font-face\s*\{[^}]*\}/g;
const RANGE = /unicode-range\s*:\s*([^;}]+)/i;

/** `css` without the `@font-face` rules no character of `text` would load. */
export function withoutUnusedFaces(css: string, text: string): string {
  let used: Set<number> | null = null;
  return css.replace(FACE, (face) => {
    const range = RANGE.exec(face)?.[1];
    if (!range) return face;
    const intervals = unicodeRanges(range);
    if (!intervals.length) return face;
    used ??= codePoints(text);
    for (const point of used) if (intervals.some(([lo, hi]) => point >= lo && point <= hi)) return face;
    return '';
  });
}

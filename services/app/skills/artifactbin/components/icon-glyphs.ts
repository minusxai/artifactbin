/** Internal helper for af-icon; not a public entry point. */
/** Local Lucide glyph catalog. Bundled with the component; no runtime fetches. */
import * as lucide from 'lucide-static';

const glyphs = lucide as unknown as Record<string, string>;
const keyOf = (name: string): string => String(name).split(/[-_\s]+/).map(part => part.charAt(
  0).toUpperCase() + part.slice(1)).join('');

/** Full pinned catalog coverage, including Lucide's deprecated aliases. */
export const LUCIDE_ICON_COUNT = Object.keys(glyphs).filter(name => name !== 'default').length;

/** Trusted local SVG source; callers parse it as XML and never interpolate author strings. */
export function iconMarkup(name: string): string {
  const key = keyOf(name);
  return glyphs[key] ?? glyphs.CircleQuestionMark!;
}

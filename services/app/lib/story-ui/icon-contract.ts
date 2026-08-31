/**
 * The `<Icon>` contract — what a glyph IS, and the key it is filed under.
 *
 * `<Icon name>` may name any of lucide's ~1600 glyphs, and the two halves that make
 * that work live on opposite sides of a bundle boundary: the RESOLVER pulls in the
 * whole icon set and runs on the server (lib/story/icon-glyphs), the RENDERER ships
 * to every reader and must never reach it (components/kit/icon,
 * lib/__tests__/reader-bundle-hygiene). This module is what they may share — so it
 * imports NOTHING, and holds only the shape and the naming rule they must agree on.
 */

/** One resolved glyph, as the island carries it. */
export interface IconGlyph {
  /**
   * The RESOLVED icon's lucide classes, not the author's spelling. Sometimes TWO:
   * lucide emits both the kebab of the Pascal name and the raw name, which differ
   * whenever a name carries digits (`grid-2x2` → `lucide-grid2x2 lucide-grid-2x2`).
   */
  cls: string;
  /** The glyph's paths, exactly as lucide renders them inside its <svg>. */
  inner: string;
}

/** Resolved glyphs by `iconGlyphKey` — the size of one document's usage. */
export type GlyphMap = Record<string, IconGlyph>;

/**
 * The lucide site names icons in kebab-case ('chart-bar'); the icon map's keys are
 * PascalCase ('ChartBar'). Both spellings are accepted from authors, so both must
 * land on one key, or a resolved glyph is never found. Digit segments concatenate
 * cleanly ('grid-2x2' → 'Grid2x2').
 */
export const iconGlyphKey = (name: string): string =>
  String(name)
    .split(/[-_\s]+/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

/** The glyph an unknown name falls back to — a typo stays VISIBLE, never a hole. */
export const FALLBACK_ICON_KEY = 'CircleQuestionMark';

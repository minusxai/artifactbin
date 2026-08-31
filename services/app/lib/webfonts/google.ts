/**
 * Google Fonts' css2 answer, parsed — PURE.
 *
 * The endpoint returns one @font-face block per SUBSET, each preceded by a
 * `/* latin *​/`-style comment naming it. We keep latin + latin-ext: the same
 * cut the bundled @fontsource pipeline ships (scripts/copy-assets.mjs), so an
 * imported family costs what a built-in one costs and behaves the same — the
 * unicode-range on each face is what makes latin-ext lazy.
 *
 * A face whose subset we cannot name, or whose src is not a woff2 URL, is
 * SKIPPED rather than guessed at: what we cannot describe we will not store.
 */

export interface GoogleFontFace {
  family: string;
  subset: string;
  /** The gstatic URL to copy from — never served to a reader. */
  url: string;
  weight: string;
  style?: string;
  unicodeRange?: string;
}

const KEPT_SUBSETS = new Set(['latin', 'latin-ext']);

const FACE_RE = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi;
const decl = (body: string, name: string): string | undefined =>
  new RegExp(`${name}\\s*:\\s*([^;]+);`, 'i').exec(body)?.[1]?.trim();

export function parseGoogleFontCss(css: string): GoogleFontFace[] {
  const faces: GoogleFontFace[] = [];
  for (const [, subset, body] of css.matchAll(FACE_RE)) {
    if (!KEPT_SUBSETS.has(subset.toLowerCase())) continue;
    const family = decl(body, 'font-family')?.replace(/^['"]|['"]$/g, '');
    const url = /url\((['"]?)(https?:\/\/[^)'"]+\.woff2)\1\)/i.exec(body)?.[2];
    const weight = decl(body, 'font-weight') ?? '400';
    const style = decl(body, 'font-style');
    if (!family || !url) continue;
    faces.push({
      family,
      subset: subset.toLowerCase(),
      url,
      weight,
      ...(style && style !== 'normal' ? { style } : {}),
      ...(decl(body, 'unicode-range') ? { unicodeRange: decl(body, 'unicode-range') } : {}),
    });
  }
  return faces;
}

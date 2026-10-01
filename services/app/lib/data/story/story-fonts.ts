/**
 * Platform-provided story fonts.
 *
 * Legacy stories bring their own fonts via authored `@import` lines (frozen behavior). For jsx
 * stories the PLATFORM provides fonts: a theme registry maps theme name → font assets (family +
 * static asset URL + optional weight/style descriptors), and `getStoryFontCss` turns the active
 * theme's entries into @font-face CSS.
 *
 * The CSS is emitted into the document <head> as a `<style data-mx-fonts>` node
 * (`buildStoryDocument`, lib/story/document.ts) with plain `url()` refs — one shared, cacheable
 * static asset per theme, no data-URI payload on every story view. The node is platform chrome,
 * never authored source, so it must not reach `content.story` on any save path.
 */
import { STORY_THEMES } from './story-themes';
import fontManifest from './story-font-manifest.json';

/** Marker attribute of the platform font style node in the document head. */
export const STORY_FONTS_ATTR = 'data-mx-fonts';

export interface StoryFontAsset {
  /** CSS font-family the @font-face registers. */
  family: string;
  /** Same-origin static asset URL (public/fonts). Never a data: URI in the live form. */
  url: string;
  /** font-weight descriptor (e.g. '400', '700', or a variable range '100 900'). */
  weight?: string;
  /** font-style descriptor (e.g. 'italic'). */
  style?: string;
  /**
   * unicode-range descriptor — the subsets are per-script files, and this is
   * what makes declaring several of one family LAZY: the browser fetches only
   * the file whose range the page's text actually hits.
   */
  unicodeRange?: string;
  /** The one file per family worth a preload (its latin upright — what body text needs). */
  preload?: boolean;
}

/**
 * The font-asset catalog: family → @font-face source files under public/fonts.
 * GENERATED at install time by scripts/copy-assets.mjs from the @fontsource
 * packages (binaries versioned through package-lock, never committed —
 * public/fonts and the manifest are gitignored). Families outside this catalog
 * are substituted at the registry level (see story-themes.ts per-theme notes).
 */
export const STORY_FAMILY_ASSETS: Readonly<Record<string, readonly StoryFontAsset[]>> = fontManifest.families as Record<string, StoryFontAsset[]>;
const FAMILY_ASSETS = STORY_FAMILY_ASSETS;

/** The families compiled into this build — a document asking for one of these
 *  needs no web fetch (lib/webfonts short-circuits on it). */
export const STORY_FONT_FAMILIES: readonly string[] = Object.keys(FAMILY_ASSETS);

/** The distinct asset sets for a theme's display/body/mono families, in catalog order. */
function assetsForFamilies(families: Array<string | undefined>): readonly StoryFontAsset[] {
  const wanted = new Set(families.filter((f): f is string => !!f));
  return Object.entries(FAMILY_ASSETS)
    .filter(([family]) => wanted.has(family))
    .flatMap(([, assets]) => assets);
}

/**
 * Theme registry: theme name → font assets. Per-theme entries are DERIVED from the design-theme
 * registry (story-themes.ts — one registry, four consumers): each theme carries exactly the
 * assets for its display/body/mono families. Unknown themes fall back to `neutral` (the app's
 * bundled families; system stack remains the implicit fallback for anything unlisted).
 */
export const STORY_FONT_THEMES: Record<string, readonly StoryFontAsset[]> = {
  // The untuned default carries every bundled family: with no theme there is
  // no declared body/display, so anything the document reaches for should
  // resolve. Declaring a face is free — the browser fetches one only when text
  // actually matching it renders.
  neutral: Object.values(FAMILY_ASSETS).flat(),
  ...Object.fromEntries(STORY_THEMES.map(t => [
    t.name,
    assetsForFamilies([t.fonts.display, t.fonts.body, t.fonts.mono]),
  ])),
};

const fontFaceRule = (a: StoryFontAsset): string =>
  '@font-face {\n' +
  `  font-family: "${a.family}";\n` +
  `  src: url("${a.url}") format("woff2");\n` +
  (a.weight ? `  font-weight: ${a.weight};\n` : '') +
  (a.style ? `  font-style: ${a.style};\n` : '') +
  (a.unicodeRange ? `  unicode-range: ${a.unicodeRange};\n` : '') +
  '  font-display: swap;\n' +
  '}';

/** @font-face CSS for any asset list — the one writer, shared with imported
 *  families (lib/webfonts), so a copied face is declared exactly like a
 *  bundled one and `font-display: swap` cannot drift between them. */
export function storyFontFaceCss(assets: readonly StoryFontAsset[]): string {
  return assets.map(fontFaceRule).join('\n');
}

/** @font-face CSS for a theme's registered assets — `url()` refs to cacheable static files. */
export function getStoryFontCss(theme = 'neutral'): string {
  return storyFontFaceCss(STORY_FONT_THEMES[theme] ?? STORY_FONT_THEMES.neutral);
}

// What a document's first screen paints, and so what its head preloads, is
// lib/story/styles/first-screen-fonts: read from the document's nodes, not the theme alone.

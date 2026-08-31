/**
 * Platform-provided story fonts.
 *
 * Legacy stories bring their own fonts via authored `@import` lines (frozen behavior). For jsx
 * stories the PLATFORM provides fonts: a theme registry maps theme name → font assets (family +
 * static asset URL + optional weight/style descriptors), and `getStoryFontCss` turns the active
 * theme's entries into @font-face CSS.
 *
 * Two forms of the same fonts (self-contained-document rule):
 *  - LIVE view: this CSS is injected inside the story root as a `<style data-mx-fonts>` node with
 *    plain `url()` refs — one shared, cacheable static asset per theme, no data-URI payload on
 *    every story view.
 *  - CAPTURE: the serializer (lib/story-surface/serialize) splices the data-URI form into the
 *    PARSED COPY only — the live DOM always keeps the URL form.
 *
 * Save paths must never persist the injected node: serializeEditedStory strips `[data-mx-fonts]`
 * (see INJECTED_STYLE_SELECTOR in lib/html/serialize-story.ts).
 */
import { STORY_THEMES } from './story-themes';
import fontManifest from './story-font-manifest.json';

/** Marker attribute of the in-root font style node (render injects it; save paths strip it). */
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
const FAMILY_ASSETS: Record<string, readonly StoryFontAsset[]> = fontManifest as Record<string, StoryFontAsset[]>;

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

/** The family a themeless document paints its body text in (Tailwind preflight's sans). */
const NEUTRAL_BODY_FAMILY = 'Inter';

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

/** @font-face CSS for a theme's registered assets (URL form — the live view's cacheable shape). */
export function getStoryFontCss(theme = 'neutral'): string {
  return storyFontFaceCss(STORY_FONT_THEMES[theme] ?? STORY_FONT_THEMES.neutral);
}

/**
 * The faces worth a `<link rel="preload">` in the document head: a theme's
 * DISPLAY and BODY families at upright style.
 *
 * Why a subset rather than the whole registry — the declared set is lazy. A
 * browser fetches a face only when text actually matching it renders, so
 * declaring five faces costs nothing, but preloading five would fetch fonts
 * the document never paints (and burn bandwidth racing the one it does).
 * Display + body is what sets the bulk of a page, so it is what visibly
 * reflows when it arrives late; italic is incidental, and mono only appears
 * where there is code.
 *
 * The preload matters because the @font-face rules themselves are injected
 * CLIENT-side into the story surface (components/views/shared/AgentHtml), so
 * without this the font is not even discovered until React has hydrated and
 * mounted the iframe.
 */
export function criticalStoryFonts(theme = 'neutral'): readonly StoryFontAsset[] {
  const entry = STORY_THEMES.find((t) => t.name === theme);
  const families = entry ? [entry.fonts.display, entry.fonts.body] : [NEUTRAL_BODY_FAMILY];
  // Only the flagged file per family — its latin upright. The other subsets
  // (latin-ext, italics) stay declared-but-lazy: preloading a unicode-range
  // file the page never hits fetches bytes for nothing.
  return assetsForFamilies(families).filter((a) => a.preload === true);
}


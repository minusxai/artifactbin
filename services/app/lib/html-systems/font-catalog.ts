import fontManifest from './font-manifest.json';

/**
 * The generated font manifest (services/app/scripts/copy-assets.mjs writes it at install; gitignored): bundled
 * families, the app shell's faces and the design systems' packaged faces, each a hashed /fonts woff2. Read by
 * path too: artifactbin-server, vite.config.mts, design-systems/lib/packaged-fonts.mjs and the portable chrome build.
 */
export const storyFontManifest = fontManifest;

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

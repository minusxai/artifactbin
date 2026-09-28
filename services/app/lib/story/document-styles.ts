/**
 * THE SERVED DOCUMENT'S STYLESHEETS — one source for every renderer that serves a document BY ITSELF
 * (`/a/:id/raw`, a domain post, a capture): today's standalone document (lib/story/document) and the
 * compiled reader (lib/compiled-page/serve.server) emit exactly these tags, in this order, with
 * exactly this text. Byte for byte matters beyond looks: Mermaid reads `--font-mono`'s TEXT into its
 * palette, and the palette names a stored drawing (lib/mermaid-images), so a minified copy of the
 * same rules would draw — and look up — a different diagram.
 *
 * Style order mirrors the engine's injection order (compiled Tailwind → bare typography floor →
 * fonts), author CSS last so it sees everything it may override.
 */
import { STORY_CHROME_CSS, STORY_COLUMN_CSS, STORY_EMBED_CSS, STORY_TABLE_CSS } from '@/lib/story-runtime/chrome-css';
import { STORY_BARE_TYPOGRAPHY_CSS } from '@/lib/story-surface/bare-typography';
import { STORY_BARE_CONTROLS_CSS } from '@/lib/story-surface/bare-controls';
import { getStoryFontCss, storyFontFaceCss, STORY_FONTS_ATTR, type StoryFontAsset } from '@/lib/data/story/story-fonts';
import { documentFontCss, type DocumentFonts } from './document-fonts';

/** The page-level rule every served document starts with. `--mx-vh` feeds the recipes that size against the viewport (slides). */
export const DOCUMENT_ROOT_CSS = ':root { --mx-vh: 100vh; } body { margin: 0; }';

/** A domain post's one line of attribution: theme-neutral, it inherits the document's colour and face and only quiets them. */
export const DOMAIN_FOOTER_CSS = '[data-mx-domain-footer]{box-sizing:border-box;max-width:100%;margin:0;padding:40px 16px 48px;text-align:center;font-size:13px;line-height:1.5;opacity:.65}'
  + '[data-mx-domain-footer] a{color:inherit;text-decoration:underline;text-underline-offset:2px}';

export interface DocumentStylesInput {
  /** The version's compiled Tailwind (lib/data/story/story-css.server currentStoryCss), or none. */
  compiledCss: string | null;
  /** The document draws its own navigation (deck rail, outline, reading column); false for a capture. */
  chrome: boolean;
  /** A domain post: its attribution line's style. */
  bare: boolean;
  theme: string | null | undefined;
  /** The families the document imported (lib/webfonts), resolved. */
  importedFaces: readonly StoryFontAsset[];
  /** The Helmet's font slot overrides. */
  docFonts: DocumentFonts;
  /** The author's own `<style>`. */
  authorCss: string | null;
}

export interface DocumentSheet { attr: string; css: string }

/** Every stylesheet after the root rule, as `{ attr, css }`, in the order the document carries them. */
export function documentStyleSheets(input: DocumentStylesInput): DocumentSheet[] {
  const fontVars = documentFontCss(input.docFonts);
  const sheets: Array<DocumentSheet | null> = [
    input.compiledCss ? { attr: 'data-mx-tw', css: input.compiledCss } : null,
    { attr: 'data-mx-bare-type', css: STORY_BARE_TYPOGRAPHY_CSS },
    // A bare form control looks like a form control: preflight strips its border and padding, and
    // nothing else styles it back (lib/story-surface/bare-controls).
    { attr: 'data-mx-bare-controls', css: STORY_BARE_CONTROLS_CSS },
    // The document's own navigation keeps its styles on a bare page too; only the reader chrome's MARKUP is withheld.
    input.chrome ? { attr: 'data-mx-chrome', css: STORY_CHROME_CSS } : null,
    input.bare ? { attr: 'data-mx-domain-footer', css: DOMAIN_FOOTER_CSS } : null,
    { attr: 'data-mx-embed', css: STORY_EMBED_CSS },
    // Every table its own scroll box, every document, capture included (STORY_TABLE_CSS).
    { attr: 'data-mx-tables', css: STORY_TABLE_CSS },
    // The column the document is measured in — capture included: it decides what the authored
    // `@container` utilities resolve against (STORY_COLUMN_CSS).
    { attr: 'data-mx-column', css: STORY_COLUMN_CSS },
    { attr: STORY_FONTS_ATTR, css: getStoryFontCss(input.theme ?? undefined) },
    // Imported faces and the slot override LAST among the font styles: the document's own ask beats the theme.
    input.importedFaces.length ? { attr: 'data-mx-webfonts', css: storyFontFaceCss([...input.importedFaces]) } : null,
    fontVars ? { attr: 'data-mx-font-vars', css: fontVars } : null,
    input.authorCss ? { attr: 'data-mx-author', css: input.authorCss } : null,
  ];
  return sheets.filter((sheet): sheet is DocumentSheet => sheet !== null);
}

/** `</style` inside CSS would close the tag early; CSS has no use for the sequence. */
export const styleTag = (attr: string, css: string): string => `<style ${attr}>${css.replace(/<\/style/gi, '')}</style>`;

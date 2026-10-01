/**
 * A DOCUMENT'S BASE SHEET — everything the served story's stylesheet carries
 * ahead of its compiled Tailwind and its authored `<style>`: the bare element
 * typography and controls, the navigation chrome, the embed/table/column
 * rules and the fonts (the theme's faces, faces the document imported, and
 * the slot overrides its Helmet names).
 *
 * ONE writer for both sides. The server builds it when it prepares a version
 * (lib/story/prepare-runtime.server); the reader is sent only the RECIPE — a
 * handful of scalars and font records — and rebuilds the same bytes in the
 * lazy inline-CSS path when a live or editor update makes it re-isolate the
 * sheet (lib/story-runtime/InlineStoryRuntime). Same function, same inputs,
 * same string: no second copy of ~50 KB of CSS rides in every page.
 *
 * Browser safe by construction: nothing here reads the database or the network.
 */
import { STORY_BARE_TYPOGRAPHY_CSS } from '@/lib/story-surface/bare-typography';
import { STORY_BARE_CONTROLS_CSS } from '@/lib/story-surface/bare-controls';
import { STORY_CHROME_CSS, STORY_COLUMN_CSS, STORY_EMBED_CSS, STORY_TABLE_CSS } from '@/lib/story-runtime/chrome-css';
import { getStoryFontCss, storyFontFaceCss, type StoryFontAsset } from '@/lib/data/story/story-fonts';
import { documentFontCss, type DocumentFonts } from './document-fonts';

export interface StoryBaseCssRecipe {
  /** False for a capture (`chrome=0`): no navigation chrome. */
  chrome: boolean;
  theme: string | null;
  /** Faces the document imported (lib/webfonts), already resolved. */
  faces: StoryFontAsset[];
  /** The Helmet's font slot overrides. */
  fonts: DocumentFonts;
}

export function storyBaseCss(recipe: StoryBaseCssRecipe): string {
  return [
    ':root { --mx-vh: 100vh; color: var(--foreground, CanvasText); background-color: var(--background, Canvas); } body { margin: 0; }', STORY_BARE_TYPOGRAPHY_CSS, STORY_BARE_CONTROLS_CSS,
    recipe.chrome ? STORY_CHROME_CSS : '', STORY_EMBED_CSS, STORY_TABLE_CSS, STORY_COLUMN_CSS,
    getStoryFontCss(recipe.theme ?? undefined), storyFontFaceCss(recipe.faces), documentFontCss(recipe.fonts),
  ].join('\n');
}

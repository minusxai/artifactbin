/**
 * A DOCUMENT'S BASE SHEET — everything the served story's stylesheet carries
 * ahead of its compiled Tailwind and its authored `<style>`: the bare element
 * typography and controls, the navigation chrome, the embed/table/column
 * rules and the fonts (the theme's faces, and the Google import and slot
 * overrides its Helmet names).
 *
 * ONE writer for both sides. The server builds it when it prepares a version
 * (lib/story/prepared/prepare-runtime.server); the reader is sent only the RECIPE — a
 * handful of scalars and font records — and rebuilds the same bytes in the
 * lazy inline-CSS path when a live or editor update makes it re-isolate the
 * sheet (lib/story-runtime/InlineStoryRuntime). Same function, same inputs,
 * same string: no second copy of ~50 KB of CSS rides in every page.
 *
 * Browser safe by construction: nothing here reads the database or the network.
 */
import { STORY_BARE_TYPOGRAPHY_CSS } from '@/lib/story-surface/bare-typography';
import { STORY_BARE_CONTROLS_CSS } from '@/lib/story-surface/bare-controls';
import { DOCUMENT_NAV_CSS, STORY_COLUMN_CSS, STORY_EMBED_CSS, STORY_TABLE_CSS } from '@/lib/story-runtime/chrome-css';
import { getStoryFontCss } from '@/lib/data/story/story-fonts';
import { documentFontCss, type DocumentFonts } from './document-fonts';

export interface StoryBaseCssRecipe {
  /** False for a capture (`chrome=0`): no navigation chrome. */
  chrome: boolean;
  theme: string | null;
  /** Never written: retained only until lib/serving/artifact-page stops reading it (a contract request). */
  faces?: never[];
  /** The Helmet's font slot overrides. */
  fonts: DocumentFonts;
  /**
   * A design system's faces and classes (lib/data/story/story-system-sheets storySystemSheetCss), when the
   * document names one. The TEXT, not the name: the browser rebuilds this sheet from the recipe and
   * must not carry the registry to do it.
   */
  systemCss?: string;
}

const STORY_ROOT_RULE = ':root { --mx-vh: 100vh; color: var(--foreground, CanvasText); background-color: var(--background, Canvas); } body { margin: 0; }';

/**
 * The fixed sheets a base sheet is made of: what a prepared page's stored stylesheet version hashes
 * (lib/story/prepared/css-version.server), so changing any of them re-prepares the stored pages that carry it.
 */
export const STORY_BASE_SHEETS: readonly string[] = [STORY_ROOT_RULE, STORY_BARE_TYPOGRAPHY_CSS, STORY_BARE_CONTROLS_CSS, DOCUMENT_NAV_CSS, STORY_EMBED_CSS, STORY_TABLE_CSS, STORY_COLUMN_CSS];

export function storyBaseCss(recipe: StoryBaseCssRecipe): string {
  return [
    STORY_ROOT_RULE, STORY_BARE_TYPOGRAPHY_CSS, STORY_BARE_CONTROLS_CSS,
    recipe.chrome ? DOCUMENT_NAV_CSS : '', STORY_EMBED_CSS, STORY_TABLE_CSS, STORY_COLUMN_CSS,
    getStoryFontCss(recipe.theme ?? undefined), documentFontCss(recipe.fonts), recipe.systemCss ?? '',
  ].join('\n');
}

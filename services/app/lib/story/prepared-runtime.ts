import type { StoryIslandData } from '@/lib/story-runtime/contract';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import type { StoryBaseCssRecipe } from './story-base-css';
import type { StyleOverride } from './style-overrides';

/**
 * Browser-safe prepared artifact with its RAW stylesheet parts: /a/<id>/raw,
 * the export capture and the offline file isolate these themselves. Script
 * bytes are inert data, executed only by the sandbox runtime.
 */
export interface PreparedStoryRuntime {
  data: StoryIslandData;
  baseCss: string;
  compiledCss: string | null;
  authorCss: string | null;
  authorScript: string | null;
  theme: StoryThemeName | null;
  title: string;
  /** Cached critical font URLs for discovery in the initial server head. */
  fontPreloads?: string[];
}

/**
 * THE READER PAGE'S RUNTIME (app/api/page/artifact/[id], lib/story/prepared-page.server):
 * the document with its stylesheet ALREADY put under the inline CSS policy on
 * the server, once per version. The reader renders it as it is — no CSS parser
 * in its bundle, no second copy of the sheet.
 *
 * `data.nodes` is the RAW tree (what edit and annotation sessions classify
 * against); `overrides` are the attribute values the policy rewrote in it
 * (lib/story/style-overrides), so the render is exactly the server's.
 */
export interface ServedStoryRuntime {
  data: StoryIslandData;
  /**
   * The isolated sheet — the text of the story's `<style>`. ABSENT in the
   * HTML bootstrap whenever the server inlined the story itself: that
   * `<style>` is then the one copy, and web/bootstrap puts its text back here
   * before anything reads the payload.
   */
  css?: string;
  overrides?: StyleOverride[];
  /** How to rebuild the raw base sheet, for the lazy path that re-isolates after a live or editor update. */
  base: StoryBaseCssRecipe;
  authorScript: string | null;
  theme: StoryThemeName | null;
  title: string;
  fontPreloads?: string[];
}

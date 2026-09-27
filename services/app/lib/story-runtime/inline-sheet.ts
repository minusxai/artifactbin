/**
 * THE INLINE CSS POLICY, ON DEMAND (lib/story/inline-css): the reader's
 * runtime loads this only when it must isolate a sheet it was not served —
 * after a live frame or an editor update, or for a host that hands it raw
 * parts (the offline file passes this module in statically). A served
 * document's first render never needs it: its sheet and node values arrive
 * already isolated (lib/story/prepared-page.server), and css-tree stays out of
 * the reader's bundle (lib/__tests__/reader-bundle-hygiene).
 */
import type { JsxNode } from '@/lib/jsx';
import { inlineStoryCss, inlineStoryNodes } from '@/lib/story/inline-css';
import { storyBaseCss, type StoryBaseCssRecipe } from '@/lib/story/story-base-css';

export interface RawStorySheet {
  /** The base sheet, or the recipe the server built it from (rebuilt by the same writer). */
  base: string | StoryBaseCssRecipe;
  compiledCss: string | null;
  authorCss: string | null;
}

const bases = new WeakMap<StoryBaseCssRecipe, string>();
const baseOf = (base: RawStorySheet['base']): string => {
  if (typeof base === 'string') return base;
  let css = bases.get(base);
  if (css === undefined) bases.set(base, css = storyBaseCss(base));
  return css;
};

/** The one `<style>` text and the render nodes, for raw parts. */
export function isolateStorySheet(raw: RawStorySheet, nodes: JsxNode[]): { css: string; nodes: JsxNode[] } {
  const parts = { baseCss: baseOf(raw.base), compiledCss: raw.compiledCss, authorCss: raw.authorCss };
  return { css: inlineStoryCss(parts), nodes: inlineStoryNodes(nodes, parts) };
}

/** Nodes against an already isolated sheet — only when the raw parts cannot be had. */
export function isolateAgainst(css: string, nodes: JsxNode[]): JsxNode[] {
  return inlineStoryNodes(nodes, { baseCss: css, compiledCss: null, authorCss: null });
}

export type InlineSheetPolicy = typeof import('./inline-sheet');

/**
 * THE KIT'S CLASS RECIPES. Each kit family (lib/islands/contract `KIT_FAMILIES`) owns one module here
 * exporting `RECIPES: Record<tag, (props) => string>` — the class string the retired React component renders
 * for those props. The compiler evaluates them AT COMPILE TIME (with `cn`), so readers never download
 * cva, clsx or tailwind-merge. This index merges the families into one table keyed by component tag;
 * a tag two families both claim is a build error, never a silent override.
 */
import { RECIPES as accordion } from './accordion';
import { RECIPES as basic } from './basic';
import { RECIPES as controls } from './controls';
import { RECIPES as upload } from './upload';
import { RECIPES as data } from './data';
import { RECIPES as cells } from './cells';
import { RECIPES as dialog } from './dialog';
import { RECIPES as embed } from './embed';
import { RECIPES as disclosure } from './disclosure';
import { RECIPES as files } from './files';
import { RECIPES as mermaid } from './mermaid';
import { RECIPES as people } from './people';
import { RECIPES as tabs } from './tabs';
import { RECIPES as staticKit } from './static';
import type { KitFamily } from '../../contract';

export { cn } from './cn';

/** One component's recipe: its props → the class string its root element carries. */
export type Recipe = (props: Record<string, unknown>) => string;

/** The recipes of each kit family (scripts/generate-story-ui-classes maps a tag to its family's sources). */
export const FAMILIES: Readonly<Record<KitFamily, Readonly<Record<string, Recipe>>>> = { basic, tabs, accordion, dialog, disclosure, controls, upload, data, files, people, mermaid, embed, cells, static: staticKit };

function merge(families: typeof FAMILIES): Readonly<Record<string, Recipe>> {
  const merged: Record<string, Recipe> = {};
  const owner: Record<string, string> = {};
  for (const [family, recipes] of Object.entries(families)) {
    for (const [tag, recipe] of Object.entries(recipes)) {
      if (owner[tag]) throw new Error(`kit recipes: <${tag}> is claimed by both ${owner[tag]} and ${family}`);
      owner[tag] = family;
      merged[tag] = recipe;
    }
  }
  return merged;
}

/** Every family's recipes, keyed by component tag. */
export const RECIPES: Readonly<Record<string, Recipe>> = merge(FAMILIES);

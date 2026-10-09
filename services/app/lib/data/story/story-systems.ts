/**
 * Design systems — the thirteen a document names in its fence `theme` beside the six themes
 * (./story-themes). A system is a theme with a whole vocabulary: its own `--ds-*` tokens with the
 * contract keys pointed at them, Google-hosted faces at every weight the type roles use, type-role
 * classes, components, the drawing hand and the page-type kit. The agent writes no CSS: it names
 * the system and uses the classes the reference lists.
 *
 * The data is GENERATED (`npm run generate:design-systems`, from design-systems/specs, the same
 * specs that build the published specimen pages and the agent's references; scripts/__tests__
 * fails on drift), reviewed in the diff and committed. It is two files, because the two emitters
 * that place it live on different sides of the wire:
 *
 *  - VARIABLES (this module, story-systems.json: a few kilobytes per system) ride the compiled
 *    sheet's theme suffix, through storyThemeCss (./story-themes): `:root:where([data-theme="x"])`
 *    and its `.dark` override, exactly the themes' selectors, so they sit after the neutral
 *    `:root`/`.dark` defaults, tie their specificity, and an authored `:root { --ds-volt: … }` later
 *    in the document still wins. The reader keeps only its own system's block; the compile version
 *    hashes them, so a changed system recompiles stale rows. The theme module reaches the browser
 *    (the editor's picker, the offline file), and this registry with it.
 *  - FONTS AND CLASSES (./story-system-sheets, story-system-sheets.json: half a megabyte in all) ride
 *    the document's base sheet (lib/compiled-page/styles/story-base-css, via the recipe prepare-runtime
 *    fills) and the standalone document's style tags (lib/compiled-page/styles/document-styles): per
 *    document, never stored, so thirteen systems do not sit in every compiled sheet, and never in
 *    the browser bundle, which rebuilds the base sheet from the recipe's TEXT. Classes are scoped
 *    `:where(:root[data-theme="x"]) .t-label`, at one class of specificity, so an authored rule for
 *    the same class wins by coming later.
 */
import systems from './story-systems.json';
import { STORY_SYSTEM_NAMES, type StorySystemName } from '@/lib/validation/story-system-names';

export { STORY_SYSTEM_NAMES };

export interface StorySystem {
  name: StorySystemName;
  /** The display name: `Volta`. */
  label: string;
  /** The tagline and the jobs it is for. */
  description: string;
  /** The mode the system opens in when the author pinned no `colorMode`. */
  defaultMode: 'light' | 'dark';
  /** The light block: every `--ds-*` token, the contract keys pointed at them, `--radius` and the three `--font-*` stacks. */
  cssVars: Record<string, string>;
  /** The dark override: the same tokens and contract keys minus radius and fonts. */
  darkCssVars: Record<string, string>;
}

export const STORY_SYSTEMS: readonly StorySystem[] = systems as unknown as StorySystem[];

/** Registry lookup by name (undefined for a theme, unknown or null). */
export function getStorySystem(name: string | null | undefined): StorySystem | undefined {
  return STORY_SYSTEMS.find((s) => s.name === name);
}

/**
 * THE STORED STYLESHEET VERSION of a prepared page (`prepared_pages.css_version`). A prepared page stores its
 * whole inline sheet: the compiled Tailwind AND the base sheet (bare typography and controls, chrome, embeds,
 * tables, column — lib/story/styles/story-base-css). The Tailwind compile environment alone
 * (`storyCssCompileVersion`) does not see a base-sheet change, so a page prepared before one kept serving the old
 * rules. This version hashes both: a stored page whose version differs is served once more and re-prepared in the
 * background (lib/story/prepared/prepared-page.server), and the backfill's `--stale` selects it.
 */
import { storyCssCompileVersion } from '@/lib/data/story/story-css.server';
import { STORY_BASE_SHEETS } from '../styles/story-base-css';
import { STORY_SYSTEMS_SHEET } from '@/lib/data/story/story-system-sheets';

/** djb2 — stability matters, cryptographic strength does not (as storyCssCompileVersion). */
const djb2 = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** The version of a sheet compiled under `compileVersion` with these base sheets. Pure, for tests. */
export const stylesheetVersion = (compileVersion: string, sheets: readonly string[]): string => `${compileVersion}.${djb2(sheets.join('\n'))}`;

let current: string | null = null;
/** This deployment's stored stylesheet version. */
export function preparedCssVersion(): string {
  // A design system's faces and classes ride the base sheet of the documents that name it (story-base-css recipe.systemCss).
  current ??= stylesheetVersion(storyCssCompileVersion(), [...STORY_BASE_SHEETS, STORY_SYSTEMS_SHEET]);
  return current;
}

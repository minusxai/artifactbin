/**
 * The design systems' SHEETS: per system, the `@font-face` rules for every family, weight and style
 * its type roles use (on Google's font host) and the class css — type roles, components, the hand
 * and the page-type kit, scoped to the document root's `data-theme`. Generated with the registry
 * (./story-systems, `npm run generate:design-systems`) and kept apart from it on purpose: this is
 * half a megabyte the server reads per document (lib/story/prepared/prepare-runtime.server fills the
 * base-sheet recipe with the TEXT) and the CLI reads for a local render, and the browser never
 * carries. Nothing a browser bundle reaches may import this module.
 */
import sheets from './story-system-sheets.json';
import { STORY_SYSTEM_NAMES, type StorySystemName } from '@/lib/validation/story-system-names';

export interface StorySystemSheet {
  /** `@font-face` rules for every family, weight and style the type roles use, on Google's font host. */
  fontFaces: string;
  /** Type roles, components, the hand and the page-type kit, scoped to the document root's `data-theme`. */
  css: string;
}

export const STORY_SYSTEM_SHEETS: Readonly<Record<StorySystemName, StorySystemSheet>> = sheets as unknown as Record<StorySystemName, StorySystemSheet>;

/** The per-document sheet a system adds to the base sheet: its faces, then its classes. Empty for a theme or no design. */
export function storySystemSheetCss(name: string | null | undefined): string {
  const sheet = name && (STORY_SYSTEM_NAMES as readonly string[]).includes(name) ? STORY_SYSTEM_SHEETS[name as StorySystemName] : undefined;
  return sheet ? `${sheet.fontFaces}\n${sheet.css}` : '';
}

/** Every system's base-sheet contribution, for the prepared pages' stylesheet version (lib/story/prepared/css-version.server): a changed face or class re-prepares the stored pages that carry it. */
export const STORY_SYSTEMS_SHEET: string = STORY_SYSTEM_NAMES.map((name) => storySystemSheetCss(name)).join('\n');

/**
 * The six story design themes, as plain data. This module imports NOTHING:
 * the reader route needs the names (to resolve a document's light/dark mode)
 * and must not pay for the TypeBox schemas that validate them
 * (lib/__tests__/reader-bundle-hygiene). `lib/validation/atlas-schemas.ts`
 * builds its enum from this list, and the theme registry
 * (`lib/data/story/story-themes.ts`) types its entries against it; a registry
 * test asserts one entry per name.
 */
export const STORY_THEME_NAMES = ['modernist', 'organic', 'industry', 'terminal', 'manuscript', 'pop'] as const;
export type StoryThemeName = (typeof STORY_THEME_NAMES)[number];

import type { StorySystemName } from './story-system-names';
/** What a fence `theme` may name: one of the six themes, or one of the design systems (./story-system-names). */
export type StoryDesignName = StoryThemeName | StorySystemName;

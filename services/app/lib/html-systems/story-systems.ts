/** Generated design-picker metadata from the shared native HTML system specifications. */
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

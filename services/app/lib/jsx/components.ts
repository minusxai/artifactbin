import { STORY_UI_COMPONENT_NAME_LIST } from './component-names';

/**
 * The component names allowed in a NEW-format (`format:'jsx'`) story body: the live embeds
 * plus the real shadcn/ui registry (lib/story-ui). Names only — no component
 * import, so server-side validation stays headless. The legacy invented components
 * (STORY_COMPONENT_NAMES) are deliberately absent: new stories must use shadcn. The data
 * components' earlier names (`Question`, `Number`) are absent too: the parser canonicalises them
 * (component-names COMPONENT_ALIASES) before anything checks a tag.
 */
export const JSX_STORY_COMPONENT_NAMES = ['Chart', 'Cell', ...STORY_UI_COMPONENT_NAME_LIST];

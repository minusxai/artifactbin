import { STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';

/**
 * The component names allowed in a NEW-format (`format:'jsx'`) story body (
 * §2): the live embeds plus the real shadcn/ui registry (lib/story-ui). Names only — no React
 * import, so server-side validation stays headless. The legacy invented components
 * (STORY_COMPONENT_NAMES) are deliberately absent: new stories must use shadcn.
 */
export const JSX_STORY_COMPONENT_NAMES = ['Question', 'Number', ...STORY_UI_COMPONENT_NAME_LIST];

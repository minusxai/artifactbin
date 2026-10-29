/** The validation module's interface: what code outside lib/validation imports (rule 4, scripts/ci/module-graph.mjs). */
export {
  ColumnFormatConfig, STORY_DESIGN_NAMES, STORY_TEMPLATE_NAMES, VizEnvelope, VizRecipeBinding, VizRecipeContent, VizRecipeParam,
} from './atlas-schemas';
export type { StoryTemplateName } from './atlas-schemas';
export { STORY_SYSTEM_NAMES } from './story-system-names';
export type { StorySystemName } from './story-system-names';
export type { StoryDesignName, StoryThemeName } from './story-theme-names';

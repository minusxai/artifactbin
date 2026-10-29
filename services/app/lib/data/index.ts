/** The data module's interface: what code outside lib/data imports (rule 4, scripts/ci/module-graph.mjs). */
export { RUNTIME_CLASS_LIMIT, isRuntimeClassToken } from './story/story-css';
export { compileStoryCssWithExtras, currentStoryCss, storyCssCompileVersion } from './story/story-css.server';
export { STORY_FAMILY_ASSETS, STORY_FONTS_ATTR, getStoryFontCss, storyFontFaceCss } from './story/story-fonts';
export type { StoryFontAsset } from './story/story-fonts';
export type { MermaidEmbed, MermaidEmbedEdit } from './story/story-mermaid';
export type { StorySystem } from './story/story-systems';
export { STORY_THEMES, resolveStoredStoryDesign } from './story/story-themes';
export { default as storyFontManifest } from './story/story-font-manifest.json';

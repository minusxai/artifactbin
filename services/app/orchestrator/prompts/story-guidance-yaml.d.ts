// Native, typed import of the story-guidance YAML (same mechanics as prompts-yaml.d.ts:
// @rollup/plugin-yaml parses it for Vitest; the runtime reads and parses the file itself;
// this declaration supplies the TYPE TypeScript cannot infer from a YAML file).
declare module '*/story-guidance.yaml' {
  /** One template's prose definition — the registry adds the `name` key. */
  export interface StoryTemplateGuidanceEntry {
    label: string;
    description: string;
    personality: string;
    beats: string[];
  }
  interface StoryGuidanceDoc {
    /** Full template definitions, keyed by STORY_TEMPLATE_NAMES values. */
    templates: Record<string, StoryTemplateGuidanceEntry>;
    /** Reserved; a theme's authoring guidance lives in `skills/themes/<name>.md`. */
    themes: Record<string, never>;
  }
  const doc: StoryGuidanceDoc;
  export default doc;
}

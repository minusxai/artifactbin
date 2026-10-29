/**
 * `lib/data/story/story-guidance.yaml`, parsed once at first use. A
 * runtime read rather than a bundler loader: the file is the truth the docs
 * and the validator project, and it ships beside the server as a file on disk
 * (minusxai/artifactbin-server copies it by that path), not inside a bundle.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/** One template's prose definition — the registry adds the `name` key. */
interface StoryTemplateGuidanceEntry {
  label: string;
  description: string;
  personality: string;
  beats: string[];
}
interface StoryGuidance {
  /** Full template definitions, keyed by STORY_TEMPLATE_NAMES values. */
  templates: Record<string, StoryTemplateGuidanceEntry>;
  /** Reserved; a theme's authoring guidance lives in `skills/artifactbin/references/themes-<name>.md`. */
  themes: Record<string, never>;
}

let cached: StoryGuidance | null = null;
export function storyGuidance(): StoryGuidance {
  if (!cached) cached = YAML.parse(readFileSync(path.resolve(process.cwd(), 'lib/data/story/story-guidance.yaml'), 'utf8')) as StoryGuidance;
  return cached;
}

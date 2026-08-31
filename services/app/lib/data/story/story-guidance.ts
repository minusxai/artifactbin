/**
 * `orchestrator/prompts/story-guidance.yaml`, parsed once at first use. A
 * runtime read rather than a bundler loader: the file is the truth the docs
 * and the validator project, and it ships beside the server (Dockerfile
 * copies `orchestrator/`), not inside a bundle.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type StoryGuidance from '@/orchestrator/prompts/story-guidance.yaml';

let cached: typeof StoryGuidance | null = null;
export function storyGuidance(): typeof StoryGuidance {
  if (!cached) cached = YAML.parse(readFileSync(path.resolve(process.cwd(), 'orchestrator/prompts/story-guidance.yaml'), 'utf8')) as typeof StoryGuidance;
  return cached;
}

/**
 * Story templates — the structural-genre registry next to the design themes (story-themes.ts).
 *
 * A template is the document's GENRE: its beat structure and layout grammar (editorial long-read,
 * slide deck, scrollytelling) — orthogonal to the design theme, which is purely
 * a token set. Templates carry NO runtime CSS: `content.template` is metadata, and the `guidance`
 * mini-skill returned with the Clarify `type: 'template'` pick drives what the agent authors.
 *
 * The prose (labels, personalities, beats) is human-edited in
 * `orchestrator/prompts/story-guidance.yaml`; this module is the thin typed projection over it.
 * A genre's full authoring guidance — and a theme's — is a docs file
 * (`skills/templates/<name>.md`, `skills/themes/<name>.md`), the one copy agents read.
 *
 * Consumers: the Clarify handler (lib/tools/handlers/clarify.ts — fat pick payloads and the
 * "Figure it out" catalogs) and the option projection (lib/branding/story-template-options.ts).
 */
import type { StoryTemplateName } from '@/lib/validation/atlas-schemas';
import { STORY_TEMPLATE_NAMES } from '@/lib/validation/atlas-schemas';
import { storyGuidance } from './story-guidance';

export type { StoryTemplateName };
export { STORY_TEMPLATE_NAMES };

export interface StoryTemplate {
  /** The schema enum value — what `<template>…</template>` carries. */
  name: StoryTemplateName;
  /** Short human label for the picker card. */
  label: string;
  /** One-line summary (picker card + `description` in the clarify result). */
  description: string;
  /** 2–3 sentence voice/personality statement. */
  personality: string;
  /** Ordered beat names — the section skeleton of the genre. */
  beats: string[];
}

export const STORY_TEMPLATES: StoryTemplate[] = STORY_TEMPLATE_NAMES.map((name) => {
  const entry = storyGuidance().templates[name];
  if (!entry) throw new Error(`story-guidance.yaml is missing templates.${name}`);
  return { name, ...entry };
});

/** Registry lookup by template name; undefined for unknown/absent names. */
export function getStoryTemplate(name: string | null | undefined): StoryTemplate | undefined {
  return STORY_TEMPLATES.find((t) => t.name === name);
}

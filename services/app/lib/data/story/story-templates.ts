/**
 * Story templates — the structural-genre registry next to the design themes (story-themes.ts).
 *
 * A template is the document's GENRE: its beat structure and layout grammar (editorial long-read,
 * slide deck, scrollytelling). The design system owns visual treatment, including page grounds,
 * type roles and component CSS. Templates carry NO runtime CSS here: the reader uses
 * `content.template` for navigation behaviour, and the guide offers compositions to authors.
 *
 * The prose (labels, personalities, beats) is human-edited in
 * `story-guidance.yaml`; this module is the thin typed projection over it.
 * A genre's full authoring guidance — and a theme's — is a docs file
 * (`skills/artifactbin/references/templates-<name>.md`, `…/themes-<name>.md`), the one copy
 * agents read.
 *
 * Consumer: the skill registry (lib/skills/render.ts), which projects this registry into
 * those docs.
 */
import type { StoryTemplateName } from '@/lib/validation/atlas-schemas';
import { STORY_TEMPLATE_NAMES } from '@/lib/validation/atlas-schemas';
import { storyGuidance } from './story-guidance';

export { STORY_TEMPLATE_NAMES };

interface StoryTemplate {
  /** The schema enum value — what `<template>…</template>` carries. */
  name: StoryTemplateName;
  /** Short human label for the picker card. */
  label: string;
  /** One-line summary for the picker card. */
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


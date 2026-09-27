/**
 * THE inline reader's story tree — one composition, rendered to a string by the
 * server (ssr-entry renderInlineStory) and hydrated with the same props by the
 * browser (InlineStoryRuntime), so the two agree by construction.
 *
 * SEED (Track E): the signatures are the contract; the bodies reproduce today's
 * client-only behaviour and are expected to change.
 */
import type { ReactNode } from 'react';
import { ArtifactDialogScope } from '@/components/kit/dialog';
import { isolateStoryCss } from '@/lib/story/inline-css';
import { StoryRuntimeApp } from './StoryRuntimeApp';
import type { StoryIslandData } from './contract';

export interface InlineStoryCssParts { baseCss: string; compiledCss: string | null; authorCss: string | null }

/** The one CSS string both sides put in the story's `<style>`. */
export function inlineStoryCss(parts: InlineStoryCssParts): string {
  return isolateStoryCss([parts.baseCss, parts.compiledCss, parts.authorCss].filter(Boolean).join('\n'));
}

export function InlineStoryComposition({ data, css }: { data: StoryIslandData; css: string }): ReactNode {
  return <><style>{css}</style><ArtifactDialogScope><StoryRuntimeApp {...data} /></ArtifactDialogScope></>;
}

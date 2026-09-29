/** Compatibility rendering for the standalone reader until its track is merged. */
import type { StorySsrBundle } from '@/lib/story-runtime/contract';
import type { ServedStoryRuntime } from './prepared-runtime';
import { applyStyleOverrides } from './style-overrides';
import { inlineStoryElement } from '@/lib/compiled-page/story-element';

export function servedStoryHtml(runtime: ServedStoryRuntime & { css: string }, render: StorySsrBundle['renderInlineStory']): string {
  const body = render({ ...runtime.data, nodes: applyStyleOverrides(runtime.data.nodes, runtime.overrides) }, runtime.css);
  return inlineStoryElement(body, runtime.data.colorMode, runtime.theme);
}

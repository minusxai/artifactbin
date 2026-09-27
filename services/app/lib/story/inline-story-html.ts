/**
 * The DOCUMENT STORY the app page serves for the inline reader to adopt
 * (server/app withInitialStory): the story element, carrying the attributes
 * the runtime keeps on it, around the composition's server render
 * (lib/story-runtime/inline-composition). The browser hydrates exactly this
 * element, so its content is the composition with the same `data` and `css`
 * InlineStoryRuntime passes. Pure, so a test can build the page the server does.
 */
import { STORY_ROOT_ATTR } from '@/lib/story-surface';
import type { StorySsrBundle } from '@/lib/story-runtime/contract';
import type { PreparedStoryRuntime, ServedStoryRuntime } from './prepared-runtime';
import { applyStyleOverrides } from './style-overrides';
import { inlineStoryCss, inlineStoryNodes } from './inline-css';
import { escapeHtml } from './reader-chrome';

/** The story element around a composition's server render. */
export function inlineStoryElement(body: string, colorMode: string, theme: string | null): string {
  return `<div data-mx-inline-story="" ${STORY_ROOT_ATTR} class="${escapeHtml(colorMode)}"${theme ? ` data-theme="${escapeHtml(theme)}"` : ''}>${body}</div>`;
}

/** `render` is the SSR bundle's renderInlineStory (lib/story/ssr.server), or its source in a test. */
export function inlineStoryHtml(runtime: PreparedStoryRuntime, render: StorySsrBundle['renderInlineStory']): string {
  const body = render({ ...runtime.data, nodes: inlineStoryNodes(runtime.data.nodes, runtime) }, inlineStoryCss(runtime));
  return inlineStoryElement(body, runtime.data.colorMode, runtime.theme);
}

/** The same element for a served runtime (lib/story/prepared-runtime): its sheet and nodes are already isolated. */
export function servedStoryHtml(runtime: ServedStoryRuntime & { css: string }, render: StorySsrBundle['renderInlineStory']): string {
  const body = render({ ...runtime.data, nodes: applyStyleOverrides(runtime.data.nodes, runtime.overrides) }, runtime.css);
  return inlineStoryElement(body, runtime.data.colorMode, runtime.theme);
}

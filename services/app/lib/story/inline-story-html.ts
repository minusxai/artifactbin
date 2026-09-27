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
import type { PreparedStoryRuntime } from './prepared-runtime';
import { inlineStoryCss, inlineStoryNodes } from './inline-css';
import { escapeHtml } from './reader-chrome';

/** `render` is the SSR bundle's renderInlineStory (lib/story/ssr.server), or its source in a test. */
export function inlineStoryHtml(runtime: PreparedStoryRuntime, render: StorySsrBundle['renderInlineStory']): string {
  const body = render({ ...runtime.data, nodes: inlineStoryNodes(runtime.data.nodes, runtime) }, inlineStoryCss(runtime));
  return `<div data-mx-inline-story="" ${STORY_ROOT_ATTR} class="${escapeHtml(runtime.data.colorMode)}"${runtime.theme ? ` data-theme="${escapeHtml(runtime.theme)}"` : ''}>${body}</div>`;
}

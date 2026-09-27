/**
 * The server-render half of the runtime — bundled to
 * lib/story-runtime/dist/story-ssr.cjs by scripts/build-story-runtime.mjs and
 * loaded by lib/story/ssr.server.ts. The self-contained bundle carries React
 * and accepts plain document data across the server rendering boundary.
 *
 * Same StoryRuntimeApp as the browser entry hydrates — one composition on
 * both sides is what makes hydration match by construction.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StoryRuntimeApp } from './StoryRuntimeApp';
import type { StoryIslandData } from './contract';

// Expose server-rendered icon glyphs through the same prebuilt renderer.
export { glyphsForNodes } from '@/lib/story/icon-glyphs';

export function renderStoryBody(data: StoryIslandData): string {
  return renderToString(createElement(StoryRuntimeApp, data));
}

/**
 * The inline reader's composition as a string (lib/story-runtime/inline-composition).
 * SEED (Track E): today's server render, which the client does not hydrate.
 */
export function renderInlineStory(data: StoryIslandData, _css: string): string {
  return renderToString(createElement(StoryRuntimeApp, data));
}

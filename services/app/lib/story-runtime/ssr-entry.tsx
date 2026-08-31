/**
 * The server-render half of the runtime — bundled to
 * lib/story-runtime/dist/story-ssr.cjs by scripts/build-story-runtime.mjs and
 * loaded by lib/story/document.ts OUTSIDE the Next module graph (route
 * handlers compile under the react-server condition, which forbids the
 * client-React APIs the kit needs; a self-contained esbuild bundle carries its
 * own full React, so the constraint never applies).
 *
 * Same StoryRuntimeApp as the browser entry hydrates — one composition on
 * both sides is what makes hydration match by construction.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StoryRuntimeApp } from './StoryRuntimeApp';
import type { StoryIslandData } from './contract';

/*
 * Re-exported through the SSR bundle because document.ts cannot import it: the
 * resolver renders lucide's client components, and route handlers compile under
 * the react-server condition. This bundle carries its own full React, so the
 * constraint never applies here.
 */
export { glyphsForNodes } from '@/lib/story/icon-glyphs';

export function renderStoryBody(data: StoryIslandData): string {
  return renderToString(createElement(StoryRuntimeApp, data));
}

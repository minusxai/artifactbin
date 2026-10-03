/**
 * THE READER'S SELECTION REACHES THE ADDRESS BAR FROM INSIDE THE FRAME (solid/document/create-framed-story): the
 * document framed on its own origin posts its link's `$` params (lib/islands/url-sync → STORY_URL_VALUES_MESSAGE),
 * and the app page puts exactly those in its own address — path, hash and every other param kept, replaced rather
 * than pushed — so a copied link or a reload carries the selection. Only its own frame's window and origin count.
 */
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { STORY_URL_VALUES_MESSAGE } from '@/lib/story-runtime/contract';
import { createFramedStory, followFramedValues } from '../create-framed-story';

const PAGES = 'https://6869.pages.test';
const start = window.location.href;
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.innerHTML = ''; window.history.replaceState(null, '', start); });

function framedPage() {
  const frame = document.createElement('iframe');
  frame.setAttribute('data-mx-document-frame', '');
  document.body.append(frame);
  createRoot((dispose) => {
    createFramedStory({ id: 'doc1', framed: { frame, origin: PAGES }, nodes: [], editId: () => 'e1', source: () => null });
    cleanups.push(dispose);
  });
  const fromFrame = (search: unknown, origin = PAGES, source: Window | null = frame.contentWindow) =>
    window.dispatchEvent(new MessageEvent('message', { data: { type: STORY_URL_VALUES_MESSAGE, search }, origin, source }));
  return { frame, fromFrame };
}

describe('the app page\'s address follows its framed document\'s selection', () => {
  it('takes the document\'s `$` params into its own address, keeping the path, the hash and every other param', () => {
    window.history.replaceState({ router: 1 }, '', '/a/doc1?version=3&$region=west#chart');
    const length = window.history.length;
    const { fromFrame } = framedPage();
    fromFrame('?$region=east&$zoom=3');
    expect(window.location.pathname).toBe('/a/doc1');
    expect(window.location.search).toBe('?version=3&$region=east&$zoom=3');
    expect(window.location.hash).toBe('#chart');
    expect(window.history.length, 'replaced, not pushed').toBe(length);
    expect(window.history.state, 'the router\'s state survives').toEqual({ router: 1 });

    // Back at rest: the selection leaves the address, the rest stays.
    fromFrame('');
    expect(window.location.search).toBe('?version=3');
    expect(window.location.hash).toBe('#chart');
  });

  it('ignores another window, another origin, a hash, and anything that is not a `$` param', () => {
    window.history.replaceState(null, '', '/a/doc1?$region=west');
    const { fromFrame } = framedPage();
    fromFrame('?$region=east', 'https://evil.test');
    fromFrame('?$region=east', PAGES, window);
    fromFrame('?$region=east#elsewhere');
    expect(window.location.href).toBe(new URL('/a/doc1?$region=west', start).href);
    fromFrame('?intent=fork&$region=east');
    expect(window.location.search).toBe('?$region=east');
  });

  it('rewrites nothing when the address already says it', () => {
    window.history.replaceState(null, '', '/a/doc1?$region=east');
    let writes = 0;
    const fake = { location: window.location, history: { state: null, replaceState: () => { writes++; } } } as unknown as Window;
    followFramedValues(fake, '?$region=east');
    expect(writes).toBe(0);
    followFramedValues(fake, '?$region=west');
    expect(writes).toBe(1);
  });
});

/**
 * THE KIT LOADS PER DOCUMENT, AND BEFORE HYDRATION (lib/story-runtime/kit-registry).
 *
 * Both reader runtimes draw a document's components from chunks loaded on
 * demand. What must hold, on each path: nothing hydrates until every chunk the
 * document draws is here (so the first client render is the server's), no
 * chunk the document does not draw is loaded, and a later version that draws a
 * new component lands only once its chunk has — never a render without it.
 *
 * The suite registers every chunk up front (test/setup/vitest.setup.ui.ts);
 * each case here starts from an empty registry, as a fresh page does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { captureInitialStory, clearInitialStory } from '@/web/initial-story';
import { servedStoryHtml } from '@/lib/story/inline-story-html';
import type { ServedStoryRuntime } from '@/lib/story/prepared-runtime';
import { inlineStoryCss } from '@/lib/story/inline-css';
import { STORY_DOCUMENT_MESSAGE, STORY_ISLAND_ID, STORY_ROOT_ID, type StoryIslandData } from '../contract';
import { InlineStoryRuntime, type InlineStoryController } from '../InlineStoryRuntime';
import { renderInlineStory, renderStoryBody } from '../ssr-entry';
import { kitLoaded, resetKitRegistry } from '../kit-registry';
import { registerAllKitChunks } from '../kit/all';
import { KIT_CHUNK_IDS, kitChunksOf } from '@/lib/story-ui/kit-chunks';

const KIT = `<article>
  <h1>Hydrate me <Badge>beta</Badge></h1>
  <Alert><AlertTitle>Heads up</AlertTitle></Alert>
  <Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList>
    <TabsContent value="one"><p>first</p></TabsContent><TabsContent value="two"><p>second</p></TabsContent></Tabs>
  <Card><CardHeader><CardTitle>Card</CardTitle></CardHeader><CardContent>body</CardContent></Card>
</article>`;
const DRAWN = ['card', 'badge', 'alert', 'tabs'] as const;

const island = (source: string): StoryIslandData => ({ nodes: parseJsxOrThrow(source).nodes, refData: {}, colorMode: 'light', template: null, chrome: true } as StoryIslandData);
const servedRuntime = (source: string): ServedStoryRuntime & { css: string } => {
  const css = inlineStoryCss({ baseCss: 'body{margin:0}', compiledCss: null, authorCss: null });
  return { data: island(source), css, overrides: [], base: { chrome: true, theme: null, faces: [], fonts: { slots: {}, families: [] } }, authorScript: null, theme: null, title: 'kit' };
};

/** Every console error and React-reported error, for the "no mismatch" half of each case. */
function collectErrors() {
  const errors: unknown[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
  return errors;
}

afterEach(() => {
  clearInitialStory();
  vi.restoreAllMocks();
  vi.doUnmock('react-dom/client');
  document.body.innerHTML = '';
  // Back to the suite's state for whatever runs next in this file.
  registerAllKitChunks();
});

describe('the reader page (InlineStoryRuntime)', () => {
  it('adopts and hydrates the server story only after the chunks it draws have loaded — and loads no others', async () => {
    const runtime = servedRuntime(KIT);
    // The server render: every chunk registered, as the SSR bundle has them.
    document.body.innerHTML = `<div id="root"></div><div data-mx-initial-story="">${servedStoryHtml(runtime, renderInlineStory)}</div>`;
    const story = document.querySelector<HTMLElement>('[data-mx-inline-story]')!;
    const serverNodes = [...story.querySelectorAll('*')];
    captureInitialStory();
    resetKitRegistry();
    const errors = collectErrors();
    const app = createRoot(document.getElementById('root')!, { onRecoverableError: (e) => errors.push(e), onCaughtError: (e) => errors.push(e), onUncaughtError: (e) => errors.push(e) });
    let controller: InlineStoryController | null = null;

    act(() => { app.render(<InlineStoryRuntime data={runtime.data} prepared={runtime} onController={(c) => { controller = c; }} hydrateInitialStory />); });
    // Committed, effects run, and still nothing taken: the server's wrapper holds its story, no runtime lifetime exists.
    expect(document.querySelector('[data-mx-initial-story]')?.contains(story)).toBe(true);
    expect(controller).toBeNull();
    expect(kitLoaded(DRAWN)).toBe(false);

    await act(async () => { await vi.dynamicImportSettled(); });
    await act(async () => {});
    expect(kitLoaded(DRAWN)).toBe(true);
    expect(KIT_CHUNK_IDS.filter((id) => !DRAWN.includes(id as never) && kitLoaded([id]))).toEqual([]);
    expect(controller).not.toBeNull();
    // Adopted into the app and hydrated: the server's element and every element it drew are React's now.
    expect(document.querySelector('[data-mx-initial-story]')).toBeNull();
    expect(document.getElementById('root')!.contains(story)).toBe(true);
    expect(serverNodes.filter((n) => !story.contains(n)).map((n) => n.outerHTML.slice(0, 80))).toEqual([]);
    expect(errors).toEqual([]);
    await act(async () => { app.unmount(); });
  });

  it('holds a later version that draws a new component until that component has loaded, then lands it whole', async () => {
    resetKitRegistry();
    const errors = collectErrors();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createRoot(host);
    let controller: InlineStoryController | null = null;
    const prose = island('<article><h1>Plain</h1><p>words</p></article>');
    await act(async () => { app.render(<InlineStoryRuntime data={prose} onController={(c) => { controller = c; }} />); });
    expect(controller).not.toBeNull();
    expect(kitLoaded(['badge'])).toBe(false);

    const next = island('<article><h1>Second</h1><p>words <Badge>new</Badge></p></article>');
    // A prepared version, its sheet in hand: nothing but the new chunk stands between it and the page.
    const sheet = { css: servedRuntime('').css, overrides: [], base: servedRuntime('').base };
    act(() => { controller!.update({ type: STORY_DOCUMENT_MESSAGE, nodes: next.nodes, sheet }); });
    // Not rendered without its component: the old version stands, whole.
    expect(host.querySelector('h1')?.textContent).toBe('Plain');
    expect(host.textContent).not.toContain('new');

    await act(async () => { await vi.dynamicImportSettled(); });
    await act(async () => {});
    expect(kitLoaded(['badge'])).toBe(true);
    expect(host.querySelector('h1')?.textContent).toBe('Second');
    expect(host.querySelector('[data-slot="badge"]')?.textContent ?? host.textContent).toContain('new');
    expect(errors).toEqual([]);
    await act(async () => { app.unmount(); });
  });
});

describe('the served document (the /story entry)', () => {
  it('awaits the chunks its island draws before it hydrates', async () => {
    const data = island(KIT);
    document.body.innerHTML = `<div id="${STORY_ROOT_ID}">${renderStoryBody(data)}</div><script type="application/json" id="${STORY_ISLAND_ID}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
    // A fresh page: the entry's own module graph, its own (empty) registry, and a hydrateRoot that records what was loaded when it was called.
    vi.resetModules();
    const registry = await import('../kit-registry');
    const loadedAtHydrate: boolean[] = [];
    vi.doMock('react-dom/client', async (original) => {
      const actual = await original<typeof import('react-dom/client')>();
      return { ...actual, hydrateRoot: (...args: Parameters<typeof actual.hydrateRoot>) => { loadedAtHydrate.push(registry.kitLoaded(kitChunksOf(data.nodes))); return actual.hydrateRoot(...args); } };
    });
    collectErrors();
    await act(async () => { await import('../entry'); });
    await act(async () => { await vi.dynamicImportSettled(); });
    await act(async () => {});
    expect(loadedAtHydrate).toEqual([true]);
    expect(registry.kitLoaded(['data-table'])).toBe(false);
  });
});

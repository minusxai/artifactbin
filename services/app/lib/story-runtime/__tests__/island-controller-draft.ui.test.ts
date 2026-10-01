/**
 * Editor drafts drawn into the adopted compiled root (lib/story-runtime/island-controller): one draft
 * is applied at a time. Two applications interleaving across the island hydration await would hydrate
 * the one-tree root twice and remount the editor over a half-morphed DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const hold = vi.hoisted(() => ({ on: false }));
const engine = vi.hoisted(() => {
  const state = { active: 0, overlapped: false, applied: [] as string[], releases: [] as Array<() => void>, loads: [] as Array<() => void> };
  return {
    state,
    // Resolves at once unless a test holds it (a slow production module fetch).
    loadDraftModule: () => new Promise<null>((resolve) => { if (state.loads.length === 0 && !hold.on) resolve(null); else state.loads.push(() => resolve(null)); }),
    disposeChangedDraftIslands: () => {},
    blocker: null as string | null,
    readRestoreBlocker: () => engine.blocker,
    versionModuleUrl: (doc: Document) => doc.querySelector('script[type="module"]')?.getAttribute('src') ?? null,
    adopted: 0,
    adoptVersionRecord: () => { engine.adopted++; },
    morphDraftDom: (root: HTMLElement, next: HTMLElement) => { root.className = next.className; root.innerHTML = next.innerHTML; },
    hydrateDraftIslands: (_win: Window, root: HTMLElement) => {
      state.active++;
      if (state.active > 1) state.overlapped = true;
      state.applied.push(root.textContent ?? '');
      return new Promise<void>((resolve) => { state.releases.push(() => { state.active--; resolve(); }); });
    },
  };
});
vi.mock('@/lib/islands/morph/engine', () => engine);
const liveUpdate = vi.hoisted(() => ({ updateCompiledStory: vi.fn(async () => 'reloaded' as const) }));
vi.mock('@/lib/islands/live-update', () => liveUpdate);
const editSession = vi.hoisted(() => ({
  unmounts: 0,
  mounts: 0,
  session: {
    setNodes: () => {}, canApplyDraft: () => true, dispose: () => {}, onParentMessage: () => {},
    unmountCompiledDom: () => { editSession.unmounts++; },
    mountCompiledDom: async () => { editSession.mounts++; },
  },
}));
vi.mock('@/lib/story-runtime/edit/session', () => ({ createFrameEditSession: () => editSession.session }));
vi.mock('@/solid/editor/dom-mounter', () => ({ mountCompiledEditRegions: () => ({ dispose() {} }) }));

import { createIslandController, holdChartDrawings } from '../island-controller';
import { STORY_DOCUMENT_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_READER_MODE_MESSAGE } from '../contract';
import { createEditDraftSender } from '@/solid/editor/edit-draft';
import type { StoryThemeName } from '@/lib/validation/story-theme-names';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
// Time-bounded, not tick-bounded: the first dynamic import of a module is slow when other suites transform alongside.
const settle = async (until: () => boolean) => { for (const end = Date.now() + 5000; Date.now() < end && !until();) await tick(); };

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('island controller editor drafts', () => {
  it('applies one draft at a time and ends on the newest one', async () => {
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<p>v0</p>';
    document.body.append(root);
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const { source } = JSON.parse(String(init.body)) as { source: string };
      return new Response(JSON.stringify({ html: `<div data-mx-inline-story>${source}</div>` }), { status: 200 });
    });
    vi.spyOn(window, 'fetch').mockImplementation(fetch as typeof window.fetch);
    const controller = createIslandController({
      win: window, root, islands: null, nodes: [], id: 'doc', editId: () => 'e1',
      initialSource: () => '<p>v0</p>', portal: { current: null },
    });
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => editSession.mounts > 0);

    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>v1</p>', editId: 'e1', theme: null, colorMode: 'light' });
    await settle(() => engine.state.releases.length === 1);
    // A newer draft lands while the first is still hydrating.
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>v2</p>', editId: 'e2', theme: null, colorMode: 'light' });
    await settle(() => fetch.mock.calls.length === 2);
    await tick(); await tick();
    expect(engine.state.overlapped).toBe(false);
    engine.state.releases.shift()!();
    await settle(() => engine.state.releases.length === 1);
    engine.state.releases.shift()!();
    await settle(() => engine.state.active === 0 && engine.state.applied.length === 2);
    await tick();

    expect(engine.state.overlapped).toBe(false);
    expect(engine.state.applied).toEqual(['v1', 'v2']);
    expect(root.textContent).toBe('v2');
    // Every unmount of the editor is matched by its remount once the drafts settle.
    expect(editSession.mounts).toBe(editSession.unmounts + 1);
    controller.dispose();
  });

  it("keeps the editor mounted while a draft's module loads, and sends the reader's values with the draft", async () => {
    engine.state.applied.length = 0;
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<p>v0</p>';
    document.body.append(root);
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const { source } = JSON.parse(String(init.body)) as { source: string };
      return new Response(JSON.stringify({ html: `<div data-mx-inline-story>${source}</div>` }), { status: 200 });
    });
    vi.spyOn(window, 'fetch').mockImplementation(fetch as typeof window.fetch);
    window.history.replaceState(null, '', '/a/doc?$fruit=banana');
    const controller = createIslandController({
      win: window, root, islands: null, nodes: [], id: 'doc', editId: () => 'e1',
      initialSource: () => '<p>v0</p>', portal: { current: null },
    });
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => editSession.mounts > 0);
    const unmounts = editSession.unmounts;
    hold.on = true;
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>v1</p>', editId: 'e1', theme: null, colorMode: 'light' });
    await settle(() => engine.state.loads.length === 1);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).search).toBe('?$fruit=banana');
    // The module is still on its way: the page must not have taken the editable DOM away yet.
    expect(editSession.unmounts).toBe(unmounts);
    expect(root.textContent).toBe('v0');
    hold.on = false;
    engine.state.loads.shift()!();
    await settle(() => engine.state.releases.length === 1);
    expect(editSession.unmounts).toBe(unmounts + 1);
    engine.state.releases.shift()!();
    await settle(() => engine.state.active === 0);
    expect(root.textContent).toBe('v1');
    controller.dispose();
    window.history.replaceState(null, '', '/');
  });

  it('returns to reading IN PLACE after Done: the saved version drawn through the draft path, the islands back in read mode, no reload', async () => {
    engine.state.applied.length = 0;
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<p>v0</p>';
    document.body.append(root);
    let compiling = 2;
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith('/a/doc/story')) {
        // The saved version is still compiling for a moment: the draft stays on screen meanwhile.
        if (compiling-- > 0) return new Response('', { status: 409 });
        return new Response('<html><body><div data-mx-inline-story class="light"><p>saved v3</p></div></body></html>', { status: 200 });
      }
      return new Response('{}', { status: 500 });
    });
    vi.spyOn(window, 'fetch').mockImplementation(fetch as typeof window.fetch);
    const islands = { setMode: vi.fn(), mode: () => 'edit', store: null } as unknown as import('@/lib/islands/contract').IslandDocument;
    const controller = createIslandController({
      win: window, root, islands, nodes: [], id: 'doc', editId: () => 'e1',
      initialSource: () => '<p>v0</p>', portal: { current: null },
    });
    // The reader chose dark: the saved version's compiled colour must not replace it.
    controller.send({ type: STORY_READER_MODE_MESSAGE, mode: 'dark' });
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => editSession.mounts > 0);
    expect(islands.setMode).toHaveBeenLastCalledWith('edit');
    let restored = false;
    // Done: the page asks the islands back, and a version frame may land meanwhile (newest wins).
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: false });
    void controller.restored().then(() => { restored = true; });
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [] });
    await settle(() => fetch.mock.calls.length >= 2);
    expect(root.textContent, 'the last draft stays while the version compiles').toBe('v0');
    expect(restored).toBe(false);
    await vi.waitFor(() => expect(engine.state.releases).toHaveLength(1), { timeout: 3000 });
    engine.state.releases.shift()!();
    await settle(() => restored);

    expect(root.textContent).toBe('saved v3');
    expect(root.classList.contains('dark')).toBe(true);
    expect(islands.setMode).toHaveBeenLastCalledWith('read');
    expect(engine.adopted, 'the page runs the saved version\'s records now').toBe(1);
    expect(liveUpdate.updateCompiledStory).not.toHaveBeenCalled();
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/^\/a\/doc\/story\?/);
    // Reading again: the next version takes the reader's in-place morph.
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [] });
    expect(liveUpdate.updateCompiledStory).toHaveBeenCalledTimes(1);
    await expect(controller.restored()).resolves.toBeUndefined();
    controller.dispose();
  });

  it('does not draw again when the last draft is the saved version: its islands keep running, no chart redraws', async () => {
    engine.state.applied.length = 0;
    engine.adopted = 0;
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<p>v0</p>';
    document.body.append(root);
    const module = '<script type="module" src="/islands/d/abc.js"></script>';
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('draft-preview')) {
        const { source } = JSON.parse(String(init!.body)) as { source: string };
        return new Response(JSON.stringify({ html: `<html><body><div data-mx-inline-story>${source}</div>${module}</body></html>` }), { status: 200 });
      }
      return new Response(`<html><body><div data-mx-inline-story><p>v1</p></div>${module}</body></html>`, { status: 200 });
    });
    vi.spyOn(window, 'fetch').mockImplementation(fetch as typeof window.fetch);
    const islands = { setMode: vi.fn(), mode: () => 'edit', store: null } as unknown as import('@/lib/islands/contract').IslandDocument;
    const controller = createIslandController({
      win: window, root, islands, nodes: [], id: 'doc', editId: () => 'e1',
      initialSource: () => '<p>v0</p>', portal: { current: null },
    });
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => editSession.mounts > 0);
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>v1</p>', editId: 'e1', theme: null, colorMode: 'light' });
    await settle(() => engine.state.releases.length === 1);
    engine.state.releases.shift()!();
    await settle(() => engine.state.active === 0 && root.textContent === 'v1');
    const draws = engine.state.applied.length;

    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: false });
    await controller.restored();
    expect(engine.state.applied.length, 'the saved version is already on screen').toBe(draws);
    expect(root.textContent).toBe('v1');
    expect(islands.setMode).toHaveBeenLastCalledWith('read');
    expect(engine.adopted).toBe(1);
    controller.dispose();
  });

  it('rejects the return to reading when the version cannot be drawn in place (the page reloads)', async () => {
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<p>v0</p>';
    document.body.append(root);
    vi.spyOn(window, 'fetch').mockImplementation((async () => new Response('<html><body><div data-mx-inline-story><p>v4</p></div></body></html>', { status: 200 })) as typeof window.fetch);
    const islands = { setMode: vi.fn(), mode: () => 'edit', store: null } as unknown as import('@/lib/islands/contract').IslandDocument;
    const controller = createIslandController({
      win: window, root, islands, nodes: [], id: 'doc', editId: () => 'e1',
      initialSource: () => '<p>v0</p>', portal: { current: null },
    });
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => editSession.mounts > 0);
    engine.blocker = 'the island build changed under the page';
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: false });
    await expect(controller.restored()).rejects.toThrow('the island build changed under the page');
    expect(islands.setMode).not.toHaveBeenCalledWith('read');
    expect(root.textContent).toBe('v0');
    engine.blocker = null;
    controller.dispose();
  });

  it("sends the editor's current theme with every draft: a theme pick, then a text edit, compiles in that theme", async () => {
    engine.state.applied.length = 0;
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<p>v0</p>';
    document.body.append(root);
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const { source } = JSON.parse(String(init.body)) as { source: string };
      return new Response(JSON.stringify({ html: `<div data-mx-inline-story>${source}</div>` }), { status: 200 });
    });
    vi.spyOn(window, 'fetch').mockImplementation(fetch as typeof window.fetch);
    const controller = createIslandController({
      win: window, root, islands: null, nodes: [], id: 'doc', editId: () => 'e1',
      initialSource: () => '<p>v0</p>', portal: { current: null },
    });
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => editSession.mounts > 0);
    // The editor's own state, as InPlaceEditor holds it: the picked theme lands in a signal, its save is debounced.
    let theme: StoryThemeName | null = null;
    const show = createEditDraftSender({ current: controller }, { editId: () => 'e1', theme: () => theme, colorMode: () => 'dark' });
    theme = 'terminal';
    show('<p>v0</p>');
    // A text edit straight after, while the theme's metadata save is still pending.
    show('<p>v1</p>');
    await settle(() => fetch.mock.calls.length === 2);
    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as { source: string; theme: unknown; colorMode: unknown });
    expect(bodies.map((body) => body.source)).toEqual(['<p>v0</p>', '<p>v1</p>']);
    expect(bodies[1]?.theme, 'the text edit compiles in the picked theme').toBe('terminal');
    expect(bodies[1]?.colorMode).toBe('dark');
    // A theme back to none is sent as none (null), not left to the stored theme.
    theme = null;
    show('<p>v2</p>');
    await settle(() => fetch.mock.calls.length === 3);
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body)).theme).toBeNull();
    await settle(() => engine.state.releases.length > 0);
    while (engine.state.releases.length) { engine.state.releases.shift()!(); await tick(); }
    controller.dispose();
  });

  it("draws a previewed version's own markup, not the saved head; Done while previewing returns to the saved version", async () => {
    engine.state.applied.length = 0;
    engine.state.releases.length = 0;
    engine.adopted = 0;
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<p>v0</p>';
    document.body.append(root);
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('draft-preview')) {
        const { source } = JSON.parse(String(init!.body)) as { source: string };
        return new Response(JSON.stringify({ html: `<html><body><div data-mx-inline-story>${source}</div></body></html>` }), { status: 200 });
      }
      return new Response('<html><body><div data-mx-inline-story><p>head</p></div></body></html>', { status: 200 });
    });
    vi.spyOn(window, 'fetch').mockImplementation(fetch as typeof window.fetch);
    const islands = { setMode: vi.fn(), mode: () => 'edit', store: null } as unknown as import('@/lib/islands/contract').IslandDocument;
    const controller = createIslandController({
      win: window, root, islands, nodes: [], id: 'doc', editId: () => 'e1',
      initialSource: () => '<p>v0</p>', portal: { current: null },
    });
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => editSession.mounts > 0);
    const headFetches = () => fetch.mock.calls.filter(([url]) => String(url).startsWith('/a/doc/story')).length;

    // What InPlaceEditor sends for "preview version 1": the snapshot, then editing ends (twice: the effect's cleanup and its rerun).
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>old v1</p>', editId: 'e1', theme: null, colorMode: 'light', preview: true });
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: false });
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: false });
    await settle(() => engine.state.releases.length === 1);
    engine.state.releases.shift()!();
    await settle(() => engine.state.active === 0 && root.textContent === 'old v1');

    expect(root.textContent, 'the previewed version is on screen').toBe('old v1');
    expect(JSON.parse(String(fetch.mock.calls.find(([url]) => String(url).includes('draft-preview'))?.[1]?.body)).source).toBe('<p>old v1</p>');
    expect(headFetches(), 'the saved head is not fetched while previewing').toBe(0);
    expect(islands.setMode).not.toHaveBeenCalledWith('read');

    // Done while previewing: the page reads the saved version again, in place.
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: false });
    const restored = controller.restored();
    await settle(() => engine.state.releases.length === 1);
    engine.state.releases.shift()!();
    await restored;
    expect(headFetches()).toBe(1);
    expect(root.textContent).toBe('head');
    expect(islands.setMode).toHaveBeenLastCalledWith('read');
    controller.dispose();
  });

  it('morphs a new version in place while reading (neither frozen nor editing)', async () => {
    liveUpdate.updateCompiledStory.mockClear();
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<p>v0</p>';
    document.body.append(root);
    const fetch = vi.spyOn(window, 'fetch');
    const controller = createIslandController({
      win: window, root, islands: null, nodes: [], id: 'doc', editId: () => 'e1',
      initialSource: () => '<p>v0</p>', portal: { current: null },
    });
    controller.send({ type: STORY_READER_MODE_MESSAGE, mode: 'dark' });
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [] });
    expect(liveUpdate.updateCompiledStory).toHaveBeenCalledTimes(1);
    const [win, options] = liveUpdate.updateCompiledStory.mock.calls[0] as unknown as [Window, { mode: () => string | null; adopted: boolean }];
    expect(win).toBe(window);
    expect(options.adopted).toBe(true);
    expect(options.mode(), "the reader's own mode survives the new version").toBe('dark');
    expect(fetch, 'no draft compile and no fragment fetch while reading').not.toHaveBeenCalled();
    controller.dispose();
  });

  it('keeps each chart\'s last drawing on screen until the re-hydrated chart has drawn again', async () => {
    const host = document.createElement('div');
    host.style.position = 'relative';
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<div aria-label="Question embed" data-mx-ast="1.2"><div><svg class="marks" width="300" height="200"></svg></div></div>';
    host.append(root);
    document.body.append(host);
    const sized = { width: 300, height: 200, top: 40, left: 20, right: 320, bottom: 240, x: 20, y: 40, toJSON() {} } as DOMRect;
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.matches('svg.marks, canvas') ? sized : ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect);
    });
    const hold = holdChartDrawings(window, root);
    const copy = host.querySelector(':scope > [data-mx-chart-hold]') as SVGElement;
    expect(copy, 'the drawing stands beside the story').not.toBeNull();
    expect(copy.style.left).toBe('20px');
    // The island hydrates again: its chart is empty until it draws.
    root.querySelector('[aria-label="Question embed"] > div')!.innerHTML = '';
    hold.release();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(host.querySelector(':scope > [data-mx-chart-hold]'), 'no blank chart meanwhile').not.toBeNull();
    root.querySelector('[aria-label="Question embed"] > div')!.innerHTML = '<svg class="marks" width="300" height="200"></svg>';
    await settle(() => !host.querySelector(':scope > [data-mx-chart-hold]'));
    expect(host.querySelector(':scope > [data-mx-chart-hold]'), 'the redrawn chart takes over').toBeNull();
    rect.mockRestore();
    host.remove();
  });
});

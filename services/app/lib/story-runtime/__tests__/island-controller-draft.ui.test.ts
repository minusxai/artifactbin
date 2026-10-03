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
    draftTreeKept: () => false,
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
  /** What the live editors answer when a draft of typed prose is offered to them. */
  reconcile: false,
  reconciled: [] as Array<HTMLElement | null>,
  session: {
    setNodes: () => {}, canApplyDraft: () => true, dispose: () => {}, onParentMessage: () => {},
    reconcileDraft: (_before: unknown, _after: unknown, _next: unknown, draft: HTMLElement | null) => { editSession.reconciled.push(draft); return editSession.reconcile; },
    holdUnchanged: () => new Map<string, HTMLElement>(),
    releaseHeld: () => {},
    prepareHold: () => true,
    unmountCompiledDom: () => { editSession.unmounts++; },
    mountCompiledDom: async () => { editSession.mounts++; },
  },
}));
vi.mock('@/lib/story-runtime/edit/session', () => ({ createFrameEditSession: () => editSession.session }));
vi.mock('@/solid/editor/dom-mounter', () => ({ mountCompiledEditRegions: () => ({ dispose() {} }) }));

import { createIslandController, holdChartDrawings } from '../island-controller';
import { STORY_DOCUMENT_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_READER_MODE_MESSAGE } from '../contract';
import { createEditDraftSender, DRAFT_IDLE_MS } from '@/solid/editor/edit-draft';
import { TYPING_QUIET_MS } from '../island-controller';
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

  const editingController = async (fetch: (url: string, init: RequestInit) => Promise<Response>) => {
    engine.state.applied.length = 0;
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<p>v0</p>';
    document.body.append(root);
    const spy = vi.fn(fetch);
    vi.spyOn(window, 'fetch').mockImplementation(spy as unknown as typeof window.fetch);
    const controller = createIslandController({
      win: window, root, islands: null, nodes: [], id: 'doc', editId: () => 'e1',
      initialSource: () => '<p>v0</p>', portal: { current: null },
    });
    const mounts = editSession.mounts;
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => editSession.mounts > mounts);
    return { root, controller, fetch: spy };
  };
  const compiled = async (_url: string, init: RequestInit) => {
    const { source } = JSON.parse(String(init.body)) as { source: string };
    return new Response(JSON.stringify({ html: `<div data-mx-inline-story>${source}</div>` }), { status: 200 });
  };

  it("entering edit mode writes the whole story sheet once, before any draft, so the first reply swaps none", async () => {
    const sheet = document.createElement('style');
    sheet.setAttribute('data-mx-story-css', '');
    sheet.textContent = '.reader-cut{}';
    document.head.append(sheet);
    try {
      const { controller, fetch } = await editingController(async (url, init) => {
        if (!init?.method) return new Response(JSON.stringify({ css: '.reader-cut{}.every-recipe{}' }), { status: 200 });
        return compiled(url, init);
      });
      await settle(() => sheet.textContent === '.reader-cut{}.every-recipe{}');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]?.[0])).toBe('/a/doc/draft-preview');
      controller.dispose();
    } finally { sheet.remove(); }
  });

  it('typing: held until it pauses, then adopted by the live editor with NO compile, no morph and no remount', async () => {
    editSession.reconcile = true;
    editSession.reconciled.length = 0;
    const { root, controller, fetch } = await editingController(compiled);
    const unmounts = editSession.unmounts;
    const show = createEditDraftSender({ current: controller }, { editId: () => 'e1', theme: () => null, colorMode: () => 'light' });
    const sent = vi.spyOn(controller, 'update');
    for (const text of ['v0 t', 'v0 ty', 'v0 typ']) show(`<p>${text}</p>`, { typing: true });
    expect(sent).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, DRAFT_IDLE_MS + 50));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]![0]).toMatchObject({ source: '<p>v0 typ</p>', typing: true });
    await settle(() => editSession.reconciled.length === 1);
    await tick();
    // The editor adopted it in place (no compiled draft was even needed): the network and the page never moved.
    expect(editSession.reconciled).toEqual([null]);
    expect(fetch).not.toHaveBeenCalled();
    expect(editSession.unmounts).toBe(unmounts);
    expect(engine.state.applied).toEqual([]);
    expect(root.textContent).toBe('v0');
    // Anything else is sent at once, and carries the typing held before it.
    show('<p>held</p>', { typing: true });
    show('<p>held and moved</p>');
    expect(sent).toHaveBeenCalledTimes(2);
    expect(sent.mock.calls[1]![0]).toMatchObject({ source: '<p>held and moved</p>' });
    expect(sent.mock.calls[1]![0]).not.toHaveProperty('typing');
    await new Promise((resolve) => setTimeout(resolve, DRAFT_IDLE_MS + 50));
    expect(sent).toHaveBeenCalledTimes(2);
    editSession.reconcile = false;
    await settle(() => engine.state.releases.length > 0);
    while (engine.state.releases.length) { engine.state.releases.shift()!(); await tick(); }
    controller.dispose();
  });

  it('a draft that must redraw (a chart, a component) waits until typing has paused, never under the caret', async () => {
    editSession.reconcile = false;
    const { root, controller } = await editingController(compiled);
    const unmounts = editSession.unmounts;
    root.dispatchEvent(new Event('input', { bubbles: true }));
    const typedAt = performance.now();
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>chart changed</p>', editId: 'e1', theme: null, colorMode: 'light' });
    await new Promise((resolve) => setTimeout(resolve, TYPING_QUIET_MS / 2));
    expect(editSession.unmounts, 'nothing redrawn while typing').toBe(unmounts);
    expect(engine.state.applied).toEqual([]);
    await settle(() => engine.state.releases.length === 1);
    expect(performance.now() - typedAt).toBeGreaterThanOrEqual(TYPING_QUIET_MS - 20);
    expect(editSession.unmounts).toBe(unmounts + 1);
    engine.state.releases.shift()!();
    await settle(() => engine.state.active === 0);
    expect(root.textContent).toBe('chart changed');
    controller.dispose();
  });

  it('compiles one draft at a time, the newest wins, and a failed preview (502) is a no-op that blocks nothing', async () => {
    editSession.reconcile = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail!: () => void;
    let first = true;
    const { root, controller, fetch } = await editingController((url, init) => {
      if (!first) return compiled(url, init);
      first = false;
      return new Promise((resolve) => { fail = () => resolve(new Response('bad gateway', { status: 502 })); });
    });
    for (const version of ['v1', 'v2', 'v3']) {
      controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: `<p>${version}</p>`, editId: 'e1', theme: null, colorMode: 'light' });
      await tick();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    fail();
    await settle(() => fetch.mock.calls.length === 2);
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1]![1].body)).source, 'the waiting draft is the newest; v2 is never compiled').toBe('<p>v3</p>');
    await settle(() => engine.state.releases.length === 1);
    engine.state.releases.shift()!();
    await settle(() => engine.state.active === 0);
    expect(root.textContent).toBe('v3');
    controller.dispose();
  });

  it('names every draft in order (X-Draft-Sequence); 409 applies nothing; 429 resends the newest draft once', async () => {
    editSession.reconcile = false;
    const answers: Array<() => Response> = [
      () => new Response(JSON.stringify({ error: 'superseded' }), { status: 409 }),
      () => new Response(JSON.stringify({ error: 'draft_compile_busy' }), { status: 429, headers: { 'Retry-After': '1' } }),
      () => new Response(JSON.stringify({ error: 'draft_compile_busy' }), { status: 429, headers: { 'Retry-After': '1' } }),
    ];
    const { root, controller, fetch } = await editingController(async (url, init) => (answers.shift() ?? (() => null))() ?? compiled(url, init));
    const unmounts = editSession.unmounts;
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>v1</p>', editId: 'e1', theme: null, colorMode: 'light' });
    await settle(() => fetch.mock.calls.length === 1);
    await tick(); await tick();
    expect(editSession.unmounts, '409: nothing drawn').toBe(unmounts);
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>v2</p>', editId: 'e1', theme: null, colorMode: 'light' });
    await settle(() => fetch.mock.calls.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fetch, 'no resend before Retry-After').toHaveBeenCalledTimes(2);
    await settle(() => fetch.mock.calls.length === 3);
    // The resend was refused again: no third try, no storm.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(fetch).toHaveBeenCalledTimes(3);
    const sequences = fetch.mock.calls.map(([, init]) => new Headers(init.headers).get('X-Draft-Sequence')!);
    expect(sequences.every((value) => /^[\w-]{1,64}\.\d+$/.test(value))).toBe(true);
    expect(new Set(sequences.map((value) => value.split('.')[0])).size).toBe(1);
    expect(sequences.map((value) => Number(value.split('.')[1]))).toEqual([1, 2, 3]);
    expect(JSON.parse(String(fetch.mock.calls[2]![1].body)).source).toBe('<p>v2</p>');
    expect(root.textContent).toBe('v0');
    controller.dispose();
  });
});

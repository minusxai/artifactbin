/**
 * Editor drafts drawn into the adopted compiled root (lib/story-runtime/island-controller): one draft
 * is applied at a time. Two applications interleaving across the island hydration await would hydrate
 * the one-tree root twice and remount the editor over a half-morphed DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => {
  const state = { active: 0, overlapped: false, applied: [] as string[], releases: [] as Array<() => void> };
  return {
    state,
    disposeChangedDraftIslands: () => {},
    morphDraftDom: (root: HTMLElement, next: HTMLElement) => { root.innerHTML = next.innerHTML; },
    hydrateDraftIslands: (_win: Window, root: HTMLElement) => {
      state.active++;
      if (state.active > 1) state.overlapped = true;
      state.applied.push(root.textContent ?? '');
      return new Promise<void>((resolve) => { state.releases.push(() => { state.active--; resolve(); }); });
    },
  };
});
vi.mock('@/lib/islands/morph/engine', () => engine);
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

import { createIslandController } from '../island-controller';
import { STORY_DOCUMENT_MESSAGE, STORY_EDIT_MODE_MESSAGE } from '../contract';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (until: () => boolean) => { for (let i = 0; i < 200 && !until(); i++) await tick(); };

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

    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>v1</p>', editId: 'e1' });
    await settle(() => engine.state.releases.length === 1);
    // A newer draft lands while the first is still hydrating.
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>v2</p>', editId: 'e2' });
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
});

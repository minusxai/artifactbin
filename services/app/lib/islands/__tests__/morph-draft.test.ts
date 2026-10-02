/**
 * An editor draft drawn into the adopted compiled root, through the island controller's draft path
 * (lib/story-runtime/island-controller: a document update while editing → the draft compile's reply → the
 * morph engine draws it). The engine is the real one here; only the editor session and its mounter are
 * stand-ins (island-controller-draft.ui.test pins the controller's ordering with the engine stubbed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const editSession = vi.hoisted(() => ({
  mounts: 0,
  session: {
    setNodes: () => {}, canApplyDraft: () => true, dispose: () => {}, onParentMessage: () => {},
    reconcileDraft: () => false,
    holdUnchanged: () => new Map<string, HTMLElement>(),
    prepareHold: () => true,
    releaseHeld: () => {},
    unmountCompiledDom: () => {},
    mountCompiledDom: async () => { editSession.mounts++; },
  },
}));
vi.mock('@/lib/story-runtime/edit/session', () => ({ createFrameEditSession: () => editSession.session }));
vi.mock('@/solid/editor/dom-mounter', () => ({ mountCompiledEditRegions: () => ({ dispose() {} }) }));

import { createIslandController } from '@/lib/story-runtime/island-controller';
import { STORY_DOCUMENT_MESSAGE, STORY_EDIT_MODE_MESSAGE } from '@/lib/story-runtime/contract';
import { disposeChangedDraftIslands, hydrateDraftIslands, morphDraftDom, sameDataflow } from '../morph/engine';
import { ISLAND_DOCUMENT_KEY } from '../contract';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (until: () => boolean) => { for (const end = Date.now() + 5000; Date.now() < end && !until();) await tick(); };

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

/**
 * A page showing `served` (compiled from `source`) in edit mode, whose draft compiles answer with the
 * markup `compiled` gives for a source. Returns `draw(source)`: send the draft, wait until it is drawn.
 */
async function editing(source: string, served: string, compiled: (source: string) => string) {
  const root = document.createElement('div');
  root.setAttribute('data-mx-inline-story', '');
  root.innerHTML = served;
  document.body.append(root);
  vi.spyOn(window, 'fetch').mockImplementation((async (_url: string, init?: RequestInit) => {
    const { source: draft } = JSON.parse(String(init!.body)) as { source: string };
    return new Response(JSON.stringify({ html: `<div data-mx-inline-story>${compiled(draft)}</div>` }), { status: 200 });
  }) as typeof window.fetch);
  const controller = createIslandController({
    win: window, root, islands: null, nodes: [], id: 'doc', editId: () => 'e1',
    initialSource: () => source, portal: { current: null },
  });
  const mounts = editSession.mounts;
  controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
  await settle(() => editSession.mounts > mounts);
  let edits = 0;
  const draw = async (draft: string, drawn: () => boolean) => {
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: draft, editId: `e${++edits + 1}`, theme: null, colorMode: 'light' });
    await settle(drawn);
    expect(drawn(), 'the draft was drawn').toBe(true);
  };
  return { root, draw, dispose: () => controller.dispose() };
}

describe('a draft drawn in place', () => {
  const chart = (title: string, id = ' id="chart"') => `<Question${id} title="${title}" />`;

  for (const [name, painted] of [
    ['a hydrated chart island', '<div id="chart" data-mx-ast="1" data-hk="s0-0" aria-label="Question embed"><svg class="marks"></svg></div>'],
    ['a chart the draft compiler has not hydrated', '<div id="chart" aria-label="Question embed"><svg class="marks"></svg></div>'],
  ] as const) {
    it(`a prose edit takes the draft's text and keeps ${name}: the same element, its drawing intact`, async () => {
      const page = await editing(`<p>Before</p>${chart('Q')}`, `<p data-mx-ast="0">Before</p>${painted}`,
        (source) => `<p data-mx-ast="0">${/<p>(.*?)<\/p>/.exec(source)![1]}</p><div id="chart" data-mx-ast="1" data-hk="s0-0"><span>Static preview</span></div>`);
      const element = page.root.querySelector('#chart');
      await page.draw(`<p>After</p>${chart('Q')}`, () => page.root.querySelector('p')?.textContent === 'After');
      expect(page.root.querySelector('#chart')).toBe(element);
      expect(page.root.querySelector('#chart svg.marks')).not.toBeNull();
      expect(page.root.textContent).not.toContain('Static preview');
      page.dispose();
    });
  }

  it('keeps a chart without an authored id by its unchanged place in the document', async () => {
    const page = await editing(`<p>Before</p>${chart('Q', '')}`, '<p data-mx-ast="0">Before</p><div data-mx-ast="1" data-hk="s0-0" aria-label="Question embed"><svg class="marks"></svg></div>',
      (source) => `<p data-mx-ast="0">${/<p>(.*?)<\/p>/.exec(source)![1]}</p><div data-mx-ast="1" data-hk="s1-0"><span>Static preview</span></div>`);
    const element = page.root.querySelector('[data-mx-ast="1"]');
    await page.draw(`<p>After</p>${chart('Q', '')}`, () => page.root.querySelector('p')?.textContent === 'After');
    expect(page.root.querySelector('[data-mx-ast="1"]')).toBe(element);
    expect(page.root.querySelector('svg.marks')).not.toBeNull();
    page.dispose();
  });

  it('keeps a chart without an id when a paragraph is inserted above it: the same element, its drawing intact', async () => {
    const page = await editing(`<p>Before</p>${chart('Q', '')}`, '<p data-mx-ast="0">Before</p><div data-mx-ast="1" data-hk="s0-0" aria-label="Question embed"><svg class="marks"></svg></div>',
      (source) => {
        const prose = [...source.matchAll(/<p>(.*?)<\/p>/g)].map((match) => match[1]);
        return `${prose.map((text, i) => `<p data-mx-ast="${i}">${text}</p>`).join('')}<div data-mx-ast="${prose.length}" data-hk="s1-0"><span>Static preview</span></div>`;
      });
    const element = page.root.querySelector('[aria-label="Question embed"]')!;
    await page.draw(`<p>Before</p><p>Inserted</p>${chart('Q', '')}`, () => page.root.querySelectorAll('p').length === 2);
    // The same drawn element, now at the chart's new place.
    expect(page.root.querySelector('[data-mx-ast="2"]')).toBe(element);
    expect(element.querySelector('svg.marks')).not.toBeNull();
    expect(page.root.textContent).not.toContain('Static preview');
    page.dispose();
  });

  it('a changed chart takes the draft\'s own preview in place of its old drawing', async () => {
    const page = await editing(`<p>Before</p>${chart('Q')}`, '<p data-mx-ast="0">Before</p><div id="chart" data-mx-ast="1" data-hk="s0-0" aria-label="Question embed"><svg class="marks"></svg></div>',
      () => '<p data-mx-ast="0">Before</p><div id="chart" data-mx-ast="1" data-hk="s0-0"><span>Static preview</span></div>');
    await page.draw(`<p>Before</p>${chart('Q2')}`, () => page.root.textContent?.includes('Static preview') ?? false);
    expect(page.root.querySelector('#chart svg.marks')).toBeNull();
    page.dispose();
  });
});

/*
 * The draft's island module step. The controller imports a draft's module by URL (morph/engine
 * loadDraftModule), which a test cannot answer through the controller, so these drive the engine's
 * draft steps with the module handed in.
 */
describe('the draft module step', () => {
  it('a version that declares the same data at other source offsets is the same dataflow; another query is not', () => {
    const query = { name: 'q', engine: 'sqlite', sql: 'select 1 as n', params: [], reads: { imports: [], queries: [], values: [], builtins: [] }, columns: [{ name: 'n', type: 'number' }] };
    const flow = { imports: [], values: [], queries: [query], mutations: [] } as any;
    const moved = { imports: [], values: [], queries: [{ start: 169, end: 241, ...query }], mutations: [] } as any;
    expect(sameDataflow(flow, moved)).toBe(true);
    expect(sameDataflow(flow, { ...moved, queries: [{ ...query, sql: 'select 2 as n' }] })).toBe(false);
  });

  it('hydrates a newly compiled chart while retaining an unchanged chart on the next prose draft', async () => {
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<div data-mx-ast="1" data-hk="s0-0">Static chart</div>';
    document.body.append(root);
    const dispose = vi.fn();
    const hydrate = vi.fn(() => {
      root.querySelector('[data-mx-ast="1"]')!.innerHTML = '<svg class="marks"></svg>';
      seam.islands.set('s0-', ['chart', dispose]);
    });
    const seam = { islands: new Map(), hydrate, modules: new WeakMap() } as any;
    (root as any)[ISLAND_DOCUMENT_KEY] = { morph: seam, store: null };
    const preview = document.implementation.createHTMLDocument();
    preview.body.innerHTML = '<script type="module" src="/islands/d/draft.js"></script>';
    const entries = [['s0-', () => null, 'chart']] as const;
    await hydrateDraftIslands(window, root, preview, new Set(), new Set(), async () => {
      seam.take({ ISLANDS: entries });
      return { ISLANDS: entries };
    });
    expect(root.querySelector('svg.marks')).not.toBeNull();
    expect(hydrate).toHaveBeenCalledTimes(1);
    disposeChangedDraftIslands(root, new Set(), new Set(['1']));
    const next = document.createElement('div');
    next.innerHTML = '<div data-mx-ast="1" data-hk="s0-0">New static chart</div>';
    morphDraftDom(root, next, new Set(), new Set(['1']));
    await hydrateDraftIslands(window, root, preview, new Set(), new Set(['1']), async () => ({ ISLANDS: entries }));
    expect(dispose).not.toHaveBeenCalled();
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(root.querySelector('svg.marks')).not.toBeNull();
    root.remove();
  });

  it('keeps compiled static prose and newly hydrated components during a one-tree editor draft', async () => {
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<div data-hk="d-0"><p id="f6">Before</p><div id="chart" data-mx-ast="1">Painted chart</div></div>';
    document.body.append(root);
    const hydrate = vi.fn(() => {
      root.querySelector('#f6')?.remove();
      root.querySelector('#chart')!.innerHTML = '<svg class="marks"></svg>';
    });
    const seam = { islands: new Map(), hydrate, modules: new WeakMap(), trees: new WeakMap() } as any;
    (root as any)[ISLAND_DOCUMENT_KEY] = { morph: seam, store: null, mode: () => 'edit' };
    const next = document.createElement('div');
    next.innerHTML = '<div data-hk="d-0"><p id="f6">EDITED IN PLACE</p><div id="chart" data-mx-ast="1" data-hk="d-1">Static preview</div></div>';
    morphDraftDom(root, next, new Set(['chart']));
    const preview = document.implementation.createHTMLDocument();
    preview.body.innerHTML = `<div data-mx-inline-story="">${next.innerHTML}</div><script type="module" src="/islands/d/draft.js"></script>`;
    const entries = [['d-', () => null, 'document']] as const;
    await hydrateDraftIslands(window, root, preview, new Set(['chart']), new Set(), async () => {
      seam.take({ ISLANDS: entries });
      return { ISLANDS: entries };
    });
    expect(hydrate).toHaveBeenCalledWith(entries[0]);
    expect(root.querySelector('#f6')?.textContent).toBe('EDITED IN PLACE');
    expect(root.querySelector('#chart svg.marks')).not.toBeNull();
    root.remove();
  });

  it('keeps the running store when a draft declares the same data at other source offsets (charts keep their rows)', async () => {
    const query = { name: 'q', engine: 'sqlite', sql: 'select 1 as n', params: [], reads: { imports: [], queries: [], values: [], builtins: [] }, columns: [{ name: 'n', type: 'number' }] };
    const draftFlow = { imports: [], values: [], queries: [query], mutations: [] } as any;
    const savedFlow = { imports: [], values: [], queries: [{ start: 169, end: 241, ...query }], mutations: [] } as any;
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<div data-mx-ast="1" data-hk="s0-0">chart</div>';
    document.body.append(root);
    const store = { flow: draftFlow, replaceFlow: vi.fn() };
    const seam = { islands: new Map(), hydrate: vi.fn(), modules: new WeakMap() } as any;
    (root as any)[ISLAND_DOCUMENT_KEY] = { morph: seam, store, mode: () => 'edit' };
    const preview = document.implementation.createHTMLDocument();
    preview.body.innerHTML = '<script type="module" src="/islands/d/saved.js"></script>';
    const entries = [['s0-', () => null, 'chart']] as const;
    await hydrateDraftIslands(window, root, preview, new Set(), new Set(), async () => ({ ISLANDS: entries, FLOW: savedFlow }), { ISLANDS: entries, FLOW: savedFlow } as any);
    expect(store.replaceFlow).not.toHaveBeenCalled();
    await hydrateDraftIslands(window, root, preview, new Set(), new Set(), async () => null, { ISLANDS: entries, FLOW: { ...savedFlow, queries: [{ ...query, sql: 'select 2 as n' }] } } as any);
    expect(store.replaceFlow).toHaveBeenCalledTimes(1);
    root.remove();
  });
});

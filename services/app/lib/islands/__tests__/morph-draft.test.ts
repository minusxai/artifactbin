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
import { disposeChangedDraftIslands, draftTreeKept, hydrateDraftIslands, morphDraftDom, sameDataflow } from '../morph/engine';
import { ISLAND_DOCUMENT_KEY } from '../contract';
import { boot, type MorphableIslandDocument } from '../boot';

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
  it('switches the standalone document sheets and root appearance without replacing its content', async () => {
    const head = document.head.innerHTML;
    const attributes = document.documentElement.outerHTML.match(/^<html([^>]*)>/)?.[1];
    document.documentElement.setAttribute('data-theme', 'signout');
    document.documentElement.className = 'light';
    document.head.innerHTML = '<style data-mx-bare-type></style><style data-mx-system>.old{color:red}</style><style data-mx-author>.custom{color:purple}</style>';
    const source = '<p id="copy">Unchanged content</p>';
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<p id="copy" data-mx-ast="0">Unchanged content</p>';
    document.body.append(root);
    const copy = root.firstElementChild;
    vi.spyOn(window, 'fetch').mockImplementation((async (_url: string, init?: RequestInit) => {
      const { theme, colorMode } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ html: `<html class="${colorMode}" ${theme ? `data-theme="${theme}"` : ''}><head><style data-mx-bare-type></style><style data-mx-fonts>:root{--font-body:NewFace}</style>${theme ? '<style data-mx-system>.new{color:blue}</style>' : ''}</head><body><div data-mx-inline-story class="${colorMode}">${root.innerHTML}</div></body></html>` }));
    }) as typeof window.fetch);
    const controller = createIslandController({ win: window, root, islands: null, nodes: [], id: 'doc', editId: () => 'e1', initialSource: () => source, portal: { current: null } });
    try {
      const mounts = editSession.mounts;
      controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
      await settle(() => editSession.mounts > mounts);
      controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source, editId: 'e1', theme: 'volta', colorMode: 'dark', redraw: true });
      await settle(() => root.classList.contains('dark'));
      expect(document.documentElement.getAttribute('data-theme')).toBe('volta');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.querySelector('style[data-mx-system]')?.textContent).toContain('.new');
      expect(document.querySelector('style[data-mx-fonts]')?.textContent).toContain('NewFace');
      expect(document.querySelector('style[data-mx-author]')).toBeNull();
      expect(root.firstElementChild).toBe(copy);
      controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source, editId: 'e1', theme: null, colorMode: 'light', redraw: true });
      await settle(() => root.classList.contains('light'));
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
      expect(document.querySelector('style[data-mx-system]')).toBeNull();
    } finally {
      controller.dispose();
      document.head.innerHTML = head;
      const original = new DOMParser().parseFromString(`<html${attributes ?? ''}></html>`, 'text/html').documentElement;
      for (const attr of [...document.documentElement.attributes]) document.documentElement.removeAttribute(attr.name);
      for (const attr of [...original.attributes]) document.documentElement.setAttribute(attr.name, attr.value);
    }
  });

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
describe('entering edit mode', () => {
  it('the first draft after entering edit mode keeps the hydrated chart element: the same element, still connected, its drawing intact', async () => {
    document.body.innerHTML = '<div data-mx-inline-story=""><div data-hk="d-0" class="mx-doc"><p data-mx-ast="0">Before</p>'
      + '<div data-mx-ast="1" data-hk="d-1" aria-label="Question embed"><svg class="marks"><rect></rect></svg></div></div></div>';
    const root = document.querySelector<HTMLElement>('[data-mx-inline-story]')!;
    // The page's running whole-document tree, its chart drawn (the islands project renders it fresh in place of the served root).
    const Tree = () => {
      const tree = document.createElement('div');
      tree.setAttribute('data-hk', 'd-0');
      tree.className = 'mx-doc';
      tree.innerHTML = '<p data-mx-ast="0">Before</p><div data-mx-ast="1" data-hk="d-1" aria-label="Question embed"><svg class="marks"><rect></rect></svg></div>';
      return tree;
    };
    const islands = boot({ ISLANDS: [['d-', Tree, 'document']] }) as MorphableIslandDocument;
    const chart = root.querySelector('[aria-label="Question embed"]')!;
    const drawing = chart.querySelector('svg.marks')!;
    vi.spyOn(window, 'fetch').mockImplementation((async (_url: string, init?: RequestInit) => {
      const { source } = JSON.parse(String(init!.body)) as { source: string };
      const text = /<p>(.*?)<\/p>/.exec(source)![1];
      return new Response(JSON.stringify({ html: '<div data-mx-inline-story><div data-hk="d-0" class="mx-doc">'
        + `<p data-mx-ast="0">${text}</p><div data-mx-ast="1" data-hk="d-1" aria-label="Question embed"><span>Static preview</span></div></div></div>` }), { status: 200 });
    }) as typeof window.fetch);
    const controller = createIslandController({
      win: window, root, islands, nodes: [], id: 'doc', editId: () => 'e1',
      initialSource: () => '<p>Before</p><Question title="Q" />', portal: { current: null },
    });
    const mounts = editSession.mounts;
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => editSession.mounts > mounts);
    expect(islands.mode()).toBe('edit');
    expect(root.querySelector('[aria-label="Question embed"]'), 'entering edit mode keeps the chart element').toBe(chart);
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [], source: '<p>After</p><Question title="Q" />', editId: 'e2', theme: null, colorMode: 'light' });
    await settle(() => root.querySelector('p')?.textContent === 'After');
    expect(root.querySelector('p')?.textContent, 'the draft was drawn').toBe('After');
    expect(root.querySelector('[data-mx-ast="1"]'), 'the first draft keeps the hydrated chart element').toBe(chart);
    expect(chart.isConnected).toBe(true);
    expect(chart.querySelector('svg.marks'), 'its drawing intact').toBe(drawing);
    expect(root.textContent).not.toContain('Static preview');
    expect(islands.morph!.islands.has('d-'), 'the running tree goes on running: nothing hydrates it again').toBe(true);
    controller.dispose();
    islands.dispose();
  });
});

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

  it('lets the running one-tree go on when every component the draft hydrates is kept (a paragraph inserted above a chart), and hydrates it again otherwise', async () => {
    const root = document.createElement('div');
    root.setAttribute('data-mx-inline-story', '');
    root.innerHTML = '<div data-hk="d-0" class="mx-doc"><p data-mx-ast="0">Before</p><div data-mx-ast="1" data-hk="d-1" aria-label="Question embed"><svg class="marks"></svg></div></div>';
    document.body.append(root);
    const hydrate = vi.fn();
    const dispose = vi.fn();
    const seam = { islands: new Map([['d-', ['document', dispose]]]), hydrate, modules: new WeakMap(), trees: new WeakMap() } as any;
    (root as any)[ISLAND_DOCUMENT_KEY] = { morph: seam, store: null, mode: () => 'edit' };
    const next = document.createElement('div');
    next.innerHTML = '<div data-hk="d-0" class="mx-doc"><p data-mx-ast="0">Before</p><p data-mx-ast="1">Inserted</p><div data-mx-ast="2" data-hk="d-1"><span>Static preview</span></div></div>';
    // The chart moved from 1 to 2, its markup unchanged.
    const stable = new Map([['2', '1']]);
    expect(draftTreeKept(next, new Set(), stable)).toBe(true);
    const chart = root.querySelector('[aria-label="Question embed"]');
    disposeChangedDraftIslands(root, new Set(), stable, true);
    morphDraftDom(root, next, new Set(), stable);
    const preview = document.implementation.createHTMLDocument();
    preview.body.innerHTML = `<div data-mx-inline-story="">${next.innerHTML}</div>`;
    const entries = [['d-', () => null, 'document']] as const;
    await hydrateDraftIslands(window, root, preview, new Set(), stable, async () => ({ ISLANDS: entries }) as any, { ISLANDS: entries } as any, new Map(), true);
    expect(dispose).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
    expect(root.querySelector('[data-mx-ast="2"]')).toBe(chart);
    expect(chart!.querySelector('svg.marks')).not.toBeNull();
    expect(root.textContent).toContain('Inserted');
    expect(root.textContent).not.toContain('Static preview');
    // A component the draft changed (or adds) is hydrated: the tree hydrates again.
    const added = document.createElement('div');
    added.innerHTML = '<div data-hk="d-0" class="mx-doc"><div data-mx-ast="0" data-hk="d-1"></div><div data-mx-ast="1" data-hk="d-2"></div></div>';
    expect(draftTreeKept(added, new Set(), new Map([['0', '1']]))).toBe(false);
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

import { expect, it, vi } from 'vitest';
import { disposeChangedDraftIslands, hydrateDraftIslands, morphDraftDom, sameDataflow } from '../morph/engine';
import { ISLAND_DOCUMENT_KEY } from '../contract';

it('updates compiled prose while keeping an unchanged live island element', () => {
  const root = document.createElement('div');
  root.setAttribute('data-mx-inline-story', '');
  root.innerHTML = '<p id="text" data-mx-ast="0">Before</p><div id="chart" data-mx-ast="1" data-hk="s0-0"><svg aria-label="Question embed"></svg></div>';
  document.body.append(root);
  const chart = root.querySelector('#chart');
  const next = document.createElement('div');
  next.setAttribute('data-mx-inline-story', '');
  next.innerHTML = '<p id="text" data-mx-ast="0">After</p><div id="chart" data-mx-ast="1" data-hk="s0-0"><span>Static preview</span></div>';
  morphDraftDom(root, next, new Set(['chart']));
  expect(root.querySelector('#text')?.textContent).toBe('After');
  expect(root.querySelector('#chart')).toBe(chart);
  expect(root.querySelector('[aria-label="Question embed"]')).not.toBeNull();
  root.remove();
});

it('keeps a stable chart drawing when the draft compiler has no hydrated island', () => {
  const root = document.createElement('div');
  root.setAttribute('data-mx-inline-story', '');
  root.innerHTML = '<p id="text">Before</p><div id="chart" aria-label="Question embed"><svg class="marks"></svg></div>';
  document.body.append(root);
  const chart = root.querySelector('#chart');
  const next = document.createElement('div');
  next.setAttribute('data-mx-inline-story', '');
  next.innerHTML = '<p id="text">After</p><div id="chart" data-hk="s0-0"><span>Static preview</span></div>';
  morphDraftDom(root, next, new Set(['chart']));
  expect(root.querySelector('#text')?.textContent).toBe('After');
  expect(root.querySelector('#chart')).toBe(chart);
  expect(root.querySelector('svg.marks')).not.toBeNull();
  root.remove();
});

it('keeps a chart without an authored id by its unchanged AST path', () => {
  const root = document.createElement('div');
  root.setAttribute('data-mx-inline-story', '');
  root.innerHTML = '<p data-mx-ast="0">Before</p><div data-mx-ast="1" data-hk="s0-0" aria-label="Question embed"><svg class="marks"></svg></div>';
  document.body.append(root);
  const chart = root.querySelector('[data-mx-ast="1"]');
  const next = document.createElement('div');
  next.setAttribute('data-mx-inline-story', '');
  next.innerHTML = '<p data-mx-ast="0">After</p><div data-mx-ast="1" data-hk="s1-0"><span>Static preview</span></div>';
  morphDraftDom(root, next, new Set(), new Set(['1']));
  expect(root.querySelector('[data-mx-ast="1"]')).toBe(chart);
  expect(root.querySelector('svg.marks')).not.toBeNull();
  root.remove();
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

it('keeps the running store when a version declares the same data at other source offsets (charts keep their rows)', async () => {
  const query = { name: 'q', engine: 'sqlite', sql: 'select 1 as n', params: [], reads: { imports: [], queries: [], values: [], builtins: [] }, columns: [{ name: 'n', type: 'number' }] };
  const draftFlow = { imports: [], values: [], queries: [query], mutations: [] } as any;
  const savedFlow = { imports: [], values: [], queries: [{ start: 169, end: 241, ...query }], mutations: [] } as any;
  expect(sameDataflow(draftFlow, savedFlow)).toBe(true);
  expect(sameDataflow(draftFlow, { ...savedFlow, queries: [{ ...query, sql: 'select 2 as n' }] })).toBe(false);

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

/**
 * THE LIVE MORPH (lib/islands/morph/engine, lib/islands/live-update; docs/phase2-architecture.md §2.4):
 * a compiled page brought to the document's newest version in place, as today's React reader re-renders
 * a write. A booted page (the real `boot`, hydratable islands written as babel-preset-solid emits them —
 * see rt-adopt.test) is morphed into the next version's fragment: static nodes keep their identity and
 * take the new content, an island whose key the new version carries again keeps its nodes and keeps
 * running, a changed island is disposed and hydrated from the new page on the SAME store, and the
 * reader's values, mode, focus and place survive. What it cannot draw reloads, keeping the place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, type IslandEntry, type MorphableIslandDocument } from '../boot';
import { getNextElement, insert, template } from '../rt';
import { useIsland } from '../context';
import { islandDocumentOf } from '../handover';
import { morphStory, MorphRefused, type MorphOptions } from '../morph/engine';
import { updateCompiledStory } from '../live-update';
import { persistReaderMode, takeReloadAnchor } from '@/lib/story-runtime/reader-mode';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';

const flow: CompiledDataflow = { imports: [], mutations: [], queries: [], values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'All' }] };
const moreFlow: CompiledDataflow = { ...flow, values: [...flow.values, { name: 'year', kind: 'scalar', type: 'number', default: 2026 }] };

/** An island as babel-preset-solid emits a HYDRATABLE one: it claims the served node by its hydration key. */
function island(id: string, label: string) {
  const tmpl = template(`<div id="${id}"><b></b></div>`);
  return function Island() {
    const context = useIsland();
    const el = getNextElement(tmpl) as HTMLElement;
    insert(el.firstChild as Element, () => `${label}:${String(context.value('region'))}`);
    return el;
  };
}
const A = island('A', 'A');
const B = island('B', 'B');
const B2 = island('B', 'B2');
const N = island('N', 'N');

interface Served {
  edit: string;
  lede?: string;
  extra?: string;
  /** Islands in document order: render id, root id, served label. */
  islands?: Array<[rid: string, id: string, label: string]>;
  module?: string | null;
  boot?: string;
  mode?: 'light' | 'dark';
  sheets?: Record<string, string>;
  title?: string;
  region?: string;
  /** The column wrapper's id (a whole-document write can mint it anew). */
  wrapper?: string;
}

/** A compiled page as the assembler writes it (the parts the morph reads). */
function served({ edit, lede = 'the first version', extra = '', islands = [['s0-', 'A', 'A'], ['s1-', 'B', 'B']], module = '/islands/d/aaaaaaaaaaaaaaaa.js', boot: bootUrl = '/islands/boot-1111.js', mode = 'light', sheets = { 'data-mx-tw': '.p-10{padding:2.5rem}' }, title = 'Live', region = 'All', wrapper = 'w' }: Served): string {
  const islandHtml = islands.map(([rid, id, label]) => `<div data-hk="${rid}0000" id="${id}" data-mx-ast="2.${id}"><b>${label}:${region}</b></div>`).join('');
  return `<!doctype html><html class="${mode}"><head><title>${title}</title>`
    + (module ? `<link rel="modulepreload" href="${module}" crossorigin><link rel="modulepreload" href="${bootUrl}" crossorigin>` : '')
    + '<style>:root{--mx-vh:100vh}</style>'
    + Object.entries(sheets).map(([attr, css]) => `<style ${attr}>${css}</style>`).join('')
    + `</head><body data-mx-live-id="doc1" data-mx-live-edit="${edit}">`
    + `<div id="mx-story-root" data-mx-inline-story="" data-mx-story-root="" class="${mode}"><div class="mx-doc"><div id="${wrapper}" data-mx-ast="0" class="p-10">`
    + `<h1 id="h" data-mx-ast="0.0">Live</h1><p id="lede" data-mx-ast="0.1">${lede}</p>${extra}<section id="s" data-mx-ast="0.2">${islandHtml}</section><p id="tail" data-mx-ast="0.3">tail</p>`
    + '</div></div></div>'
    + (module ? `<script type="application/json" id="mx-story-data">${JSON.stringify({ values: { region }, results: null, signedIn: false, mermaidImages: {}, readOnly: null, edit })}</script><script type="module" src="/islands/page-1.js" crossorigin></script><script type="module" src="${module}" crossorigin></script>` : '<script type="module" src="/islands/page-1.js" crossorigin></script>')
    + '</body></html>';
}

/** Put a served page into the test's document, as the browser parsed it. */
function load(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.documentElement.className = parsed.documentElement.className;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  for (const attr of [...document.body.attributes]) document.body.removeAttribute(attr.name);
  for (const attr of parsed.body.attributes) document.body.setAttribute(attr.name, attr.value);
}

const answer = (html: string, status = 200) => vi.fn(async () => new Response(html, { status }));
/** The next version's module: its first import runs `boot` (which hands it to the running document), as the real one does. */
const moduleOf = (ISLANDS: readonly IslandEntry[], FLOW: CompiledDataflow | null = flow) => vi.fn(async () => { boot({ ISLANDS, FLOW }); return { ISLANDS }; });

const $ = (id: string) => document.getElementById(id);
let booted: MorphableIslandDocument | null = null;
const start = (ISLANDS: readonly IslandEntry[] = [['s0-', A, 'kA'], ['s1-', B, 'kB']], FLOW: CompiledDataflow | null = flow) => {
  booted = boot({ ISLANDS, FLOW }) as MorphableIslandDocument;
  return booted;
};
const running = (): MorphableIslandDocument => islandDocumentOf($('mx-story-root')) as MorphableIslandDocument;

beforeEach(() => { window.name = ''; });
afterEach(() => {
  running()?.dispose();
  booted = null;
  window.name = '';
  delete (window as unknown as Record<string, unknown>).__mxStoryUpdate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const morph = (win: Window, options: MorphOptions) => morphStory(win, { surface: 'raw', ...options });

describe('the live morph', () => {
  it('a static edit: every node keeps its identity, the text changes in place, the islands keep running', async () => {
    load(served({ edit: 'e1' }));
    const doc = start();
    const [h, lede, a, b, tail] = ['h', 'lede', 'A', 'B', 'tail'].map($);
    expect(a!.textContent, 'the island adopted its served node').toBe('A:All');
    const fetch = answer(served({ edit: 'e2', lede: 'THE AGENT REWROTE THIS', extra: '<p id="added" data-mx-ast="0.1b">a new paragraph</p>' }));
    const importModule = vi.fn();

    await morph(window, { fetch, importModule });

    expect(fetch).toHaveBeenCalledWith('/a/doc1/story?surface=raw', expect.objectContaining({ credentials: 'same-origin' }));
    expect([$('h'), $('lede'), $('A'), $('B'), $('tail')]).toEqual([h, lede, a, b, tail]);
    expect(lede!.textContent).toBe('THE AGENT REWROTE THIS');
    expect($('added')?.previousElementSibling).toBe(lede);
    expect(importModule, 'the same content-addressed module: nothing to import').not.toHaveBeenCalled();
    expect(document.body.getAttribute('data-mx-live-edit')).toBe('e2');
    expect(running()).toBe(doc);
    doc.context.setValue('region', 'East');
    expect(a!.textContent).toBe('A:East');
    expect(b!.textContent).toBe('B:East');
  });

  it('an element whose id was minted anew keeps its node, and so does everything under it', async () => {
    load(served({ edit: 'e1' }));
    start();
    const [wrapper, lede, a] = [$('w'), $('lede'), $('A')];
    await morph(window, { fetch: answer(served({ edit: 'e2', wrapper: 'W2x9', lede: 'rewritten' })) });
    expect($('W2x9')).toBe(wrapper);
    expect($('lede')).toBe(lede);
    expect($('A')).toBe(a);
    expect(lede!.textContent).toBe('rewritten');
  });

  it('a changed island is disposed and hydrated from the new page; the unchanged one, the store and the values survive', async () => {
    load(served({ edit: 'e1' }));
    const doc = start();
    doc.context.setValue('region', 'East');
    const [a, b] = [$('A'), $('B')];
    const store = doc.store!;
    const replaceFlow = vi.spyOn(store, 'replaceFlow');
    const next: IslandEntry[] = [['s0-', A, 'kA'], ['s1-', B2, 'kB-changed']];
    const importModule = moduleOf(next);

    const fetch = answer(served({ edit: 'e2', module: '/islands/d/bbbbbbbbbbbbbbbb.js', islands: [['s0-', 'A', 'A'], ['s1-', 'B', 'B2']], region: 'East' }));
    await morph(window, { fetch, importModule });

    expect(fetch, 'the fragment is rendered at the reader\'s values, which the new islands hydrate over').toHaveBeenCalledWith('/a/doc1/story?%24region=East&surface=raw', expect.anything());
    expect(importModule).toHaveBeenCalledWith(new URL('/islands/d/bbbbbbbbbbbbbbbb.js', document.baseURI).href);
    expect(running(), 'the new module was handed to the running document, not booted beside it').toBe(doc);
    expect($('A'), 'the unchanged island kept its node').toBe(a);
    expect(b!.isConnected, 'the changed island\'s old node is gone').toBe(false);
    expect($('B')!.textContent, 'the new island hydrated on the surviving values').toBe('B2:East');
    expect(doc.store).toBe(store);
    expect(replaceFlow, 'the declarations did not change').not.toHaveBeenCalled();
    doc.context.setValue('region', 'North');
    expect([$('A')!.textContent, $('B')!.textContent]).toEqual(['A:North', 'B2:North']);
    b!.textContent = 'untouched';
    doc.context.setValue('region', 'South');
    expect(b!.textContent, 'the disposed island runs nothing').toBe('untouched');
    expect([...doc.morph!.islands.keys()]).toEqual(['s0-', 's1-']);
  });

  it('new declarations replace the store\'s flow, keeping the reader\'s values', async () => {
    load(served({ edit: 'e1' }));
    const doc = start();
    doc.context.setValue('region', 'East');
    const replaceFlow = vi.spyOn(doc.store!, 'replaceFlow');
    await morph(window, { fetch: answer(served({ edit: 'e2', module: '/islands/d/cccccccccccccccc.js' })), importModule: moduleOf([['s0-', A, 'kA'], ['s1-', B, 'kB']], moreFlow) });
    expect(replaceFlow).toHaveBeenCalledWith({ flow: moreFlow });
    expect(doc.store!.getValue('region')).toBe('East');
    expect(doc.store!.getValue('year')).toBe(2026);
  });

  it('an island inserted before the others: the kept islands answer to their new render ids, the new one hydrates', async () => {
    load(served({ edit: 'e1' }));
    const doc = start();
    const [a, b] = [$('A'), $('B')];
    const next: IslandEntry[] = [['s0-', N, 'kN'], ['s1-', A, 'kA'], ['s2-', B, 'kB']];
    await morph(window, { fetch: answer(served({ edit: 'e2', module: '/islands/d/dddddddddddddddd.js', islands: [['s0-', 'N', 'N'], ['s1-', 'A', 'A'], ['s2-', 'B', 'B']] })), importModule: moduleOf(next) });

    expect([$('A'), $('B')]).toEqual([a, b]);
    expect([a!.getAttribute('data-hk'), b!.getAttribute('data-hk')]).toEqual(['s1-0000', 's2-0000']);
    expect($('N')!.nextElementSibling).toBe(a);
    expect([...doc.morph!.islands.keys()].sort()).toEqual(['s0-', 's1-', 's2-']);
    doc.context.setValue('region', 'West');
    expect([$('N')!.textContent, a!.textContent, b!.textContent]).toEqual(['N:West', 'A:West', 'B:West']);
  });

  it('a module this page ran before (a revert) is found by its ISLANDS, not booted again', async () => {
    load(served({ edit: 'e1' }));
    const doc = start();
    const changed: IslandEntry[] = [['s0-', A, 'kA'], ['s1-', B2, 'kB2']];
    const page = (edit: string, module: string, label: string) => answer(served({ edit, module, islands: [['s0-', 'A', 'A'], ['s1-', 'B', label]] }));
    await morph(window, { fetch: page('e2', '/islands/d/eeeeeeeeeeeeeeee.js', 'B2'), importModule: moduleOf(changed) });
    await morph(window, { fetch: page('e3', '/islands/d/ffffffffffffffff.js', 'B'), importModule: moduleOf([['s0-', A, 'kA'], ['s1-', B, 'kB']]) });
    expect($('B')!.textContent).toBe('B:All');
    // The first module again, from the module map: evaluated once, so its `boot` does not run again.
    const cached = vi.fn(async () => ({ ISLANDS: changed }));
    const a = $('A');
    await morph(window, { fetch: page('e4', '/islands/d/eeeeeeeeeeeeeeee.js', 'B2'), importModule: cached });
    expect(cached).toHaveBeenCalledTimes(1);
    expect($('A')).toBe(a);
    expect($('B')!.textContent).toBe('B2:All');
    expect(running()).toBe(doc);
  });

  it('keeps the reader\'s colour against the new version\'s, and takes the new one when they chose none', async () => {
    load(served({ edit: 'e1' }));
    start();
    persistReaderMode(window, 'dark');
    document.documentElement.className = 'dark';
    $('mx-story-root')!.className = 'dark';
    await morph(window, { fetch: answer(served({ edit: 'e2', lede: 'x' })) });
    expect($('mx-story-root')!.className).toBe('dark');
    expect(document.documentElement.className).toBe('dark');

    persistReaderMode(window, null);
    await morph(window, { fetch: answer(served({ edit: 'e3', mode: 'dark' })), mode: () => 'light' });
    expect($('mx-story-root')!.className, 'the app\'s own override wins too').toBe('light');

    await morph(window, { fetch: answer(served({ edit: 'e4', mode: 'dark' })) });
    expect($('mx-story-root')!.className).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('brings the version\'s sheets and title, drops a sheet the version no longer has, and leaves the page\'s own alone', async () => {
    load(served({ edit: 'e1', sheets: { 'data-mx-tw': '.a{}', 'data-mx-author': '.mine{}', 'data-mx-chrome': '.chrome{}' } }));
    start();
    await morph(window, { fetch: answer(served({ edit: 'e2', title: 'Renamed', sheets: { 'data-mx-tw': '.a{}.b{}', 'data-mx-webfonts': '@font-face{}' } })) });
    expect(document.head.querySelector('style[data-mx-tw]')!.textContent).toBe('.a{}.b{}');
    expect(document.head.querySelector('style[data-mx-webfonts]')!.textContent).toBe('@font-face{}');
    expect(document.head.querySelector('style[data-mx-author]')).toBeNull();
    expect(document.head.querySelector('style[data-mx-chrome]'), 'the page\'s chrome sheet is not the version\'s').not.toBeNull();
    expect(document.title).toBe('Renamed');
  });

  it('keeps focus on a control the new version still has', async () => {
    load(served({ edit: 'e1', extra: '<input id="q" data-mx-ast="0.1c">' }));
    start();
    const input = $('q') as HTMLInputElement;
    input.focus();
    await morph(window, { fetch: answer(served({ edit: 'e2', lede: 'changed', extra: '<input id="q" data-mx-ast="0.1c" placeholder="p">' })) });
    expect($('q')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('placeholder')).toBe('p');
  });

  it('a prose page whose new version brings islands boots them on the morphed DOM', async () => {
    load(served({ edit: 'e1', islands: [], module: null }));
    const lede = $('lede');
    const importModule = vi.fn(async () => { start([['s0-', A, 'kA']]); return {}; });
    await morph(window, { fetch: answer(served({ edit: 'e2', islands: [['s0-', 'A', 'A']] })), importModule });
    expect(importModule).toHaveBeenCalledWith(new URL('/islands/d/aaaaaaaaaaaaaaaa.js', document.baseURI).href);
    expect($('lede')).toBe(lede);
    expect(document.getElementById('mx-story-data'), 'the data island the boot reads came with it').not.toBeNull();
    expect(running()).toBeTruthy();
    running().context.setValue('region', 'East');
    expect($('A')!.textContent).toBe('A:East');
  });

  it('records what the page runs now: the next static edit imports nothing, and a later island build is still refused', async () => {
    load(served({ edit: 'e1' }));
    start();
    await morph(window, { fetch: answer(served({ edit: 'e2', module: '/islands/d/bbbbbbbbbbbbbbbb.js', islands: [['s0-', 'A', 'A'], ['s1-', 'B', 'B2']] })), importModule: moduleOf([['s0-', A, 'kA'], ['s1-', B2, 'kB2']]) });
    const importModule = vi.fn();
    await morph(window, { fetch: answer(served({ edit: 'e3', lede: 'static only', module: '/islands/d/bbbbbbbbbbbbbbbb.js', islands: [['s0-', 'A', 'A'], ['s1-', 'B', 'B2']] })), importModule });
    expect(importModule, 'the page already runs that module').not.toHaveBeenCalled();
    expect($('lede')!.textContent).toBe('static only');
  });

  it('a prose page that gained islands still refuses a version from another island build', async () => {
    load(served({ edit: 'e1', islands: [], module: null }));
    await morph(window, { fetch: answer(served({ edit: 'e2', islands: [['s0-', 'A', 'A']] })), importModule: vi.fn(async () => { start([['s0-', A, 'kA']]); return {}; }) });
    expect(document.querySelector('script[src="/islands/d/aaaaaaaaaaaaaaaa.js"]'), 'the module the page now runs is on record').not.toBeNull();
    await expect(morph(window, { fetch: answer(served({ edit: 'e3', islands: [['s0-', 'A', 'A']], module: '/islands/d/9999999999999999.js', boot: '/islands/boot-2222.js' })) })).rejects.toThrow(/island build/);
  });

  it('does nothing for the version the page already shows', async () => {
    load(served({ edit: 'e1' }));
    start();
    const lede = $('lede')!;
    await morph(window, { fetch: answer(served({ edit: 'e1', lede: 'different' })) });
    expect(lede.textContent).toBe('the first version');
  });

  it('asks again while the version is still being compiled', async () => {
    load(served({ edit: 'e1' }));
    start();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(new Response(served({ edit: 'e2', lede: 'landed' })));
    await morph(window, { fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect($('lede')!.textContent).toBe('landed');
  });

  it('refuses what it cannot draw in place: an unreadable fragment, another island build, a deck, a new author script', async () => {
    load(served({ edit: 'e1' }));
    start();
    await expect(morph(window, { fetch: answer('not found', 404) })).rejects.toBeInstanceOf(MorphRefused);
    await expect(morph(window, { fetch: answer(served({ edit: 'e2', module: '/islands/d/9999999999999999.js', boot: '/islands/boot-2222.js' })) })).rejects.toThrow(/island build/);
    await expect(morph(window, { fetch: answer(served({ edit: 'e2', extra: '<nav class="mx-rail"></nav>' })) })).rejects.toThrow(/deck/);
    const scripted = served({ edit: 'e2' }).replace('"readOnly":null', '"readOnly":null,"authorScript":"mx.set(1)"');
    await expect(morph(window, { fetch: answer(scripted) }), 'the author\'s realm is started once, by boot').rejects.toThrow(/author script/);
    expect($('lede')!.textContent, 'a refusal changes nothing').toBe('the first version');
  });
});

describe('the one update path (live-update)', () => {
  const pageWindow = (fetch: typeof window.fetch, reload = vi.fn()) =>
    new Proxy(window, { get: (target, key) => (key === 'location' ? { reload, search: '' } : key === 'fetch' ? fetch : Reflect.get(target, key, target)) }) as Window;

  it('draws the new version in place and says so', async () => {
    load(served({ edit: 'e1' }));
    start();
    const reload = vi.fn();
    const outcome = await updateCompiledStory(pageWindow(answer(served({ edit: 'e2', lede: 'in place' })) as never, reload));
    expect(outcome).toBe('morphed');
    expect(reload).not.toHaveBeenCalled();
    expect($('lede')!.textContent).toBe('in place');
  });

  it('reloads, keeping the reader\'s place, when the morph refuses', async () => {
    load(served({ edit: 'e1' }));
    start();
    const reload = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10, height: 20, width: 100, bottom: 30, left: 0, right: 100, x: 0, y: 10, toJSON: () => ({}) });
    const outcome = await updateCompiledStory(pageWindow(answer('gone', 404) as never, reload));
    expect(outcome).toBe('reloaded');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeReloadAnchor(window), 'the place the reload puts back').not.toBeNull();
  });

  it('coalesces versions that land while one is being drawn into one more pass', async () => {
    load(served({ edit: 'e1' }));
    start();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn()
      .mockImplementationOnce(async () => { await gate; return new Response(served({ edit: 'e2', lede: 'two' })); })
      .mockImplementationOnce(async () => new Response(served({ edit: 'e4', lede: 'four' })));
    const win = pageWindow(fetch as never);
    const first = updateCompiledStory(win);
    // Asked for while the first version is on its way: the fetch already under way cannot carry it.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const second = updateCompiledStory(win);
    const third = updateCompiledStory(win);
    release();
    await Promise.all([first, second, third]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect($('lede')!.textContent).toBe('four');
  });
});

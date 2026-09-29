/**
 * A COMPILED ISLAND, END TO END THROUGH THE RUNTIME (w2-compiler × w2-runtime).
 *
 * Server half (fixtures/compiled-island.server.ts, a plain node process so Solid's server entries
 * are the ones node resolves, as in the server bundle): the compiler generates the island, its SSR
 * module renders it over the shared build's server half (`createIslandRuntime` + `withIsland`, as
 * `render(data)` does).
 *
 * Browser half (here, jsdom): the same generated source compiled `generate: 'dom'` with
 * `moduleName: '@mx/rt'`, hydrated in place by the runtime's `hydrateIsland`. The served island root
 * is adopted, not replaced; static siblings stay the same nodes; a value change reaches the adopted
 * text.
 */
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as rt from '../rt';
import * as basic from '../kit/basic';
import * as dialog from '../kit/dialog';
import { evaluateModule, transformSolid } from '@/lib/compiled-page/bundle.server';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import type { IslandRef } from '@/lib/compiled-page/contract';
import { createDataflowStore } from '@/lib/story-runtime/store';
import type { DataflowStore } from '@/lib/story-runtime/store';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const SOURCE = '<Helmet><Value name="region" type="string" default="West" /></Helmet><div id="w"><h2 id="h">Static heading</h2><p id="r">{$region}</p><p id="after">Static after</p></div>';

interface ServerHalf { html: string; islands: string; browserCode: string; templateResource: string | null; islandRefs: IslandRef[]; flow: CompiledDataflow }
function serverHalf(source: string): ServerHalf {
  const out = execFileSync(path.join(ROOT, 'node_modules/.bin/tsx'), ['--tsconfig', path.join(ROOT, 'tsconfig.json'), 'lib/islands/__tests__/fixtures/compiled-island.server.ts', source], { cwd: path.join(ROOT, 'services/app'), maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.toString('utf8')) as ServerHalf;
}

describe('a compiled island through the runtime', () => {
  it('holds the first action for one lazy fetch, retries a failure, and preserves served content', async () => {
    const url = '/islands/t/aaaaaaaaaaaaaaaa.json';
    rt.configureTemplateResource(url);
    const host = document.createElement('div');
    host.innerHTML = '<button type="button">Open</button><p>Served</p>';
    document.body.append(host);
    let actions = 0;
    let hydrated = 0;
    host.querySelector('button')!.addEventListener('click', () => { actions++; });
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, json: () => ({ cold: '<p>cold</p>' }) });
    vi.stubGlobal('fetch', fetch);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = rt.installTemplateInteractionGate(host, document, () => { hydrated++; });
    host.querySelector('button')!.click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(host.querySelector('p')?.textContent).toBe('Served');
    expect(actions).toBe(0);
    host.querySelector('button')!.click();
    await vi.waitFor(() => expect(actions).toBe(1));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hydrated).toBe(1);
    host.querySelector('button')!.click();
    expect(actions).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop(); host.remove(); log.mockRestore(); vi.unstubAllGlobals(); rt.configureTemplateResource(null);
  });
  it('clones cold markup from an inert page template without executing hostile text', () => {
    const bank = document.createElement('template');
    bank.setAttribute('data-mx-island-template', 'cold');
    bank.innerHTML = '&lt;div&gt;&lt;span&gt;&amp;lt;/template&amp;gt;&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;&lt;/span&gt;&lt;/div&gt;';
    document.body.append(bank);
    const clone = rt.templateFromPage('cold')();
    expect((clone as Element).outerHTML).toBe('<div><span>&lt;/template&gt;&lt;script&gt;alert(1)&lt;/script&gt;</span></div>');
    bank.remove();
  });
  it('hydrates the shipped module without loading the cold template resource', async () => {
    const server = serverHalf('<Helmet><Value name="name" type="string" default="Ada" /></Helmet><section id="box" data-note="{$name}"><p id="static">Served static content</p><span>{$name}</span></section>');
    const host = document.createElement('div');
    host.innerHTML = server.html;
    document.body.append(host);
    const served = host.querySelector('#static');
    expect(server.browserCode).not.toContain('Served static content');
    expect(host.querySelector('[data-mx-island-template]')).toBeNull();
    const fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => JSON.parse(server.templateResource!) }));
    vi.stubGlobal('fetch', fetch);
    let islands: Array<[string, () => unknown]> = [];
    await evaluateModule(server.browserCode, spec => {
      if (spec === '/islands/rt.js') return rt as unknown as Record<string, unknown>;
      if (spec === '/islands/boot.js') return { boot: (value: typeof islands | { ISLANDS: typeof islands }) => { islands = Array.isArray(value) ? value : value.ISLANDS; } };
      throw new Error(`unexpected island import ${spec}`);
    }, 'test/shipped.js');
    const runtime = rt.createIslandRuntime({ dataflow: { flow: server.flow, values: { name: 'Ada' } } }, df => createDataflowStore(df));
    const dispose = rt.hydrateIsland(islands[0]![0], islands[0]![1] as never, runtime.context, host);
    expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector('#static')).toBe(served);
    runtime.context.setValue('name', 'Grace');
    expect(host.querySelector('#box')?.textContent).toContain('Grace');
    dispose?.(); runtime.dispose(); host.remove(); vi.unstubAllGlobals();
  });
  it('opens a dialog from the shipped module after hydration', async () => {
    const server = serverHalf('<Dialog><DialogTrigger>Open dialog</DialogTrigger><DialogContent aria-label="Test dialog"><p>Dialog body</p><DialogClose>Close</DialogClose></DialogContent></Dialog>');
    const host = document.createElement('div'); host.innerHTML = server.html; document.body.append(host);
    const fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => JSON.parse(server.templateResource!) }));
    vi.stubGlobal('fetch', fetch);
    let islands: Array<[string, () => unknown]> = [];
    await evaluateModule(server.browserCode, spec => {
      if (spec === '/islands/rt.js') return rt as unknown as Record<string, unknown>;
      if (spec === '/islands/kit-dialog.js') return dialog as unknown as Record<string, unknown>;
      if (spec === '/islands/boot.js') return { boot: (value: typeof islands | { ISLANDS: typeof islands }) => { islands = Array.isArray(value) ? value : value.ISLANDS; } };
      throw new Error(`unexpected island import ${spec}`);
    }, 'test/dialog-shipped.js');
    const runtime = rt.createIslandRuntime({ dataflow: { flow: server.flow } }, df => createDataflowStore(df));
    expect(fetch).not.toHaveBeenCalled();
    await rt.loadTemplateResource();
    const dispose = rt.hydrateIsland(islands[0]![0], islands[0]![1] as never, runtime.context, host);
    host.querySelector('button')?.click();
    expect(host.querySelector('[aria-label="Test dialog"]')?.hasAttribute('open')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    dispose?.(); runtime.dispose(); host.remove(); vi.unstubAllGlobals();
  });
  it('removes an adopted keyed row when the bridged table shrinks', async () => {
    const server = serverHalf('<Helmet><Value name="rows" type="table" value={[{"k":"a","label":"Alice"},{"k":"b","label":"Bob"},{"k":"c","label":"Carla"}]} /><Query name="ordered">{`select * from rows order by label`}</Query></Helmet><div id="w"><For each={$ordered} keyBy="k" id="f"><p>{$_row.label}</p></For></div>');
    const host = document.createElement('div');
    host.innerHTML = server.html;
    document.body.append(host);
    const code = await transformSolid(server.islands, { generate: 'dom', hydratable: true }, { moduleName: '@mx/rt' });
    const { ISLANDS } = await evaluateModule(code, spec => {
      if (spec === '@mx/rt') return rt as unknown as Record<string, unknown>;
      if (spec === '@mx/kit/basic') return basic as unknown as Record<string, unknown>;
      throw new Error(`unexpected island import ${spec}`);
    }, 'test/rows.js') as { ISLANDS: Array<[string, () => unknown]> };
    const columns = [{ name: 'k', type: 'string' as const }, { name: 'label', type: 'string' as const }];
    let rows = [{ k: 'a', label: 'Alice' }, { k: 'b', label: 'Bob' }, { k: 'c', label: 'Carla' }];
    const table = { columns, rows };
    let notify = () => {};
    const store = {
      getState: () => ({ values: {}, tables: { rows: table, ordered: table }, errors: {}, people: {} }),
      pending: () => [], subscribe: (fn: () => void) => { notify = fn; return () => {}; }, dispose: () => {},
    } as unknown as DataflowStore;
    const runtime = rt.createIslandRuntime({ dataflow: { flow: server.flow } }, () => store);
    const disposers = ISLANDS.map(([id, Island]) => rt.hydrateIsland(id, Island as never, runtime.context, host));
    expect(host.querySelector('#f')?.textContent).toContain('Alice');
    const cards = () => [...host.querySelectorAll('#f p')].map(node => node.textContent);
    rows = [{ k: 'c', label: 'Carla' }, { k: 'b', label: 'Bob' }, { k: 'a', label: 'Alice' }];
    table.rows = rows;
    notify();
    expect(cards()).toEqual(['Carla', 'Bob', 'Alice']);
    rows = [{ k: 'c', label: 'Carla' }, { k: 'b', label: 'Bob' }, { k: 'a', label: 'Alice updated' }];
    table.rows = rows;
    notify();
    expect(cards()).toEqual(['Carla', 'Bob', 'Alice updated']);
    rows = [{ k: 'c', label: 'Carla' }, { k: 'b', label: 'Bob' }];
    table.rows = rows;
    notify();
    expect(runtime.context.table('ordered')?.rows).toHaveLength(2);
    expect(cards()).toEqual(['Carla', 'Bob']);
    for (const dispose of disposers) dispose?.();
    runtime.dispose(); host.remove();
  });
  it('server-renders with the runtime, then hydrates in place: root adopted, siblings untouched, values live', async () => {
    const server = serverHalf(SOURCE);
    expect(server.islandRefs).toEqual([{ renderId: 's0-', path: '1.1', kit: [], readsData: true }]);
    expect(server.html).not.toContain('<mx-slot');

    const host = document.createElement('div');
    host.innerHTML = server.html;
    document.body.append(host);
    const [heading, served, after] = ['#h', '#r', '#after'].map((s) => host.querySelector(s));
    // withIsland's component levels are in the key: the island root is `<renderId>0000` in Solid 1.9.
    expect(served?.getAttribute('data-hk')).toBe('s0-0000');
    expect(served?.textContent).toBe('West');

    const code = await transformSolid(server.islands, { generate: 'dom', hydratable: true }, { moduleName: '@mx/rt' });
    const { ISLANDS } = await evaluateModule(code, (spec) => {
      if (spec === '@mx/rt') return rt as unknown as Record<string, unknown>;
      throw new Error(`the island module imports ${spec}, not only the runtime`);
    }, 'test/islands.js') as { ISLANDS: Array<[string, () => unknown]> };
    const runtime = rt.createIslandRuntime({ dataflow: { flow: server.flow, values: { region: 'West' } }, viewer: null }, (df) => createDataflowStore(df));
    const [renderId, Island] = ISLANDS[0]!;
    const dispose = rt.hydrateIsland(renderId, Island as never, runtime.context, host);

    expect(dispose).toBeTypeOf('function');
    expect(host.querySelector('#h')).toBe(heading);
    expect(host.querySelector('#after')).toBe(after);
    expect(host.querySelector('#r'), 'the served island root is adopted, not replaced').toBe(served);
    runtime.context.setValue('region', 'East');
    expect(served?.textContent).toBe('East');
    dispose!();
    runtime.dispose();
    host.remove();
  });

  it("serves a <For> wrapper's inline style as React writes it and hands it to hydration as an attribute", () => {
    // React's server renderer writes `min-height:1px`; today's hydration leaves a served attribute alone.
    const server = serverHalf('<Helmet><Value name="rows" type="table" value={[{"k":"a"},{"k":"b"}]} /></Helmet><div id="w"><For each={$rows} keyBy="k" id="f"><p id="i">{$_row.k}</p></For></div>');
    const host = document.createElement('div');
    host.innerHTML = server.html;
    expect(host.querySelector('#w > div')?.getAttribute('style')).toBe('min-height:1px');
    // As `attr:style`, Solid's hydration keeps the served string (setAttribute skips a hydrating node);
    // as `style`, it would rewrite it through the CSSOM (`min-height: 1px;`) — see the next case.
    expect(server.islands).toContain('attr:style={"min-height:1px"}');
    expect(server.islands).not.toMatch(/\sstyle=\{"min-height:1px"\}/);
  });

  it('a spread `attr:style` survives hydration byte for byte, where a spread `style` is rewritten', () => {
    const flow: CompiledDataflow = { imports: [], mutations: [], queries: [], values: [] };
    const tmpl = rt.template('<div id="x"></div>');
    const hydrateWith = (key: string) => {
      const host = document.createElement('div');
      host.innerHTML = '<div data-hk="s0-0000" id="x" style="min-height:1px"></div>';
      document.body.append(host);
      const served = host.firstElementChild;
      const runtime = rt.createIslandRuntime({ dataflow: { flow } }, (df) => createDataflowStore(df));
      const dispose = rt.hydrateIsland('s0-', () => { const el = rt.getNextElement(tmpl); rt.spread(el, { [key]: 'min-height:1px' }, false, false); return el; }, runtime.context, host);
      const out = { adopted: host.firstElementChild === served, style: host.firstElementChild?.getAttribute('style') };
      dispose?.(); runtime.dispose(); host.remove();
      return out;
    };
    expect(hydrateWith('attr:style')).toEqual({ adopted: true, style: 'min-height:1px' });
    expect(hydrateWith('style')).toEqual({ adopted: true, style: 'min-height: 1px;' });
  });
});

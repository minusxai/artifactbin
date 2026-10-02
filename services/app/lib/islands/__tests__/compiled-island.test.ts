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
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import * as rt from '../rt';
import { evaluateModule } from '@/lib/compiled-page/bundle.server';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import type { CompiledDataflow } from '@/lib/story/data/compiled-dataflow';
import type { IslandRef } from '@/lib/compiled-page/contract';
import { createDataflowStore } from '@/lib/story-runtime/store';
import type { DataflowStore } from '@/lib/story-runtime/store';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const SOURCE = '<Helmet><Value name="region" type="string" default="West" /></Helmet><div id="w"><h2 id="h">Static heading</h2><p id="r">{$region}</p><p id="after">Static after</p></div>';

interface ServerHalf { html: string; islands: string; browserCode: string; templateResource: string | null; islandRefs: IslandRef[]; flow: CompiledDataflow }
/** Every server half these cases render, compiled (a node process each) in parallel before the first case. */
const CALLS: Array<[string, boolean?, unknown?]> = [
  ['<Helmet><Value name="name" type="string" default="Ada" /></Helmet><section id="box" data-note="{$name}"><p id="static">Served static content</p><span>{$name}</span></section>'],
  ['<Dialog><DialogTrigger>Open dialog</DialogTrigger><DialogContent aria-label="Test dialog"><p>Dialog body</p><DialogClose>Close</DialogClose></DialogContent></Dialog>', true],
  ['<Helmet><Value name="rows" type="table" value={[{"k":"a","label":"Alice"},{"k":"b","label":"Bob"},{"k":"c","label":"Carla"}]} /><Query name="ordered">{`select * from rows order by label`}</Query></Helmet><div id="w"><For each={$ordered} keyBy="k" id="f"><p>{$_row.label}</p></For></div>', true],
  ['<Helmet><Query name="m">{`select 1 as month, 10 as revenue union all select 2, 14`}</Query></Helmet><div id="w"><h1 id="h">Heading</h1><Tabs defaultValue="a"><TabsList><TabsTrigger value="a">Chart</TabsTrigger><TabsTrigger value="b">Notes</TabsTrigger></TabsList><TabsContent value="a"><Question title="Revenue" data="$m" height="240px" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"quantitative"},"y":{"field":"revenue","type":"quantitative"}}}}} /></TabsContent><TabsContent value="b"><p id="notes">Notes tab.</p></TabsContent></Tabs><div id="row"><Input placeholder="Type here" /><Badge>New</Badge></div><p id="end">Closing</p></div>', true, { tables: { m: { columns: [{ name: 'month', type: 'number' }, { name: 'revenue', type: 'number' }], rows: [{ month: 1, revenue: 10 }, { month: 2, revenue: 14 }] } }, errors: {} }],
  [SOURCE],
  ['<Helmet><Value name="rows" type="table" value={[{"k":"a"},{"k":"b"}]} /></Helmet><div id="w"><For each={$rows} keyBy="k" id="f"><p id="i">{$_row.k}</p></For></div>'],
];
const compileServerHalf = async (source: string, shipped = false, results?: unknown): Promise<ServerHalf> => {
  const { stdout } = await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/tsx'), ['--tsconfig', path.join(ROOT, 'tsconfig.json'), 'lib/islands/__tests__/fixtures/compiled-island.server.ts', source, ...(shipped ? ['--shipped'] : []), ...(results ? [`--results=${JSON.stringify(results)}`] : [])], { cwd: path.join(ROOT, 'services/app'), maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout) as ServerHalf;
};
const compiled = new Map<string, ServerHalf>();
beforeAll(async () => {
  await Promise.all(CALLS.map(async (call) => { compiled.set(JSON.stringify(call), await compileServerHalf(...call)); }));
}, 120_000);
function serverHalf(...call: [string, boolean?, unknown?]): ServerHalf {
  const found = compiled.get(JSON.stringify(call));
  if (!found) throw new Error('a server half outside CALLS');
  return found;
}
async function shipped(spec: string): Promise<Record<string, unknown>> {
  const url = loadCompilerBuild().manifest[spec]!;
  return import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, 'services/app/public', url)).href) as Promise<Record<string, unknown>>;
}

describe('a compiled island through the runtime', () => {
  // Retired the lazy template action-gate assertion: new modules do not request shell template resources.
  // Retired the inert page-template clone assertion: new modules use native Solid factories, not shell clones.
  it('hydrates the shipped module without loading the cold template resource', async () => {
    const server = serverHalf(...CALLS[0]);
    const host = document.createElement('div');
    host.innerHTML = server.html;
    document.body.append(host);
    const served = host.querySelector('#static');
    expect(server.browserCode).not.toContain('Served static content');
    expect(host.querySelector('[data-mx-island-template]')).toBeNull();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    let tree: () => unknown = () => null;
    await evaluateModule(server.browserCode, spec => {
      if (spec === '/islands/rt.js') return rt as unknown as Record<string, unknown>;
      if (spec === '/islands/boot.js') return { boot: (value: { TREE: () => unknown }) => { tree = value.TREE; } };
      throw new Error(`unexpected island import ${spec}`);
    }, 'test/shipped.js');
    const runtime = rt.createIslandRuntime({ dataflow: { flow: server.flow, values: { name: 'Ada' } } }, df => createDataflowStore(df));
    const dispose = rt.hydrateIsland('d-', tree as never, runtime.context, host);
    expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector('#static')).toBe(served);
    runtime.context.setValue('name', 'Grace');
    expect(host.querySelector('#box')?.textContent).toContain('Grace');
    dispose?.(); runtime.dispose(); host.remove(); vi.unstubAllGlobals();
  });
  it('opens a dialog from the shipped module after hydration', async () => {
    const server = serverHalf(...CALLS[1]);
    const host = document.createElement('div'); host.innerHTML = server.html; document.body.append(host);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const [shippedRt, shippedDialog] = await Promise.all([shipped('@mx/rt'), shipped('@mx/kit/dialog')]);
    let tree: () => unknown = () => null;
    await evaluateModule(server.browserCode, spec => {
      if (spec.includes('/rt-')) return shippedRt;
      if (spec.includes('/kit-dialog-')) return shippedDialog;
      if (spec.includes('/boot-')) return { boot: (value: { TREE: () => unknown }) => { tree = value.TREE; } };
      throw new Error(`unexpected island import ${spec}`);
    }, 'test/dialog-shipped.js');
    const runtime = (shippedRt.createIslandRuntime as typeof rt.createIslandRuntime)({ dataflow: { flow: server.flow } }, shippedRt.createDataflowStore as typeof createDataflowStore);
    expect(fetch).not.toHaveBeenCalled();
    const dispose = (shippedRt.hydrateIsland as typeof rt.hydrateIsland)('d-', tree as never, runtime.context, host);
    host.querySelector('button')?.click();
    expect(host.querySelector('[aria-label="Test dialog"]')?.hasAttribute('open')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    dispose?.(); runtime.dispose(); host.remove(); vi.unstubAllGlobals();
  });
  it('removes an adopted keyed row when the bridged table shrinks', async () => {
    const server = serverHalf(...CALLS[2]);
    const host = document.createElement('div');
    host.innerHTML = server.html;
    document.body.append(host);
    let tree: () => unknown = () => null;
    const [shippedRt, shippedBasic] = await Promise.all([shipped('@mx/rt'), shipped('@mx/kit/basic')]);
    await evaluateModule(server.browserCode, spec => {
      if (spec.includes('/rt-')) return shippedRt;
      if (spec.includes('/kit-basic-')) return shippedBasic;
      if (spec.includes('/boot-')) return { boot: (value: { TREE: () => unknown }) => { tree = value.TREE; } };
      throw new Error(`unexpected island import ${spec}`);
    }, 'test/rows.js');
    const columns = [{ name: 'k', type: 'string' as const }, { name: 'label', type: 'string' as const }];
    let rows: Array<{ k: string; label: string }> = [];
    const table = { columns, rows };
    let notify = () => {};
    const store = {
      getState: () => ({ values: {}, tables: { rows: table, ordered: table }, errors: {}, people: {} }),
      pending: () => [], subscribe: (fn: () => void) => { notify = fn; return () => {}; }, dispose: () => {},
    } as unknown as DataflowStore;
    const runtime = (shippedRt.createIslandRuntime as typeof rt.createIslandRuntime)({ dataflow: { flow: server.flow } }, () => store);
    const dispose = (shippedRt.hydrateIsland as typeof rt.hydrateIsland)('d-', tree as never, runtime.context, host);
    rows = [{ k: 'a', label: 'Alice' }, { k: 'b', label: 'Bob' }, { k: 'c', label: 'Carla' }];
    table.rows = rows;
    notify();
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
    dispose?.();
    runtime.dispose(); host.remove();
  });
  it('hydrates a Question inside Tabs beside an Input without losing the page', async () => {
    // Regression: the chart host, built while hydrating, was not yet in the document when its engine
    // deferral read `ownerDocument.documentElement` (an inert template document: null).
    const server = serverHalf(...CALLS[3]);
    const host = document.createElement('div');
    host.innerHTML = server.html;
    document.body.append(host);
    const heading = host.querySelector('#h');
    const errors: unknown[] = [];
    const log = vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
    const kits = new Map<string, Record<string, unknown>>();
    const shippedRt = await shipped('@mx/rt');
    await Promise.all(['basic', 'tabs', 'controls', 'data'].map(async name => { kits.set(name, await shipped(`@mx/kit/${name}`)); }));
    let tree: () => unknown = () => null;
    await evaluateModule(server.browserCode, spec => {
      if (spec.includes('/rt-')) return shippedRt;
      if (spec.includes('/boot-')) return { boot: (value: { TREE: () => unknown }) => { tree = value.TREE; } };
      const kit = /\/kit-(\w+)-/.exec(spec)?.[1];
      if (kit && kits.has(kit)) return kits.get(kit)!;
      throw new Error(`unexpected island import ${spec}`);
    }, 'test/tabs-question.js');
    const columns = [{ name: 'month', type: 'number' as const }, { name: 'revenue', type: 'number' as const }];
    const table = { columns, rows: [{ month: 1, revenue: 10 }, { month: 2, revenue: 14 }] };
    const store = {
      getState: () => ({ values: {}, tables: { m: table }, errors: {}, people: {} }), getTable: () => table, getValue: () => null, flow: server.flow,
      pending: () => [], subscribe: () => () => {}, dispose: () => {},
    } as unknown as DataflowStore;
    const runtime = (shippedRt.createIslandRuntime as typeof rt.createIslandRuntime)({ dataflow: { flow: server.flow } }, () => store);
    const dispose = (shippedRt.hydrateIsland as typeof rt.hydrateIsland)('d-', tree as never, runtime.context, host);
    await new Promise(resolve => setTimeout(resolve, 50));
    log.mockRestore();
    expect(errors, 'hydration raised no error').toEqual([]);
    expect(host.querySelector('#h'), 'the page text is kept').toBe(heading);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(host.querySelector('input[placeholder="Type here"]')).not.toBeNull();
    host.querySelectorAll<HTMLElement>('[role="tab"]')[1]!.click();
    expect(host.querySelector('#notes')?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false);
    dispose?.(); runtime.dispose(); host.remove();
  });
  it('server-renders with the runtime, then hydrates in place: root adopted, siblings untouched, values live', async () => {
    const server = serverHalf(...CALLS[4]);
    // The deleted per-island path is represented by a single document root.
    expect(server.islandRefs).toEqual([{ renderId: 'd-', path: '0', kit: [], readsData: true }]);
    expect(server.html).not.toContain('<mx-slot');

    const host = document.createElement('div');
    host.innerHTML = server.html;
    document.body.append(host);
    const [heading, served, after] = ['#h', '#r', '#after'].map((s) => host.querySelector(s));
    expect(host.querySelector('.mx-doc')?.getAttribute('data-hk')).toBe('d-0000');
    expect(served?.textContent).toBe('West');

    let tree: () => unknown = () => null;
    await evaluateModule(server.browserCode, (spec) => {
      if (spec === '/islands/rt.js') return rt as unknown as Record<string, unknown>;
      if (spec === '/islands/boot.js') return { boot: (value: { TREE: () => unknown }) => { tree = value.TREE; } };
      throw new Error(`the island module imports ${spec}, not only the runtime`);
    }, 'test/islands.js');
    const runtime = rt.createIslandRuntime({ dataflow: { flow: server.flow, values: { region: 'West' } }, viewer: null }, (df) => createDataflowStore(df));
    const dispose = rt.hydrateIsland('d-', tree as never, runtime.context, host);

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
    const server = serverHalf(...CALLS[5]);
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

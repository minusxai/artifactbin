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
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as rt from '../rt';
import { evaluateModule, transformSolid } from '@/lib/compiled-page/bundle.server';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import type { IslandRef } from '@/lib/compiled-page/contract';
import { createDataflowStore } from '@/lib/story-runtime/store';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const SOURCE = '<Helmet><Value name="region" type="string" default="West" /></Helmet><div id="w"><h2 id="h">Static heading</h2><p id="r">{$region}</p><p id="after">Static after</p></div>';

interface ServerHalf { html: string; islands: string; islandRefs: IslandRef[]; flow: CompiledDataflow }
function serverHalf(source: string): ServerHalf {
  const out = execFileSync(path.join(ROOT, 'node_modules/.bin/tsx'), ['--tsconfig', path.join(ROOT, 'tsconfig.json'), 'lib/islands/__tests__/fixtures/compiled-island.server.ts', source], { cwd: path.join(ROOT, 'services/app'), maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.toString('utf8')) as ServerHalf;
}

describe('a compiled island through the runtime', () => {
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

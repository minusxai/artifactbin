import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { CompiledPage } from '@/lib/compiled-page/contract';
import { loadOfflineHalf, packCompiledBrowserModule, type OfflineHalf } from '../compiled-bundle.server';

const page = (module: CompiledPage['module'], manifest: Record<string, string> = { '@mx/boot': '/islands/boot-1111111111111111.js' }): CompiledPage => ({
  build: 'build', sharedBuild: { id: 'build', manifest },
  outline: [], outlinePlan: false, html: '', islands: [], module, ssr: null,
  behaviors: [], plan: null, links: { prefetch: [], prerender: [] },
  kit: { skeleton: [], islands: [] }, reactStatic: [], unported: [], partial: [], authorScript: null,
});

/** A stand-in offline half: CommonJS factories as buildOfflineHalf writes them. */
const half: OfflineHalf = {
  entries: { '@mx/boot': 'boot.js', '@mx/rt': 'rt.js' },
  lazy: { sqlite: 'sqlite.js', chart: 'chart.js' },
  modules: {
    'boot.js': { code: 'var c=require("./chunk.js");exports.boot=function(){globalThis.answer=c.value;globalThis.flags=self.__mxOfflineFlags;globalThis.lazy=Promise.resolve().then(()=>require("./sqlite.js"));globalThis.lazy.catch(()=>{});};', imports: ['chunk.js'], dynamic: ['sqlite.js'] },
    'rt.js': { code: 'exports.rt=1;', imports: [], dynamic: [] },
    'chunk.js': { code: 'exports.value=42;', imports: [], dynamic: [] },
    'sqlite.js': { code: 'exports.engine="sqlite";', imports: [], dynamic: [] },
    'chart.js': { code: 'exports.engine="vega";', imports: [], dynamic: [] },
  },
};
const ref = (sha: string) => ({ sha, url: `/islands/d/${sha}.js`, bytes: 0, imports: [] });
const run = (code: string) => {
  const context: { globalThis?: unknown; self?: unknown; answer?: number; flags?: unknown; lazy?: Promise<{ engine: string }> } = {};
  context.globalThis = context; context.self = context;
  new Script(code).runInNewContext(context);
  return context;
};

describe('packCompiledBrowserModule', () => {
  it('packs the document over the prebuilt offline half into one classic script with inline templates', async () => {
    const packed = await packCompiledBrowserModule(page(ref('3333333333333333')), {
      module: new TextEncoder().encode('import { boot } from "@mx/boot"; const resource = "/islands/t/4444444444444444.json"; boot();'),
      template: async () => new TextEncoder().encode('{"x":"<div>offline</div>"}'),
      half, offline: { sqlite: false, chart: false },
    });
    expect(packed?.templates).toEqual({ x: '<div>offline</div>' });
    expect(packed?.code).not.toMatch(/\/islands\/|^\s*(?:import|export)\s/m);
    // Only the closure the module reaches: no runtime it never imports, no engine the file does not need.
    expect(packed?.code).not.toContain('"rt.js"');
    expect(packed?.code).not.toContain('__mxOfflineDefine("sqlite.js"');
    const context = run(packed!.code);
    expect(context.answer).toBe(42);
    expect(context.flags).toEqual({ sqlite: false, chart: false });
    await expect(context.lazy).rejects.toThrow(/not in this file/);
  });

  it('packs a boot-only engine when the file needs it', async () => {
    const packed = await packCompiledBrowserModule(page(ref('3333333333333333')), {
      module: new TextEncoder().encode('import { boot } from "@mx/boot"; boot();'), half, offline: { sqlite: true, chart: false },
    });
    expect(packed?.code).not.toContain('__mxOfflineDefine("chart.js"');
    expect(await run(packed!.code).lazy).toMatchObject({ engine: 'sqlite' });
  });

  it('runs an older module that names its pinned build\'s chunk URLs, including a bare side-effect import', async () => {
    const packed = await packCompiledBrowserModule(page(ref('3333333333333333'), { '@mx/boot': '/islands/boot-1111111111111111.js' }), {
      module: new TextEncoder().encode('import "/islands/boot-1111111111111111.js"; import { boot } from "/islands/boot-1111111111111111.js"; boot();'), half,
    });
    expect(run(packed!.code).answer).toBe(42);
  });

  it('does not load a browser module for static prose', async () => {
    expect(await packCompiledBrowserModule(page(null), { half })).toBeNull();
  });

  it('refuses a module import outside the build', async () => {
    await expect(packCompiledBrowserModule(page(ref('3333333333333333')), {
      module: new TextEncoder().encode('import "/islands/stranger-9999999999999999.js";'), half,
    })).rejects.toThrow(/unpinned asset/);
  });

  it('the island build\'s offline half names every runtime specifier and both boot-only engines', async () => {
    const built = await loadOfflineHalf();
    for (const specifier of ['@mx/rt', '@mx/boot', '@mx/kit/controls', '@mx/kit/data']) expect(built.modules[built.entries[specifier]!]).toBeDefined();
    expect(built.modules[built.lazy.sqlite]).toBeDefined();
    expect(built.modules[built.lazy.chart]).toBeDefined();
    // The boot the file runs is the snapshot boot, never the network reader's.
    expect(built.modules[built.entries['@mx/boot']!]!.code).toContain('__mxOfflineFlags');
  });
});

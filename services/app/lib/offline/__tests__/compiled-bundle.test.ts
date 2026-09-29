import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { CompiledPage } from '@/lib/compiled-page/contract';
import { packCompiledBrowserModule } from '../compiled-bundle.server';

const page = (module: CompiledPage['module']): CompiledPage => ({
  build: 'build', sharedBuild: { id: 'build', manifest: { '@mx/boot': '/islands/boot-1111111111111111.js' } },
  outline: [], outlinePlan: false, html: '', islands: [], module, ssr: null,
  behaviors: [], plan: null, links: { prefetch: [], prerender: [] },
  kit: { skeleton: [], islands: [] }, reactStatic: [], unported: [], partial: [], authorScript: null,
});

describe('packCompiledBrowserModule', () => {
  it('packs the document and shared closure into one classic script with inline templates', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'afbin-offline-pack-'));
    try {
      await writeFile(path.join(dir, 'boot-1111111111111111.js'), 'import { value } from "./chunk-2222222222222222.js"; globalThis.answer = value;');
      await writeFile(path.join(dir, 'chunk-2222222222222222.js'), 'export const value = 42;');
      const packed = await packCompiledBrowserModule(page({ sha: '3333333333333333', url: '/islands/d/3333333333333333.js', bytes: 0, imports: ['/islands/boot-1111111111111111.js'] }), {
        module: new TextEncoder().encode('import "/islands/boot-1111111111111111.js"; const resource = "/islands/t/4444444444444444.json";'),
        sharedDir: dir,
        template: async () => new TextEncoder().encode('{"x":"<div>offline</div>"}'),
      });
      expect(packed?.templates).toEqual({ x: '<div>offline</div>' });
      expect(packed?.code).not.toMatch(/\/islands\/|\bimport\b/);
      const context = { globalThis: { answer: 0 } };
      new Script(packed!.code).runInNewContext(context);
      expect(context.globalThis.answer).toBe(42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not load a browser module for static prose', async () => {
    expect(await packCompiledBrowserModule(page(null))).toBeNull();
  });

  it('refuses a module import outside its pinned shared closure', async () => {
    await expect(packCompiledBrowserModule(page({ sha: '3333333333333333', url: '/islands/d/3333333333333333.js', bytes: 0, imports: [] }), {
      module: new TextEncoder().encode('import "/islands/stranger-9999999999999999.js";'),
    })).rejects.toThrow(/unpinned asset/);
  });
});

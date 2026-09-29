import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as rt from '../rt';
import { createDataflowStore } from '@/lib/story-runtime/store';
import { evaluateModule } from '@/lib/compiled-page/bundle.server';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import type { Component } from 'solid-js';
import { brotliCompressSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { kitchenSinkMarkup } from '@/lib/story/kitchen-sink';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const fixture = (source: string): { html: string; browserCode: string; flow: CompiledDataflow } => JSON.parse(execFileSync(
  path.join(ROOT, 'node_modules/.bin/tsx'),
  ['--tsconfig', path.join(ROOT, 'tsconfig.json'), 'lib/islands/__tests__/fixtures/compiled-island.server.ts', source, '--shipped'],
  { cwd: path.join(ROOT, 'services/app'), maxBuffer: 64 * 1024 * 1024 },
).toString('utf8'));

describe('one tree SSR to hydrate', () => {
  it('adopts static siblings and updates the live expression with aligned keys', async () => {
    const server = fixture('<Helmet><Value name="name" type="string" default="Ada" /></Helmet><h1 id="heading">Static heading</h1><p id="live">{$name}</p><footer id="end">Static footer</footer>');
    const host = document.createElement('div');
    host.innerHTML = server.html;
    document.body.append(host);
    const heading = host.querySelector('#heading');
    const live = host.querySelector('#live');
    const footer = host.querySelector('#end');
    const keys = host.querySelectorAll('[data-hk]').length;
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let tree: Component | null = null;
    await evaluateModule(server.browserCode, spec => {
      if (spec.includes('/rt-')) return rt as unknown as Record<string, unknown>;
      if (spec.includes('/boot-')) return { boot: (module: { TREE: Component }) => { tree = module.TREE; } };
      throw new Error(`unexpected import ${spec}`);
    }, 'test/one-tree.js');
    expect(tree).not.toBeNull();
    const runtime = rt.createIslandRuntime({ dataflow: { flow: server.flow, values: { name: 'Ada' } } }, df => createDataflowStore(df));
    const dispose = rt.hydrateDocument(tree!, runtime.context, host);
    expect(dispose).toBeTypeOf('function');
    expect(host.querySelector('#heading')).toBe(heading);
    expect(host.querySelector('#live')).toBe(live);
    expect(host.querySelector('#end')).toBe(footer);
    expect(host.querySelectorAll('[data-hk]')).toHaveLength(keys);
    runtime.context.setValue('name', 'Grace');
    expect(live?.textContent).toBe('Grace');
    expect(warnings).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    dispose?.();
    expect(host.querySelector('#heading')).toBe(heading);
    runtime.dispose(); host.remove(); warnings.mockRestore(); errors.mockRestore();
  });

  it('hydrates shipped Tabs with 1,100 static rows and a sibling live Switch', async () => {
    const rows = Array.from({ length: 1_100 }, (_, i) => `<p id="row-${i}">Static row ${i}</p>`).join('');
    const server = fixture(`<Helmet><Value name="flag" type="boolean" default={false} /></Helmet><Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one"><p id="first">First panel</p></TabsContent><TabsContent value="two">${rows}</TabsContent></Tabs><Switch label="Live switch" checked="$flag" id="live-switch" />`);
    const host = document.createElement('div'); host.innerHTML = server.html; document.body.append(host);
    const last = host.querySelector('#row-1099');
    const first = host.querySelector('#first');
    const keys = [...host.querySelectorAll('[data-hk]')].map(el => el.getAttribute('data-hk'));
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const manifest = loadCompilerBuild().manifest;
    const shipped = async (specifier: string): Promise<Record<string, unknown>> => {
      const file = path.resolve(ROOT, 'services/app/public', manifest[specifier]!.slice(1));
      return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<Record<string, unknown>>;
    };
    const [shippedRt, tabs, controls] = await Promise.all([shipped('@mx/rt'), shipped('@mx/kit/tabs'), shipped('@mx/kit/controls')]);
    let tree: Component | null = null;
    await evaluateModule(server.browserCode, spec => {
      if (spec.includes('/rt-')) return shippedRt;
      if (spec.includes('/kit-tabs-')) return tabs;
      if (spec.includes('/kit-controls-')) return controls;
      if (spec.includes('/boot-')) return { boot: (module: { TREE: Component }) => { tree = module.TREE; } };
      throw new Error(`unexpected import ${spec}`);
    }, 'test/one-tree-kit.js');
    const runtime = (shippedRt.createIslandRuntime as typeof rt.createIslandRuntime)({ dataflow: { flow: server.flow, values: { flag: false } } }, shippedRt.createDataflowStore as typeof createDataflowStore);
    const dispose = (shippedRt.hydrateDocument as typeof rt.hydrateDocument)(tree!, runtime.context, host);
    expect(dispose).toBeTypeOf('function');
    expect(host.querySelector('#row-1099')).toBe(last);
    expect(host.querySelector('#first')).toBe(first);
    expect([...host.querySelectorAll('[data-hk]')].map(el => el.getAttribute('data-hk'))).toEqual(keys);
    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click();
    expect(host.querySelector('#row-1099')).toBe(last);
    expect(last?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false);
    const toggle = host.querySelector<HTMLElement>('[role="switch"]')!;
    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(brotliCompressSync(server.browserCode).byteLength).toBeLessThan(5 * 1024);
    expect(warnings).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    dispose?.(); runtime.dispose(); host.remove(); warnings.mockRestore(); errors.mockRestore();
  });

  it('hydrates the kitchen sink through the shipped one-tree runtime', async () => {
    const source = kitchenSinkMarkup({ dataset: 'Data01', recipe: 'Viz001', image: 'Image1', pdf: 'Paper1' });
    const server = fixture(source);
    const host = document.createElement('div'); host.innerHTML = server.html; document.body.append(host);
    expect(host.querySelectorAll<HTMLElement>('[data-slot="accordion-content"]')[1]?.textContent).toContain('Collapsed until clicked.');
    const pageData = host.querySelector('script[data-mx-module-data]')?.cloneNode(true) as HTMLScriptElement | undefined;
    if (pageData) { pageData.id = 'mx-story-data'; document.body.append(pageData); }
    for (const match of server.browserCode.matchAll(/document\.querySelector\(['"]([^'"]+)['"]\)/g)) {
      expect(document.querySelector(match[1]!)).not.toBeNull();
    }
    let tree: Component | null = null;
    const modules = new Map<string, Record<string, unknown>>();
    const specifiers = [...server.browserCode.matchAll(/from\s*["'](\/islands\/[^"']+)["']/g)].map(match => match[1]!);
    await Promise.all([...new Set(specifiers)].map(async specifier => {
      if (specifier.includes('/boot-')) return;
      const file = path.resolve(ROOT, 'services/app/public', specifier.slice(1));
      modules.set(specifier, await import(/* @vite-ignore */ pathToFileURL(file).href) as Record<string, unknown>);
    }));
    await evaluateModule(server.browserCode, specifier => specifier.includes('/boot-')
      ? { boot: (module: { TREE: Component }) => { tree = module.TREE; } }
      : modules.get(specifier)!, 'test/one-tree-kitchen.js');
    expect(tree).not.toBeNull();
    const shippedRt = modules.get(loadCompilerBuild().manifest['@mx/rt']!)!;
    const portal = document.createElement('div'); document.body.append(portal);
    const runtime = (shippedRt.createIslandRuntime as typeof rt.createIslandRuntime)({ dataflow: { flow: server.flow, values: {} } }, shippedRt.createDataflowStore as typeof createDataflowStore, { trustedPortal: () => portal });
    (shippedRt.hydrateDocument as typeof rt.hydrateDocument)(tree!, runtime.context, host);
    const dialogText = host.querySelector('dialog p');
    expect(dialogText?.textContent).toContain('Dialog content opened from the gallery.');
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Open dialog')!.click();
    expect(portal.querySelector('dialog p')).toBe(dialogText);
    expect(portal.querySelector('dialog button')?.textContent).toBe('Close');
    portal.querySelector<HTMLButtonElement>('dialog button')!.click();
    expect(host.querySelector('dialog p')).toBe(dialogText);
    const secondPanel = host.querySelectorAll<HTMLElement>('[data-slot="accordion-content"]')[1]!;
    expect(secondPanel.textContent).toContain('Collapsed until clicked.');
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Accordion section B'))!.click();
    expect(secondPanel.hidden).toBe(false);
    expect(secondPanel.textContent).toContain('Collapsed until clicked.');
    runtime.dispose(); host.remove(); pageData?.remove(); portal.remove();
  });
});

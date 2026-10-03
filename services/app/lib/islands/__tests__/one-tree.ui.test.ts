import { beforeAll, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import * as rt from '../rt';
import { createDataflowStore } from '@/lib/story-runtime/store';
import { evaluateModule } from '@/lib/compiled-page/bundle.server';
import type { CompiledDataflow } from '@/lib/story/data/compiled-dataflow';
import type { Component } from 'solid-js';
import { pathToFileURL } from 'node:url';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { morphDraftDom } from '../morph/engine';
import { delegateEvents, hydrate } from 'solid-js/web';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
type Fixture = { html: string; browserCode: string; flow: CompiledDataflow };
const tabs = (heading: string) => `<p id="f6">${heading}</p><Tabs defaultValue="one" id="tabs"><TabsList id="list"><TabsTrigger value="one" id="t1">One</TabsTrigger><TabsTrigger value="two" id="t2">Two</TabsTrigger></TabsList><TabsContent value="one" id="p1"><p id="panel">Panel one</p></TabsContent><TabsContent value="two" id="p2"><p>Panel two</p></TabsContent></Tabs>`;
const rows = Array.from({ length: 20 }, (_, i) => `<p id="row-${i}">Static row ${i}</p>`).join('');
/** Every page these cases hydrate, compiled by the server half (a node process each) in parallel before the first case. */
const SOURCES = {
  flagBefore: '<Helmet><Value name="flag" type="boolean" default={false} /></Helmet><p id="f6">Before</p><p id="live">{$flag ? "On" : "Off"}</p>',
  flagAfter: '<Helmet><Value name="flag" type="boolean" default={false} /></Helmet><p id="f6">EDITED IN PLACE</p><p id="live">{$flag ? "On" : "Off"}</p>',
  tabsBefore: tabs('Before'),
  // The edit adds a block ahead of the unchanged Tabs, so every hydration key after it moves.
  tabsAfter: tabs('EDITED IN PLACE').replace('<Tabs', '<p id="added">Added</p><Tabs'),
  branch: '<Helmet><Value name="open" type="boolean" default={false} /></Helmet><section id="case">{$open && <p aria-label="Positive">positive</p>}</section>',
  siblings: '<Helmet><Value name="name" type="string" default="Ada" /></Helmet><h1 id="heading">Static heading</h1><p id="live">{$name}</p><footer id="end">Static footer</footer>',
  rows: `<Helmet><Value name="flag" type="boolean" default={false} /></Helmet><Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one"><p id="first">First panel</p></TabsContent><TabsContent value="two">${rows}</TabsContent></Tabs><Switch label="Live switch" checked="$flag" id="live-switch" />`,
  bound: '<Helmet><Value name="region" type="string" default="west" /><Value name="pick" type="string" default="https://example.test/a.png" /></Helmet><input aria-label="Region" value="$region" /><img src="$pick" alt="the pick" />',
};
const compiled = new Map<string, Fixture>();
beforeAll(async () => {
  await Promise.all(Object.values(SOURCES).map(async (source) => {
    const { stdout } = await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/tsx'),
      ['--tsconfig', path.join(ROOT, 'tsconfig.json'), 'lib/islands/__tests__/fixtures/compiled-island.server.ts', source, '--shipped'],
      { cwd: path.join(ROOT, 'services/app'), maxBuffer: 64 * 1024 * 1024 });
    compiled.set(source, JSON.parse(stdout) as Fixture);
  }));
}, 120_000);
const fixture = (source: string): Fixture => compiled.get(source) ?? (() => { throw new Error('a source outside SOURCES'); })();

describe('one tree SSR to hydrate', () => {
  it('keeps authored prose present while a draft replaces a hydrated document tree', async () => {
    const before = fixture(SOURCES.flagBefore);
    const after = fixture(SOURCES.flagAfter);
    const host = document.createElement('div'); host.innerHTML = before.html; document.body.append(host);
    const next = document.createElement('div'); next.innerHTML = after.html;
    const treeOf = async (code: string, id: string): Promise<Component> => {
      let tree: Component | null = null;
      await evaluateModule(code, spec => spec.includes('/rt-') ? rt as unknown as Record<string, unknown>
        : spec.includes('/boot-') ? { boot: (module: { TREE: Component }) => { tree = module.TREE; } }
        : (() => { throw new Error(`unexpected import ${spec}`); })(), id);
      return tree!;
    };
    const runtime = rt.createIslandRuntime({ dataflow: { flow: before.flow, values: { flag: false } } }, df => createDataflowStore(df));
    const painted = host.querySelector('[data-hk^="d-"]')!;
    const paintCopy = painted.cloneNode(true);
    const dispose = rt.hydrateIsland('d-', await treeOf(before.browserCode, 'test/draft-before.js'), runtime.context, host);
    dispose?.();
    painted.replaceWith(paintCopy);
    morphDraftDom(host, next, new Set(), new Set());
    const disposeDraft = rt.hydrateIsland('d-', await treeOf(after.browserCode, 'test/draft-after.js'), runtime.context, host);
    expect(host.querySelector('#f6')?.textContent).toBe('EDITED IN PLACE');
    expect(host.querySelector('#live')?.textContent).toBe('Off');
    disposeDraft?.(); runtime.dispose(); host.remove();
  });

  it('re-hydrates a draft after the reader has clicked and keys have moved, keeping static runs inside a kept Tabs', async () => {
    const before = fixture(SOURCES.tabsBefore);
    const after = fixture(SOURCES.tabsAfter);
    const host = document.createElement('div'); host.innerHTML = before.html; document.body.append(host);
    const next = document.createElement('div'); next.innerHTML = after.html;
    const manifest = loadCompilerBuild().manifest;
    const shipped = async (specifier: string): Promise<Record<string, unknown>> => {
      const file = path.resolve(ROOT, 'services/app/public', manifest[specifier]!.slice(1));
      return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<Record<string, unknown>>;
    };
    const [shippedRt, kit] = await Promise.all([shipped('@mx/rt'), shipped('@mx/kit/tabs')]);
    const treeOf = async (code: string, id: string): Promise<Component> => {
      let tree: Component | null = null;
      await evaluateModule(code, spec => spec.includes('/rt-') ? shippedRt
        : spec.includes('/kit-tabs-') ? kit
        : spec.includes('/boot-') ? { boot: (module: { TREE: Component }) => { tree = module.TREE; } }
        : (() => { throw new Error(`unexpected import ${spec}`); })(), id);
      return tree!;
    };
    const hydrateIsland = shippedRt.hydrateIsland as typeof rt.hydrateIsland;
    const runtime = (shippedRt.createIslandRuntime as typeof rt.createIslandRuntime)({ dataflow: { flow: before.flow } }, shippedRt.createDataflowStore as typeof createDataflowStore);
    const dispose = hydrateIsland('d-', await treeOf(before.browserCode, 'test/tabs-before.js'), runtime.context, host);
    expect([...host.querySelectorAll('[role=tab]')].map((tab) => tab.textContent)).toEqual(['One', 'Two']);
    // The page's own Solid (the app chrome) hydrated too; the reader's first click on anything it
    // delegates ends hydration for EVERY Solid on the page (the shared `globalThis._$HY.done`).
    const chrome = document.createElement('button');
    document.body.append(chrome);
    hydrate(() => null, chrome);
    delegateEvents(['click']);
    (chrome as unknown as { $$click: () => void }).$$click = () => {};
    chrome.click();
    expect((globalThis as { _$HY?: { done?: boolean } })._$HY?.done).toBe(true);
    chrome.remove();
    dispose?.();
    const keptTabs = host.querySelector('#tabs');
    morphDraftDom(host, next, new Set(['tabs']), new Set());
    expect(host.querySelector('#tabs')).toBe(keptTabs);
    const disposeDraft = hydrateIsland('d-', await treeOf(after.browserCode, 'test/tabs-after.js'), runtime.context, host);
    expect(host.querySelector('#f6')?.textContent).toBe('EDITED IN PLACE');
    expect(host.querySelector('#added')?.textContent).toBe('Added');
    expect([...host.querySelectorAll('[role=tab]')].map((tab) => tab.textContent)).toEqual(['One', 'Two']);
    expect(host.querySelector('#t1')?.hasAttribute('data-hk')).toBe(true);
    expect(host.querySelector('#panel')?.textContent).toBe('Panel one');
    disposeDraft?.(); runtime.dispose(); host.remove();
  });

  it('mounts static content when a false server branch becomes true in the browser', async () => {
    const server = fixture(SOURCES.branch);
    const host = document.createElement('div'); host.innerHTML = server.html; document.body.append(host);
    let tree: Component | null = null;
    await evaluateModule(server.browserCode, spec => spec.includes('/rt-') ? rt as unknown as Record<string, unknown>
      : spec.includes('/boot-') ? { boot: (module: { TREE: Component }) => { tree = module.TREE; } }
      : (() => { throw new Error(`unexpected import ${spec}`); })(), 'test/one-tree-branch.js');
    const runtime = rt.createIslandRuntime({ dataflow: { flow: server.flow, values: { open: false } } }, df => createDataflowStore(df));
    const dispose = rt.hydrateIsland('d-', tree!, runtime.context, host);
    expect(host.querySelector('[aria-label="Positive"]')).toBeNull();
    runtime.context.setValue('open', true);
    expect(host.querySelector('[aria-label="Positive"]')?.textContent).toBe('positive');
    dispose?.(); runtime.dispose(); host.remove();
  });
  it('adopts static siblings and updates the live expression with aligned keys', async () => {
    const server = fixture(SOURCES.siblings);
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
    const dispose = rt.hydrateIsland('d-', tree!, runtime.context, host);
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

  it('hydrates shipped Tabs with server-owned static rows in an unopened panel and a sibling live Switch', async () => {
    const server = fixture(SOURCES.rows);
    const host = document.createElement('div'); host.innerHTML = server.html; document.body.append(host);
    const last = host.querySelector('#row-19');
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
    const dispose = (shippedRt.hydrateIsland as typeof rt.hydrateIsland)('d-', tree!, runtime.context, host);
    expect(dispose).toBeTypeOf('function');
    expect(host.querySelector('#row-19')).toBe(last);
    expect(host.querySelector('#first')).toBe(first);
    expect([...host.querySelectorAll('[data-hk]')].map(el => el.getAttribute('data-hk'))).toEqual(keys);
    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click();
    expect(host.querySelector('#row-19')).toBe(last);
    expect(last?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false);
    const toggle = host.querySelector<HTMLElement>('[role="switch"]')!;
    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(warnings).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    dispose?.(); runtime.dispose(); host.remove(); warnings.mockRestore(); errors.mockRestore();
  });

  it('keeps a bound native input live after hydration, and serves a bound image without its unresolved template', async () => {
    const server = fixture(SOURCES.bound);
    const host = document.createElement('div'); host.innerHTML = server.html; document.body.append(host);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Region"]')!;
    const image = host.querySelector<HTMLImageElement>('img[alt="the pick"]')!;
    expect(input.value).toBe('west');
    // The server never writes the unresolved template as a source; the image island resolves it.
    expect(image.getAttribute('src')).toBeNull();
    const manifest = loadCompilerBuild().manifest;
    const shippedRt = await import(/* @vite-ignore */ pathToFileURL(path.resolve(ROOT, 'services/app/public', manifest['@mx/rt']!.slice(1))).href) as Record<string, unknown>;
    const modules = new Map<string, Record<string, unknown>>();
    for (const match of server.browserCode.matchAll(/from\s*["'](\/islands\/[^"']+)["']/g)) {
      if (!match[1]!.includes('/boot-')) modules.set(match[1]!, await import(/* @vite-ignore */ pathToFileURL(path.resolve(ROOT, 'services/app/public', match[1]!.slice(1))).href) as Record<string, unknown>);
    }
    let tree: Component | null = null;
    await evaluateModule(server.browserCode, spec => spec.includes('/boot-')
      ? { boot: (module: { TREE: Component }) => { tree = module.TREE; } }
      : modules.get(spec) ?? (() => { throw new Error(`unexpected import ${spec}`); })(), 'test/one-tree-bound.js');
    const runtime = (shippedRt.createIslandRuntime as typeof rt.createIslandRuntime)({ dataflow: { flow: server.flow, values: { region: 'west', pick: 'https://example.test/a.png' } } }, shippedRt.createDataflowStore as typeof createDataflowStore);
    const dispose = (shippedRt.hydrateIsland as typeof rt.hydrateIsland)('d-', tree!, runtime.context, host);
    expect(host.querySelector('input[aria-label="Region"]')).toBe(input);
    runtime.context.setValue('region', 'east');
    expect(input.value).toBe('east');
    // The image island owns the source from here (resolution through the asset door: bound-image.test).
    expect(host.querySelector('img[alt="the pick"]')).toBe(image);
    dispose?.(); runtime.dispose(); host.remove();
  });
});

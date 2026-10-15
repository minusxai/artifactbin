/**
 * TEMPLATES, SERVED AND HYDRATED: `{$value}` and `{$query.column}` in attribute strings and text, rendered by
 * the SSR module with the reader's link values and then adopted by the browser module. A crafted link
 * (`?$link=javascript:…`, `?$c=red;background:url(…)`) renders inert on both sides; a safe change after
 * hydration updates the attribute in place; the static siblings stay the server's nodes.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Component } from 'solid-js';
import * as rt from '../rt';
import * as templates from '../kit/templates';
import { createDataflowStore } from '@/lib/page-store/store';
import { evaluateModule } from '@/lib/compiled-page/bundle.server';
import type { CompiledDataflow } from '@/lib/dataflow';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
type Fixture = { html: string; browserCode: string; flow: CompiledDataflow };

const SECURITY = '<Helmet><Value name="link" type="string" default="https://example.test/ok" /><Value name="c" type="string" default="red" /></Helmet>'
  + '<h2 id="static">Static heading</h2><a id="link" href="{$link}" title="Open {$link}">Go</a><p id="styled" style="color:{$c};font-weight:600">Styled</p>';
const CRAFTED = { link: 'javascript:alert(1)', c: 'red;background:url(https://x.test/leak)' };
const CELLS = '<Helmet><Value name="tiles" type="table" value={[{"cheap_v": 3.5, "label": "Rust"}]} columns={[{"name":"cheap_v","type":"number"},{"name":"label","type":"string"}]} /></Helmet>'
  + '<p id="cell">Cheapest: {$tiles.cheap_v}</p><div id="labelled" title="{$tiles.label} costs {$tiles.cheap_v}">x</div>';

const compiled = new Map<string, Fixture>();
const compile = async (key: string, source: string, values?: Record<string, unknown>) => {
  const { stdout } = await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/tsx'),
    ['--tsconfig', path.join(ROOT, 'tsconfig.json'), 'lib/islands/__tests__/fixtures/compiled-island.server.ts', source, ...(values ? [`--values=${JSON.stringify(values)}`] : [])],
    { cwd: path.join(ROOT, 'services/app'), maxBuffer: 64 * 1024 * 1024 });
  compiled.set(key, JSON.parse(stdout) as Fixture);
};
beforeAll(async () => {
  await Promise.all([compile('crafted', SECURITY, CRAFTED), compile('cells', CELLS)]);
}, 120_000);

async function hydrateFixture(fixture: Fixture, values: Record<string, unknown>) {
  const host = document.createElement('div');
  host.innerHTML = fixture.html;
  document.body.append(host);
  let tree: Component | null = null;
  await evaluateModule(fixture.browserCode, (spec) => {
    if (/\/rt[-.]/.test(spec)) return rt as unknown as Record<string, unknown>;
    if (/\/kit-templates[-.]/.test(spec)) return templates as unknown as Record<string, unknown>;
    if (/\/boot[-.]/.test(spec)) return { boot: (module: { TREE: Component }) => { tree = module.TREE; } };
    throw new Error(`unexpected import ${spec}`);
  }, `test/templates-${Math.random()}.js`);
  const runtime = rt.createIslandRuntime({ dataflow: { flow: fixture.flow, values: values as never } }, (df) => createDataflowStore(df));
  return { host, tree: tree!, runtime };
}

describe('a crafted link renders inert', () => {
  it('on the server: no javascript: href, no smuggled declaration in style', () => {
    const doc = new DOMParser().parseFromString(compiled.get('crafted')!.html, 'text/html');
    expect(doc.querySelector('#link')!.hasAttribute('href')).toBe(false);
    expect(doc.querySelector('#link')!.getAttribute('title')).toBe('Open javascript:alert(1)');
    expect(doc.querySelector('#styled')!.getAttribute('style')).toBe('color:;font-weight:600');
    expect(compiled.get('crafted')!.html).not.toContain('x.test/leak');
    expect(compiled.get('crafted')!.html).not.toMatch(/href="[^"]*javascript/);
  });

  it('in the browser: hydration adopts the inert tree, and a safe value then fills it in place', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { host, tree, runtime } = await hydrateFixture(compiled.get('crafted')!, CRAFTED);
    const heading = host.querySelector('#static');
    const link = host.querySelector('#link')!;
    const styled = host.querySelector('#styled')!;
    const dispose = rt.hydrateIsland('d-', tree, runtime.context, host);
    expect(dispose).toBeTypeOf('function');
    expect(host.querySelector('#static')).toBe(heading);
    expect(host.querySelector('#link')).toBe(link);
    expect(link.hasAttribute('href')).toBe(false);
    expect(styled.getAttribute('style')).toBe('color:;font-weight:600');
    runtime.context.setValue('link', 'https://example.test/next');
    runtime.context.setValue('c', 'rgb(0, 0, 255)');
    expect(link.getAttribute('href')).toBe('https://example.test/next');
    expect(link.getAttribute('title')).toBe('Open https://example.test/next');
    expect(styled.getAttribute('style')).toBe('color:rgb(0, 0, 255);font-weight:600');
    runtime.context.setValue('link', 'java\tscript:alert(2)');
    runtime.context.setValue('c', 'blue}*{color:red');
    expect(link.hasAttribute('href')).toBe(false);
    expect(styled.getAttribute('style')).toBe('color:;font-weight:600');
    expect(errors).not.toHaveBeenCalled();
    dispose?.(); runtime.dispose(); host.remove(); errors.mockRestore();
  });
});

describe('a query cell', () => {
  it('renders the first row in text and in an attribute, served and live', async () => {
    const fixture = compiled.get('cells')!;
    const doc = new DOMParser().parseFromString(fixture.html, 'text/html');
    expect(doc.querySelector('#cell')!.textContent).toBe('Cheapest: 3.5');
    expect(doc.querySelector('#labelled')!.getAttribute('title')).toBe('Rust costs 3.5');
    const { host, tree, runtime } = await hydrateFixture(fixture, {});
    const dispose = rt.hydrateIsland('d-', tree, runtime.context, host);
    expect(host.querySelector('#cell')!.textContent).toBe('Cheapest: 3.5');
    expect(host.querySelector('#labelled')!.getAttribute('title')).toBe('Rust costs 3.5');
    dispose?.(); runtime.dispose(); host.remove();
  });
});

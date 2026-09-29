import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as rt from '../rt';
import { createDataflowStore } from '@/lib/story-runtime/store';
import { evaluateModule } from '@/lib/compiled-page/bundle.server';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import type { Component } from 'solid-js';

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
});

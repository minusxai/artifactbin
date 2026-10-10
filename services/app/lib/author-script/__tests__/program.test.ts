import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { buildLambdaModule } from '../program.server';
import type { CompiledDataflow } from '@/lib/dataflow';
import type { RunAnswer } from '@/lib/page-store/dataflow-core';

const flow: CompiledDataflow = {
  imports: [{ name: 'd', ref: 'DS1234', tables: [{ name: 'rows', columns: [{ name: 'month', type: 'string' }] }] }],
  values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'west' }],
  queries: [{ name: 'monthly', engine: 'sqlite', sql: 'select month from d.rows where region = $region', params: ['region'], reads: { imports: ['d'], queries: [], values: ['region'], builtins: [] }, columns: [{ name: 'month', type: 'string' }], start: 0, end: 0 }],
  mutations: [],
};

// Import the actual self-contained module: no DOM, browser vendor chunks or global page binding.
async function load(script: string, declarations = flow) {
  const code = await buildLambdaModule(script, declarations);
  expect(Buffer.byteLength(code)).toBeLessThan(256 * 1024);
  const bundled = await transform(code, { format: 'iife', globalName: 'TestProgram' });
  return runInNewContext(bundled.code + ';TestProgram.default', { console });
}

describe('headless Lambda page module', () => {
  it('waits for cold rows and reruns the same query after a signal changes', async () => {
    const run = await load(`import { signal, query } from 'page';
      import { createMemo } from 'solid-js';
      const [region, setRegion] = signal('$region'); const monthly = query('$monthly');
      const label = createMemo(() => region() + ':' + monthly().length);
      export default async function () {
        const first = await monthly.ready; setRegion('east');
        const second = await monthly.ready; return { first, second, label: label() };
      }`);
    const call = vi.fn(async (operation: string, args: { values: { region: string } }): Promise<RunAnswer> => {
      expect(operation).toBe('lambda_query');
      return { tables: { monthly: { rows: [{ month: args.values.region }], columns: [{ name: 'month', type: 'string' }] } }, errors: {} };
    });
    await expect(run({}, { artifactbin: { call } })).resolves.toEqual({ first: [{ month: 'west' }], second: [{ month: 'east' }], label: 'east:1' });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('waits for mutation access, sends declaration arguments, and refreshes dependent rows after commit without timers or crypto', async () => {
    const declarations: CompiledDataflow = { ...flow, mutations: [{
      name: 'rename', sql: 'update d.rows set region = $region', target: { import: 'd', table: 'rows' },
      args: [{ name: 'region', type: 'string' }], reads: { imports: ['d'], queries: [], values: ['region'], builtins: [] },
      notifies: true, start: 0, end: 0,
    }] };
    const run = await load(`import { query, mutation } from 'page';
      const monthly = query('$monthly'); const rename = mutation('$rename');
      export default async function(input: { region: string }) {
        await rename({ region: input.region }); return await monthly.ready;
      }`, declarations);
    let renamed = false;
    const call = vi.fn(async (operation: string, args: any) => {
      if (operation === 'lambda_query') return { tables: { monthly: { rows: [{ month: renamed ? 'new' : 'old' }], columns: [] } }, errors: {}, mutationAccess: { rename: null } };
      expect(operation).toBe('lambda_mutate');
      expect(args).toMatchObject({ mutation: 'rename', args: { region: 'east' }, operationKey: 'lambda-operation-1' });
      renamed = true; return { dataset: 'DS1234' };
    });
    await expect(run({ region: 'east' }, { artifactbin: { call } })).resolves.toEqual([{ month: 'new' }]);
    expect(call.mock.calls.map(([operation]) => operation)).toEqual(['lambda_query', 'lambda_mutate', 'lambda_query']);
  });

  it('propagates query errors', async () => {
    const run = await load("import { query } from 'page'; const monthly = query('$monthly'); export default async () => await monthly.ready;");
    await expect(run({}, { artifactbin: { call: async () => ({ tables: {}, errors: { monthly: 'dataset access revoked' } }) } })).rejects.toThrow('dataset access revoked');
  });

  it('does not send a mutation refused by the host access check', async () => {
    const declarations: CompiledDataflow = { ...flow, mutations: [{
      name: 'rename', sql: 'update d.rows set region = $region', target: { import: 'd', table: 'rows' },
      args: [{ name: 'region', type: 'string' }], reads: { imports: ['d'], queries: [], values: ['region'], builtins: [] }, start: 0, end: 0,
    }] };
    const run = await load("import { mutation } from 'page'; const rename = mutation('$rename'); export default () => rename({ region: 'east' });", declarations);
    const call = vi.fn(async () => ({ tables: {}, errors: {}, mutationAccess: { rename: 'dataset is read-only' } }));
    await expect(run({}, { artifactbin: { call } })).rejects.toThrow('dataset is read-only');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('drains initial reads even when the author does not await a query', async () => {
    const run = await load('export default () => 7;');
    let release!: (answer: RunAnswer) => void;
    let finished = false;
    const pending = run({}, { artifactbin: { call: () => new Promise<RunAnswer>((resolve) => { release = resolve; }) } }).then((output: unknown) => { finished = true; return output; });
    await Promise.resolve(); expect(finished).toBe(false);
    release({ tables: { monthly: { rows: [], columns: [] } }, errors: {} });
    await expect(pending).resolves.toBe(7);
  });

  it('validates declaration bindings and rejects DOM and external module imports', async () => {
    await expect(buildLambdaModule("import { query } from 'page'; const q = query('$missing'); export default () => q();", flow)).rejects.toThrow(/declares no missing/);
    await expect(buildLambdaModule("import { render } from 'solid-js/web'; export default () => render;", flow)).rejects.toThrow(/headless|not allowed/);
    await expect(buildLambdaModule("import x from 'https://example.com/code.js'; export default () => x;", flow)).rejects.toThrow(/not allowed/);
    await expect(buildLambdaModule("export default () => import('https://example.com/code.js');", flow)).rejects.toThrow(/not allowed/);
    await expect(buildLambdaModule("export default (name) => import(name);", flow)).rejects.toThrow(/not allowed/);
    await expect(buildLambdaModule("import { proxy } from 'page'; export default () => proxy('https://example.com');", flow)).rejects.toThrow(/proxy/);
    await expect(buildLambdaModule("export const Main = () => 1;", flow)).rejects.toThrow(/default/);
  });
});

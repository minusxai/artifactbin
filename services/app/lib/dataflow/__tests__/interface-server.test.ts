/**
 * lib/dataflow's `server` and `references` entries, and its evaluator: the `$name` lexer, reference ids and write
 * refusals, recipe and encoding checks, broken embeds, the data-syntax marker, the loader-driven compile, and
 * evaluateDataflow/evaluateDataflowMany over an in-memory engine that echoes what it was asked.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RunInput, SqlService } from '@artifactbin/contracts';
import { compiledSource } from '@/test/helpers/compiled';
import { DataflowResultError, evaluateDataflow, evaluateDataflowMany, type CompiledDataflow } from '..';
import {
  bindParameters, compileWithLoader, DATA_SYNTAX_META, datasetSqlParams, hasCurrentDataSyntax, refId, validateRecipeUse,
  validateVizAgainstColumns, writeRefusal,
} from '../server';
import { findBrokenEmbeds } from '../references';
import { parseJsx, type JsxElement } from '@/lib/jsx';
import { EMPTY_DATAFLOW, type Dataflow } from '..';
import { parseDeclaration } from '../dataflow';

describe('the $name lexer', () => {
  it('binds each $name outside strings and comments', () => {
    expect(bindParameters('select $a, $b_1 from t where x = $a', (n) => `:${n}`)).toBe('select :a, :b_1 from t where x = :a');
    expect(bindParameters(`select '$a', "$b", $c -- $d\n/* $e */`, (n) => `?${n}`)).toBe(`select '$a', "$b", ?c  \n `);
    expect(bindParameters('', () => 'x')).toBe('');
  });

  it('keeps doubled quotes and nested comments whole', () => {
    expect(bindParameters(`select 'it''s $a', $b /* /* $c */ */`, (n) => n.toUpperCase())).toBe(`select 'it''s $a', B  `);
  });

  it.each([['an unterminated comment', 'select /* $a'], ['an unterminated string', "select '$a"]])('throws on %s', (_label, sql) => {
    expect(() => bindParameters(sql, (n) => n)).toThrow(/Dataset SQL/);
  });

  it('datasetSqlParams lists names once, in first-appearance order', () => {
    expect(datasetSqlParams('select $b, $a, $b from t')).toEqual(['b', 'a']);
    expect(datasetSqlParams("select '$x' -- $y")).toEqual([]);
  });
});

describe('references and write refusals', () => {
  it('refId reads an exact reference id', () => {
    expect(refId('ref:Abc123')).toBe('Abc123');
    for (const v of ['ref:ab', 'ref:Abc123/x', 'Abc123', null, 7, undefined, 'ref:Abcdefghijklm']) expect(refId(v), String(v)).toBeNull();
  });

  it('writeRefusal: own writable datasets pass; folders, others and read-only ones are refused by name', () => {
    expect(writeRefusal({ id: 'D1', format: 'dataset', owned: true, access: 'readwrite' } as never)).toBeNull();
    expect(writeRefusal({ id: 'D1', format: 'folder', owned: true, access: 'readwrite' } as never)).toMatch(/not yours to write/);
    expect(writeRefusal({ id: 'D1', format: 'dataset', owned: false, access: 'readwrite' } as never)).toMatch(/not yours to write/);
    expect(writeRefusal({ id: 'D1', format: 'dataset', owned: true, access: 'read' } as never)).toMatch(/ref:D1 is read-only/);
    expect(writeRefusal({ id: 'D1', format: 'dataset', owned: false, access: 'read', datasetPolicy: { version: 2 } } as never)).toBeNull();
  });
});

describe('recipe and encoding checks', () => {
  const recipe = { bindings: [
    { name: 'x', accepts: ['temporal'] }, { name: 'y', accepts: ['quantitative'] }, { name: 'color', accepts: ['nominal'], optional: true },
  ] } as never;
  const columns = [{ name: 'day', type: 'date' }, { name: 'total', type: 'number' }, { name: 'label', type: 'string' }] as never;

  it('accepts a fully bound recipe, and skips column checks without columns', () => {
    expect(validateRecipeUse({ bindings: { x: 'day', y: 'total' } }, recipe, columns, 'r')).toEqual([]);
    expect(validateRecipeUse({ bindings: { x: 'nope', y: 'gone' } }, recipe, null, 'r')).toEqual([]);
  });

  it('names an unbound slot, an array on a single slot, an unknown slot, a missing column and a wrong kind', () => {
    const errors = validateRecipeUse({ bindings: { y: ['total'], extra: 'day', color: 'missing' } }, recipe, columns, 'minusx/trend@1');
    expect(errors).toEqual(expect.arrayContaining([
      'recipe minusx/trend@1 slot "x" is not bound',
      expect.stringContaining('slot "y" takes a single column, not an array'),
      'recipe minusx/trend@1 has no slot "extra"',
      expect.stringContaining('binds "missing" — not a dataset column'),
    ]));
    expect(validateRecipeUse({ bindings: { x: 'label', y: 'total' } }, recipe, columns, 'r')[0]).toMatch(/accepts temporal but "label" is nominal/);
  });

  it('validateVizAgainstColumns checks vega encodings only, and skips transforms', () => {
    const spec = { mark: 'bar', encoding: { x: { field: 'day' }, y: { field: 'nope' } } };
    expect(validateVizAgainstColumns({ kind: 'vega-lite', spec }, [{ name: 'day' }], '$q')).toEqual(['encoding field "nope" is not a column of $q (columns: day)']);
    expect(validateVizAgainstColumns({ kind: 'vega-lite', spec }, [{ name: 'day' }, { name: 'nope' }], '$q')).toEqual([]);
    expect(validateVizAgainstColumns({ kind: 'recipe', spec }, [], '$q')).toEqual([]);
    expect(validateVizAgainstColumns({ kind: 'vega-lite' }, [], '$q')).toEqual([]);
    expect(validateVizAgainstColumns({ kind: 'vega-lite', spec: { ...spec, transform: [{ calculate: '1', as: 'nope' }] } }, [{ name: 'day' }], '$q')).toEqual([]);
  });
});

describe('findBrokenEmbeds', () => {
  it('names an embed missing the prop that carries its data, and an unknown aggregate', () => {
    const errors = findBrokenEmbeds('<Chart source="ref:Abc123" question="x" /><Number data="$q" agg="mean" />');
    expect(errors.some((e) => e.tag === 'Chart')).toBe(true);
    expect(errors.find((e) => e.attr === 'agg')?.message).toMatch(/^<Number agg>: expected one of .*"mean" is avg/);
  });

  it('answers nothing for sound or unparseable source', () => {
    expect(findBrokenEmbeds('<Cell data="$q" agg="sum" />')).toEqual([]);
    expect(findBrokenEmbeds('<p>no embeds</p>')).toEqual([]);
    expect(findBrokenEmbeds('<Chart')).toEqual([]);
  });
});

describe('the data-syntax marker', () => {
  it('is current only for exactly the marker the write merges in', () => {
    expect(hasCurrentDataSyntax(DATA_SYNTAX_META)).toBe(true);
    expect(hasCurrentDataSyntax({ ...DATA_SYNTAX_META, other: 1 })).toBe(true);
    expect(hasCurrentDataSyntax(JSON.parse(JSON.stringify(DATA_SYNTAX_META)))).toBe(true);
    for (const meta of [null, undefined, {}, { dataSyntax: 1 }, { dataSyntax: String(DATA_SYNTAX_META.dataSyntax) }, 'x']) {
      expect(hasCurrentDataSyntax(meta), JSON.stringify(meta)).toBe(false);
    }
  });
});

/** A Helmet's declarations, read with this module's own grammar (lib/document's split is above this module). */
const declarations = (helmet: string): Dataflow => {
  const parsed = parseJsx(`<Helmet>${helmet}</Helmet>`);
  if (!parsed.ok) throw new Error(parsed.error);
  const flow: Dataflow = { ...EMPTY_DATAFLOW, imports: [], values: [], queries: [], mutations: [] };
  for (const child of (parsed.nodes[0] as JsxElement).children) {
    const d = child.type === 'element' ? parseDeclaration(child) : null;
    if (d && 'kind' in d) (flow[({ import: 'imports', value: 'values', query: 'queries', mutation: 'mutations' } as const)[d.kind as 'import']] as unknown[]).push(d.decl);
  }
  return flow;
};

describe('compileWithLoader', () => {
  it('compiles with nothing but the loader, and names an import the loader cannot find', async () => {
    const flow = declarations('<Import name="b" src="ref:BookRows1" /><Query name="q">{`select id from b.rows`}</Query>');
    const load = vi.fn(async (ref: string) => ref === 'BookRows1' ? { kind: 'dataset' as const, tables: [{ name: 'rows', columns: [{ name: 'id', type: 'number' as const }] }] } : null);
    const ok = await compileWithLoader(flow, load);
    expect(ok.ok && ok.compiled.queries[0]?.columns).toEqual([{ name: 'id', type: 'number' }]);
    expect(load).toHaveBeenCalledWith('BookRows1');
    const missing = await compileWithLoader(flow, async () => null);
    expect(missing.ok).toBe(false);
  });
});

describe('the evaluator', () => {
  const source = '<Helmet><Value name="n" type="number" default={3} /><Value name="t" type="table" value={[{"a":1}]} />'
    + '<Query name="q">{`select $n as v`}</Query><Query name="w">{`select a from t`}</Query></Helmet><p>{$n}</p>';
  let flow: CompiledDataflow;
  const compiled = async () => (flow ??= await compiledSource(source));
  /** Answers each query with the run's params as one row, so a test sees what was bound. */
  const echo = (input: Omit<RunInput, 'catalog'>) => Object.fromEntries(input.queries.map((q) => [q.name, q.name === 'q'
    ? { columns: [{ name: 'v', type: 'number' as const }], rows: [{ v: Object.values(input.params)[0] ?? null }] }
    : { columns: [{ name: 'a', type: 'number' as const }], rows: input.tables.t?.rows ?? [] }]));

  it('runs every query with defaults bound, and carries table Values verbatim', async () => {
    const run = vi.fn(async (input: RunInput) => echo(input));
    const state = await evaluateDataflow({ run: run as SqlService['run'] }, await compiled(), {});
    expect(state.values).toEqual({ n: 3 });
    expect(state.tables.q?.rows).toEqual([{ v: 3 }]);
    expect(state.tables.w?.rows).toEqual([{ a: 1 }]);
    expect(state.tables.t?.rows).toEqual([{ a: 1 }]);
    expect(state.errors).toEqual({});
    expect(run.mock.calls[0]![0].tables._me?.rows).toEqual([{ id: null }]);
  });

  it('applies declared overrides only, runs only what was asked, and records a failure by name', async () => {
    const run = vi.fn(async (input: RunInput) => ({ ...echo(input), w: { error: 'boom' } }));
    const state = await evaluateDataflow({ run: run as SqlService['run'] }, await compiled(), {}, { values: { n: 9, zz: 1 }, only: ['q'] });
    expect(state.values).toEqual({ n: 9 });
    expect(state.tables.q?.rows).toEqual([{ v: 9 }]);
    expect(run.mock.calls[0]![0].queries.map((q: { name: string }) => q.name)).toEqual(['q']);
    const failed = await evaluateDataflow({ run: run as SqlService['run'] }, await compiled(), {});
    expect(failed.errors.w).toBe('boom');
  });

  it('a durable consumer gets complete results or a DataflowResultError', async () => {
    const truncated = async (input: RunInput) => Object.fromEntries(Object.entries(echo(input)).map(([k, v]) => [k, { ...v, truncated: true }]));
    await expect(evaluateDataflow({ run: truncated as SqlService['run'] }, await compiled(), {}, { completeResults: true })).rejects.toThrow(DataflowResultError);
    const error = new DataflowResultError('timeout');
    expect(error.reason).toBe('timeout');
    expect(error.message).toBe('Document query timeout: complete results required');
    expect(error).toBeInstanceOf(Error);
  });

  it('evaluateDataflowMany answers one state per run, in order, with or without runMany', async () => {
    const run = vi.fn(async (input: RunInput) => echo(input));
    const runs = [{ values: { n: 1 } }, { values: { n: 2 } }];
    const states = await evaluateDataflowMany({ run: run as SqlService['run'] }, await compiled(), {}, {}, runs);
    expect(states.map((s) => s.tables.q?.rows)).toEqual([[{ v: 1 }], [{ v: 2 }]]);
    const runMany = vi.fn(async (input: { runs: Array<Omit<RunInput, 'imports'>> }) => input.runs.map((r) => echo(r as RunInput)));
    const many = await evaluateDataflowMany({ run: run as SqlService['run'], runMany: runMany as unknown as SqlService['runMany'] }, await compiled(), {}, {}, runs);
    expect(runMany).toHaveBeenCalledTimes(1);
    expect(many.map((s) => s.values)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(await evaluateDataflowMany({ run: run as SqlService['run'] }, await compiled(), {}, {}, [])).toEqual([]);
  });
});

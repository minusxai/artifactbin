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
  bindParameters, datasetSqlParams,
} from '../server';

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

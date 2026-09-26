import { describe, expect, it } from 'vitest';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import type { QueryOutcome, RunInput, SqlService } from '@artifactbin/contracts';
import { comparable, diffStatements, type DiffSide } from '../diff';
import { translateSql } from '../translate';

const sqlite = createSqliteSql({ maxRows: 1000, timeoutMs: 5000 });
const tables: RunInput['tables'] = {
  ref_nums: {
    columns: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }, { name: 'c', type: 'number' }, { name: 'name', type: 'string' }, { name: 'day', type: 'date' }],
    rows: [
      { a: 7, b: 2, c: 3, name: 'Alpha', day: '2026-01-15' },
      { a: -7, b: 2, c: 4, name: 'alpine', day: '2026-02-01' },
      { a: 1, b: 3, c: 5, name: 'Beta', day: '2026-02-28' },
    ],
  },
};
const side = (service: SqlService, extra: Partial<DiffSide> = {}): DiffSide => ({ service, tables, ...extra });

/** A service that answers each query from a fixed table of outcomes, recording what it was asked. */
function stub(answers: Record<string, QueryOutcome>, seen: RunInput[] = []): SqlService {
  const unused = () => Promise.reject(new Error('not used'));
  return {
    run: async (input) => { seen.push(input); return Object.fromEntries(input.queries.map((q) => [q.name, answers[q.sql] ?? { error: `no answer for ${q.sql}` }])); },
    mutate: unused, dryRun: unused, dryRunMutations: unused,
  };
}

// DuckDB is gone from the product: the rehearsal records the BEFORE side at the pre-compiler
// commit (scripts/migrate/sqlite). Here both sides are the one engine, so what is under test is
// the diff itself running real statements — a same verdict, a changed meaning, a failure.
describe('diffStatements on the SQLite engine', () => {
  it('goes red when a translation changes meaning: SQLite LIKE ignores ASCII case, GLOB does not', async () => {
    const [verdict] = await diffStatements(
      { cases: [{ name: 'alps', original: `select name from ref_nums where name like 'al%'`, translated: `select name from ref_nums where name glob 'al*'` }] },
      { original: side(sqlite), translated: side(sqlite) },
    );
    expect(verdict).toEqual({ name: 'alps', status: 'different', rows: { missing: [['Alpha']], extra: [] } });
  });

  it('a midnight timestamp equals the date it starts', async () => {
    const [verdict] = await diffStatements(
      { cases: [{ name: 'months', original: `select date_trunc('month', day) || 'T00:00:00.000Z' as m from ref_nums`, translated: `select date_trunc('month', day) as m from ref_nums` }] },
      { original: side(sqlite), translated: side(sqlite) },
    );
    expect(verdict).toEqual({ name: 'months', status: 'same' });
  });

  it('runs a document\'s cases as one run, so a query reads an earlier one by name', async () => {
    const verdicts = await diffStatements({
      cases: [
        { name: 'big', original: 'select a, b from ref_nums where a > $min', translated: 'select a, b from ref_nums where a > $min' },
        { name: 'ratio', original: 'select a * 1.0 / b as r from big', translated: translateSql('select a / b as r from big', { statement: 'query' }).sql },
      ],
      params: { min: 0 },
    }, { original: side(sqlite), translated: side(sqlite) });
    expect(verdicts).toEqual([{ name: 'big', status: 'same' }, { name: 'ratio', status: 'same' }]);
  });

  it('reports a statement that fails on one side with that side\'s message', async () => {
    const [verdict] = await diffStatements({ cases: [{ name: 'bad', original: 'select a from ref_nums', translated: 'select missing from ref_nums' }] }, { original: side(sqlite), translated: side(sqlite) });
    expect(verdict).toMatchObject({ name: 'bad', status: 'failed', translated: expect.stringMatching(/missing/) });
    expect(verdict).not.toHaveProperty('original');
  });
});

describe('diffStatements seam and comparison', () => {
  it('each side runs with its own tables and parameters: the SQLite engine registers imports its own way', async () => {
    const seen: RunInput[] = [];
    const sqliteTables: RunInput['tables'] = { 'nums.rows': tables.ref_nums };
    const target = stub({ 'select a from nums.rows where x = $x': { rows: [{ a: 7 }], columns: [{ name: 'a', type: 'number' }] } }, seen);
    const original = stub({ 'select a from ref_nums where x = $x': { rows: [{ a: 7 }], columns: [{ name: 'a', type: 'number' }] } });
    const verdicts = await diffStatements(
      { cases: [{ name: 'q', original: 'select a from ref_nums where x = $x', translated: 'select a from nums.rows where x = $x' }], params: { x: 1 } },
      { original: side(original), translated: { service: target, tables: sqliteTables, params: { _now: '2026-09-26T00:00:00.000Z' } } },
    );
    expect(verdicts).toEqual([{ name: 'q', status: 'same' }]);
    expect(seen[0].tables).toBe(sqliteTables);
    expect(seen[0].params).toEqual({ _now: '2026-09-26T00:00:00.000Z', x: 1 });
  });

  it('compares rows as a multiset by position, and column names on their own', async () => {
    const cols = (...names: string[]) => names.map((name) => ({ name, type: 'string' as const }));
    const original = stub({
      a: { rows: [{ x: 1, y: 'p' }, { x: 1, y: 'p' }, { x: 2, y: 'q' }], columns: cols('x', 'y') },
      b: { rows: [{ n: 1 }], columns: cols('count_star()') },
      c: { rows: [{ x: 1 }, { x: 1 }], columns: cols('x') },
    });
    const translated = stub({
      a: { rows: [{ x: 2, y: 'q' }, { x: 1, y: 'p' }, { x: 1, y: 'p' }], columns: cols('x', 'y') },
      b: { rows: [{ n: 1 }], columns: cols('count(*)') },
      c: { rows: [{ x: 1 }], columns: cols('x') },
    });
    const verdicts = await diffStatements(
      { cases: [{ name: 'order', original: 'a', translated: 'a' }, { name: 'names', original: 'b', translated: 'b' }, { name: 'dupes', original: 'c', translated: 'c' }] },
      { original: side(original), translated: side(translated) },
    );
    expect(verdicts).toEqual([
      { name: 'order', status: 'same' },
      { name: 'names', status: 'different', columns: { original: ['count_star()'], translated: ['count(*)'] } },
      { name: 'dupes', status: 'different', rows: { missing: [[1]], extra: [] } },
    ]);
  });

  it('normalises booleans, lists, dates and float noise', () => {
    expect(comparable(true)).toEqual(comparable(1));
    expect(comparable(['a', 'b'])).toEqual(comparable('["a","b"]'));
    expect(comparable('2026-09-01 00:00:00')).toEqual(comparable('2026-09-01'));
    expect(comparable('2026-09-01T10:30:00.000Z')).toEqual(comparable('2026-09-01 10:30:00'));
    expect(comparable(0.1 + 0.2)).toEqual(comparable(0.3));
    expect(comparable(0.3)).not.toEqual(comparable(0.31));
    expect(comparable('[not json')).toBe('[not json');
    expect(comparable('2026-02-30')).toBe('2026-02-30');
  });
});

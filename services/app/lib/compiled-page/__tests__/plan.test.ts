// DESTINATION: services/app/lib/compiled-page/__tests__/plan.test.ts
/**
 * THE DATA PLAN (docs/phase2-architecture.md §4.2; contract DataPlan): every query classified shared /
 * viewer / page from its compiled reads and the anonymous door's admission facts, transitively through
 * the queries it reads. Pure. The expectations are the step-0 probe's observations on real compiled
 * dataflows (spec §5.5 PROBE-2), rebuilt here from hand-made CompiledDataflow records.
 */
import { describe, expect, it } from 'vitest';
import { planOf } from '../plan';
import type { CompiledDataflow, CompiledQuery, CompiledReads } from '@/lib/story/compiled-dataflow';

const reads = (over: Partial<CompiledReads> = {}): CompiledReads => ({ imports: [], queries: [], values: [], builtins: [], ...over });
const query = (name: string, r: Partial<CompiledReads>, over: Partial<CompiledQuery> = {}): CompiledQuery => ({ name, engine: 'sqlite', sql: 'select 1', params: [], reads: reads(r), columns: [], start: 0, end: 0, ...over });
const flow = (queries: CompiledQuery[], over: Partial<CompiledDataflow> = {}): CompiledDataflow => ({
  imports: [{ name: 'sales', ref: 'SALES1', tables: [] }, { name: 's', ref: 'SECRET', tables: [] }],
  values: [{ name: 'region', kind: 'scalar', type: 'string', default: null }, { name: 'note', kind: 'scalar', type: 'string', default: '' }],
  queries, mutations: [], ...over,
});
const facts = { datasets: { SALES1: { anonymousRead: true }, SECRET: { anonymousRead: false }, PG1: { anonymousRead: true } } };

describe('planOf', () => {
  it('classifies the dashboard shared, the viewer\'s queries viewer (transitively), a private import viewer, and $_tz page', () => {
    const plan = planOf(flow([
      query('regions', { imports: ['sales'] }),
      query('monthly', { imports: ['sales'], values: ['region'] }),
      query('me', { builtins: ['_me.id'] }),
      query('downstream_me', { queries: ['me'] }),
      query('from_secret', { imports: ['s'] }),
      query('zoned', { builtins: ['_tz'] }),
      query('zoned_and_me', { queries: ['zoned'], builtins: ['_me.id'] }),
    ]), facts);
    const scopes = Object.fromEntries(plan.queries.map((q) => [q.name, q.scope]));
    expect(scopes).toEqual({ regions: 'shared', monthly: 'shared', me: 'viewer', downstream_me: 'viewer', from_secret: 'viewer', zoned: 'page', zoned_and_me: 'page' });
    expect(plan.queries.find((q) => q.name === 'from_secret')!.because).toContain('SECRET');
    expect(plan.queries.find((q) => q.name === 'downstream_me')!.because).toContain('me');
  });

  it('lists exactly the datasets the SHARED queries read, in a stable order', () => {
    const plan = planOf(flow([query('regions', { imports: ['sales'] }), query('from_secret', { imports: ['s'] }), query('pg', {}, { engine: 'postgres', source: 'PG1' })]), facts);
    expect(plan.datasets).toEqual(['PG1', 'SALES1']);
    expect(plan.postgres).toBe(true);
    expect(planOf(flow([query('regions', { imports: ['sales'] })]), facts).postgres).toBe(false);
  });

  it('a Postgres source the anonymous reader is not admitted to is viewer scope, like a private import', () => {
    const plan = planOf(flow([query('pg', {}, { engine: 'postgres', source: 'PGX' })]), { datasets: { PGX: { anonymousRead: false } } });
    expect(plan.queries[0]!.scope).toBe('viewer');
    expect(plan.datasets).toEqual([]);
  });

  it('a query that names people is viewer scope; _members and _now stay shared and are recorded', () => {
    const plan = planOf(flow([
      query('people', { imports: ['sales'] }, { columns: [{ name: 'owner', type: 'user' }] }),
      query('members', { builtins: ['_members'] }),
      query('clock', { builtins: ['_now'] }),
    ]), facts);
    const scopes = Object.fromEntries(plan.queries.map((q) => [q.name, q.scope]));
    expect(scopes).toEqual({ people: 'viewer', members: 'shared', clock: 'shared' });
    expect(plan.readsMembers).toBe(true);
  });

  it('marks the values shared queries read as snapshot keys, and the rest not', () => {
    const plan = planOf(flow([query('monthly', { imports: ['sales'], values: ['region'] }), query('mine', { values: ['note'], builtins: ['_me.id'] })]), facts);
    expect(plan.values).toEqual([{ name: 'region', default: null, keysSnapshot: true }, { name: 'note', default: '', keysSnapshot: false }]);
  });

  it('records each mutation\'s target dataset and placement', () => {
    const plan = planOf(flow([], { mutations: [
      { name: 'add', sql: 'insert', target: { import: 'sales', table: 'rows' }, args: [], reads: reads({ imports: ['sales'] }), start: 0, end: 0 },
      { name: 'local', sql: 'insert', target: { local: 'picks' }, args: [], reads: reads(), start: 0, end: 0 },
    ] }), facts);
    expect(plan.mutations).toEqual([{ name: 'add', dataset: 'SALES1', placement: expect.stringMatching(/^(optimistic|server)$/) }, { name: 'local', dataset: null, placement: 'optimistic' }]);
  });

  it('never shares on missing evidence: an unknown dataset, an unresolved import, a sourceless Postgres query, an undeclared upstream', () => {
    const plan = planOf(flow([
      query('unknown_ds', { imports: ['other'] }),
      query('no_fact', { imports: ['x'] }),
      query('pg_nosource', {}, { engine: 'postgres' }),
      query('orphan', { queries: ['missing'] }),
    ], { imports: [{ name: 'x', ref: 'NOFACT', tables: [] }] }), facts);
    expect(Object.fromEntries(plan.queries.map((q) => [q.name, q.scope]))).toEqual({ unknown_ds: 'viewer', no_fact: 'viewer', pg_nosource: 'viewer', orphan: 'viewer' });
    expect(plan.queries.find((q) => q.name === 'no_fact')!.because).toContain('NOFACT');
    expect(plan.datasets).toEqual([]);
  });

  it('the _me table, a row or edited-value built-in and a people value are viewer scope', () => {
    const plan = planOf(flow([
      query('me_table', { builtins: ['_me'] }),
      query('role', { builtins: ['_me.role'] }),
      query('row', { builtins: ['_row.id'] }),
      query('picked', { imports: ['sales'], values: ['who'] }),
      query('picker', { imports: ['sales'], values: ['pick'] }),
    ], { values: [{ name: 'who', kind: 'scalar', type: 'user', default: null }, { name: 'pick', kind: 'scalar', type: 'string', default: null, source: 'SALES1', column: 'owner' }] }), facts);
    expect(plan.queries.every((q) => q.scope === 'viewer')).toBe(true);
    expect(plan.values.every((v) => !v.keysSnapshot)).toBe(true);
  });

  it('a viewer or Postgres query sets no shared flag: only shared queries count toward postgres, _members and datasets', () => {
    const plan = planOf(flow([query('pg', {}, { engine: 'postgres', source: 'PGX' }), query('members_me', { builtins: ['_members', '_me.id'] })]), { datasets: { PGX: { anonymousRead: false } } });
    expect(plan).toMatchObject({ postgres: false, readsMembers: false, datasets: [] });
  });

  it('a query downstream of a page query is page even when it also reads a private dataset', () => {
    const plan = planOf(flow([query('zoned', { builtins: ['_tz'] }), query('both', { queries: ['zoned'], imports: ['s'] })]), facts);
    expect(plan.queries.map((q) => q.scope)).toEqual(['page', 'page']);
  });

  it('is pure and deterministic', () => {
    const f = flow([query('regions', { imports: ['sales'] })]);
    expect(JSON.stringify(planOf(f, facts))).toBe(JSON.stringify(planOf(f, facts)));
  });
});

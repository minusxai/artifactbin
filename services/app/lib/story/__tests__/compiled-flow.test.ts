/**
 * READING A COMPILED DATAFLOW (lib/story/compiled-flow): which queries a run
 * needs, what a statement binds and by which SQL name, what a mutation reads
 * besides its target, and the one owner of result typing.
 */
import { describe, expect, it } from 'vitest';
import { bindParams, bindTypes, dataRefs, mutationParams, mutationReads, queriesReadingValues, selectQueries, typedResult } from '../compiled-flow';
import { compiledOf } from '@/test/helpers/compiled';

const flow = await compiledOf(''
  + '<Import name="first_data" src="ref:ABC123" /><Import name="other_data" src="ref:DEF456" />'
  + '<Value name="n" type="number" /><Value name="draft" type="table" value={[{"id": 1}]} />'
  + '<Query name="top">{`select * from first`}</Query>'
  + '<Query name="first">{`select id from first_data.rows where id > $n`}</Query>'
  + '<Query name="other">{`select id from other_data.rows`}</Query>'
  + '<Mutation name="copy">{`insert into first_data.rows select id from draft where id not in (select id from other_data.rows) and $_me.id is not null and $_row.id is not null`}</Mutation>', {
  ABC123: [{ name: 'id', type: 'number' }],
  DEF456: [{ name: 'id', type: 'number' }, { name: 'more', type: 'string' }],
});

describe('selectQueries', () => {
  it('selects upstream queries in dependency order, or none for an empty selection', () => {
    expect(selectQueries(flow, { only: ['top'] }).map((q) => q.name)).toEqual(['first', 'top']);
    expect(selectQueries(flow, { only: [] })).toEqual([]);
    expect(selectQueries(flow, { only: ['unknown'] })).toEqual([]);
    expect(selectQueries(flow).map((q) => q.name)).toEqual(['first', 'top', 'other']);
  });
  it('a page selection overrides only', () => {
    expect(selectQueries(flow, { only: ['other'], page: { name: 'top' } }).map((q) => q.name)).toEqual(['first', 'top']);
  });
});

it('queriesReadingValues follows a value through every downstream query', () => {
  expect(queriesReadingValues(flow, ['n'])).toEqual(['first', 'top']);
  expect(queriesReadingValues(flow, ['nothing'])).toEqual([]);
});

it('binds by SQL name, typed by the declaration or the registry', () => {
  const m = flow.mutations[0]!;
  expect(mutationParams(m)).toEqual(['_me.id', '_row.id']);
  expect(bindParams(['n', '_me.id', '_row.id'], { n: 3, '_me.id': 'u1' })).toEqual({ n: 3, _me__id: 'u1', _row__id: null });
  expect(bindTypes(['n', '_me.id', '_row.id', '_now'], { n: 'number' })).toEqual({ n: 'number', _me__id: 'user', _now: 'timestamp' });
});

it('mutationReads loads what the statement reads besides its target, from the run\'s own data', () => {
  const reads = mutationReads(flow, flow.mutations[0]!, { imports: { other_data: { rows: { rows: [{ id: 9, more: 'x' }], columns: [] } } }, tables: { draft: { rows: [{ id: 2 }], columns: [] } }, userId: 'u1' });
  expect(reads.map((r) => `${r.schema}.${r.table}`)).toEqual(['other_data.rows', 'main.draft']);
  expect(reads[0]!.rows).toEqual([{ id: 9, more: 'x' }]);
  expect(reads[1]!.rows).toEqual([{ id: 2 }]);
});

it('dataRefs names every artifact the data depends on', () => {
  expect(dataRefs(flow, ['PICK01'])).toEqual(['ABC123', 'DEF456', 'PICK01']);
});

describe('typedResult — the one owner of result typing', () => {
  it('turns 1/0 into true/false for a column the compiler typed boolean, and keeps its declared type', () => {
    const out = typedResult([{ name: 'done', type: 'boolean' }, { name: 'n', type: null }], { rows: [{ done: 1, n: 2 }, { done: 0, n: 3 }, { done: null, n: 4 }], columns: [{ name: 'done', type: 'number' }, { name: 'n', type: 'number' }] });
    expect(out.rows).toEqual([{ done: true, n: 2 }, { done: false, n: 3 }, { done: null, n: 4 }]);
    expect(out.columns).toEqual([{ name: 'done', type: 'boolean' }, { name: 'n', type: 'number' }]);
  });
  it('keeps a compiled type when this run\'s values could not show it', () => {
    expect(typedResult([{ name: 'who', type: 'user' }], { rows: [], columns: [{ name: 'who', type: 'string' }] }).columns).toEqual([{ name: 'who', type: 'user' }]);
  });
});

import { expect, it } from 'vitest';
import { selectedQueries, type Dataflow } from '../dataflow';
const query = (name: string, sql: string, source?: string): Dataflow['queries'][number] => ({ name, sql, params: [], refs: [], start: 0, end: 1, ...(source ? { source } : {}) });
const flow: Dataflow = { values: [], queries: [query('top', 'select * from first'), query('first', 'select * from ref_ABC123'), query('other', 'select * from ref_DEF456')] };
it('selects upstream queries in authored dependency order, or none for empty selection', () => {
  expect(selectedQueries(flow, { only: ['top'] })?.map(q => q.name)).toEqual(['first', 'top']);
  expect(selectedQueries(flow, { only: [] })).toEqual([]);
  expect(selectedQueries(flow, { only: ['unknown'] })).toEqual([]);
  expect(selectedQueries(flow)?.map(q => q.name)).toEqual(['first', 'top', 'other']);
});
it('page selection overrides only and source queries do not import local dependencies', () => {
  expect(selectedQueries(flow, { only: ['other'], page: { name: 'top' } })?.map(q => q.name)).toEqual(['first', 'top']);
  const sourceFlow = { ...flow, queries: [...flow.queries, query('remote', 'select * from top', 'ABC123')] };
  expect(selectedQueries(sourceFlow, { only: ['remote'] })?.map(q => q.name)).toEqual(['remote']);
});
it('preserves a global cycle refusal even when the requested query is not in the cycle', () => {
  const cyclic = { ...flow, queries: [...flow.queries, query('loop', 'select * from loop')] };
  expect(selectedQueries(cyclic, { only: ['other'] })).toBeNull();
});

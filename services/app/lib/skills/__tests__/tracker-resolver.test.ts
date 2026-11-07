/**
 * The tracker's limits resolver (skills/artifactbin/examples/tracker.ts): counts the group with read-only SQL
 * (caps.sql, never GraphQL aggregation), refuses a full group before any write, checks the entry before counting,
 * and inserts through caps.query as the caller, so the dataset rules still stamp and decide.
 */
import {expect, it} from 'vitest';
import tracker, {typeDefs} from '../../../skills/artifactbin/examples/tracker';
import {declaresResolverTest} from '@/lib/page-operations';

type Call = {kind: 'sql' | 'query'; text: string; values?: Record<string, unknown>};
const caps = (inGroup: number) => {
  const calls: Call[] = [];
  return {calls, caps: {
    sql: async (text: string, values?: Record<string, unknown>) => { calls.push({kind: 'sql', text, values}); return {rows: [{n: inGroup}]}; },
    query: async (text: string, values?: Record<string, unknown>) => {
      calls.push({kind: 'query', text, values});
      if (/insert_entries_one/.test(text)) return {insert_entries_one: {_id: 'row-9'}};
      throw Error('unexpected query ' + text);
    }}};
};

it('adds an entry while its group has room, counting the group with caps.sql', async () => {
  const probe = caps(4);
  expect(await tracker.add({name: ' Ship it ', grp: ' To do ', note: ' soon '}, {}, probe.caps)).toEqual({_id: 'row-9'});
  expect(probe.calls).toEqual([
    {kind: 'sql', text: 'select count(*) as n from entries where grp = $g', values: {g: 'To do'}},
    {kind: 'query', text: expect.stringContaining('insert_entries_one'), values: {o: {name: 'Ship it', grp: 'To do', note: 'soon'}}}]);
});

it('refuses a full group, naming it and the limit, without writing', async () => {
  const probe = caps(5);
  await expect(tracker.add({name: 'One more', grp: 'To do'}, {}, probe.caps)).rejects.toThrow('To do is full (5 entries)');
  expect(probe.calls.map(c => c.kind)).toEqual(['sql']);
});

it('refuses a bad entry before counting or writing anything', async () => {
  for (const args of [{name: '', grp: 'To do'}, {name: 'x'.repeat(81), grp: 'To do'}, {name: 'Ok', grp: ' '}, {name: 'Ok', grp: 'To do', note: 'n'.repeat(141)}]) {
    const probe = caps(0);
    await expect(tracker.add(args, {}, probe.caps)).rejects.toThrow('Give the entry a name');
    expect(probe.calls).toEqual([]);
  }
});

it('declares a signed-in write in a schema the platform accepts, and no aggregation', () => {
  expect(typeDefs).toContain('@auth(role:signed_in)');
  expect(declaresResolverTest(typeDefs)).toBe(false);
  expect(Object.keys(tracker)).toEqual(['add']);
  expect(String(tracker.add)).not.toMatch(/_aggregate/);
});

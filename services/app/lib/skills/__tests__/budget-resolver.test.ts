/**
 * The shared-app resolver example (skills/artifactbin/examples/budget.ts) keeps shared targets as dataset rows through
 * caps.query: it checks a value before any write, updates the category's row by _id when one exists (there is no
 * upsert), inserts otherwise, and clears by deleting the category's rows.
 */
import {expect, it} from 'vitest';
import budget, {typeDefs} from '../../../skills/artifactbin/examples/budget';
import {declaresResolverTest} from '@/lib/page-operations';

type Call = {query: string; variables?: Record<string, unknown>};
const caps = (rows: Array<{_id: string}>) => {
  const calls: Call[] = [];
  const query = async (query: string, variables?: Record<string, unknown>) => {
    calls.push({query, variables});
    if (/delete_targets/.test(query)) return {delete_targets: {affected_rows: rows.length}};
    if (/update_targets_by_pk/.test(query)) return {update_targets_by_pk: {category: 'Groceries', amount: variables!.a}};
    if (/insert_targets_one/.test(query)) return {insert_targets_one: (variables!.o as object)};
    if (/\btargets\(where/.test(query)) return {targets: rows};
    throw Error('unexpected query ' + query);
  };
  return {calls, caps: {query}};
};

it('updates the existing row by _id, inserts a new one, and rounds to cents', async () => {
  const existing = caps([{_id: 'row-7'}]);
  expect(await budget.setTarget({category: ' Groceries ', amount: 457.456}, {}, existing.caps)).toEqual({category: 'Groceries', amount: 457.46});
  expect(existing.calls.map((c) => c.variables)).toEqual([{c: 'Groceries'}, {id: 'row-7', a: 457.46}]);
  const fresh = caps([]);
  expect(await budget.setTarget({category: 'Groceries', amount: 457}, {}, fresh.caps)).toEqual({category: 'Groceries', amount: 457});
  expect(fresh.calls.at(-1)!.query).toContain('insert_targets_one');
  expect((await budget.clearTarget({category: 'Groceries'}, {}, caps([{_id: 'a'}, {_id: 'b'}]).caps))).toBe(2);
});

it('refuses a bad value before writing anything', async () => {
  for (const args of [{category: '', amount: 5}, {category: 'Rent', amount: -1}, {category: 'Rent', amount: Number.NaN}, {category: 'x'.repeat(61), amount: 5}]) {
    const probe = caps([]);
    await expect(budget.setTarget(args, {}, probe.caps)).rejects.toThrow('Use a category name');
    expect(probe.calls).toEqual([]);
  }
});

it('declares signed-in writes in a schema the platform accepts', () => {
  expect(typeDefs).toContain('@auth(role:signed_in)');
  expect(declaresResolverTest(typeDefs)).toBe(false);
});

it('leaves sign-in state to the built-in viewer query rather than a resolver field', () => {
  expect(typeDefs).not.toMatch(/signedIn|type Query/);
  expect(Object.keys(budget).sort()).toEqual(['clearTarget', 'setTarget']);
});

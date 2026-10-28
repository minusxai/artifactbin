/**
 * The shared-app backend example (skills/artifactbin/examples/garden.ts) answers a stale-version save with conflict:true,
 * because the platform reports a thrown resolver error only as "Backend execution failed".
 */
import {expect, it} from 'vitest';
import garden from '../../../skills/artifactbin/examples/garden';

const caps = (set: () => Promise<number>) => ({store: {get: async () => ({value: {targets: []}, version: 3}), set}});

it('returns conflict:true for a stale version, saves otherwise, and rethrows other failures', async () => {
  const stale = caps(() => Promise.reject(Object.assign(Error('conflict'), {code: 'conflict'})));
  expect(await garden.setTarget({category: 'Groceries', amount: 457}, {}, stale)).toEqual({conflict: true});
  expect(await garden.clearTarget({category: 'Groceries'}, {}, stale)).toEqual({conflict: true});
  expect(await garden.setTarget({category: 'Groceries', amount: 457}, {}, caps(async () => 4))).toEqual({conflict: false});
  await expect(garden.setTarget({category: 'Groceries', amount: 457}, {}, caps(() => Promise.reject(Error('store down')))))
    .rejects.toThrow('store down');
});

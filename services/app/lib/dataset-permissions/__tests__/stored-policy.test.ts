/**
 * THE STORED POLICY READER: version 3 or nothing stored. A retired version 1 or 2 policy, or anything else, throws
 * naming what it found; no rule is ever guessed from it.
 */
import { describe, expect, it } from 'vitest';
import { storedPolicy } from '../stored-policy';

const ROWS = { schema: 'public', name: 'rows' };
const READ_ALL = { columns: '*', filter: {}, allow_aggregations: true };

describe('storedPolicy', () => {
  it('reads no stored policy as the default: every rule role reads every table, nobody below editor writes', () => {
    expect(storedPolicy({ policy: null, tables: [] })).toEqual({
      source: 'none',
      policy: { version: 3, tables: [{ table: ROWS, select_permissions: ['viewer', 'signed_in', 'anonymous'].map((role) => ({ role, permission: READ_ALL })) }] },
    });
    const orders = { schema: 'shop', name: 'orders' };
    expect(storedPolicy({ policy: undefined, tables: [ROWS, orders] }).policy.tables.map((t) => t.table)).toEqual([ROWS, orders]);
  });

  it('reads a stored version 3 policy as it is', () => {
    const policy = { version: 3, tables: [{ table: ROWS, select_permissions: [{ role: 'viewer', permission: { columns: ['a'], filter: { a: { _eq: 1 } } } }] }] };
    expect(storedPolicy({ policy, tables: [ROWS] })).toEqual({ source: 'v3', policy });
  });

  it('throws for a retired version 1 or 2 policy, an unversioned one and an invalid version 3 one, naming each', () => {
    const v1 = { version: 1, enforcement: 'enabled', tables: [{ table: ROWS, insert_permissions: [{ role: 'viewer', permission: { columns: '*', check: {} } }] }] };
    const v2 = { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }] };
    expect(() => storedPolicy({ policy: v1, tables: [ROWS] })).toThrow(/^The stored dataset policy is version 1: only version 3 is read\./);
    expect(() => storedPolicy({ policy: v2, tables: [ROWS] })).toThrow(/^The stored dataset policy is version 2: only version 3 is read\./);
    for (const policy of [{ tables: [] }, [], 'v3', 3])
      expect(() => storedPolicy({ policy, tables: [ROWS] })).toThrow(/^The stored dataset policy is not a versioned policy: only version 3 is read\./);
    expect(() => storedPolicy({ policy: { version: 3, tables: [{ table: ROWS, select_permissions: [{ role: 'owner', permission: READ_ALL }] }] }, tables: [ROWS] }))
      .toThrow(/^The stored dataset policy is not a valid version 3 policy \(tables\[0\]\.select_permissions\[0\]\.role: /);
  });
});

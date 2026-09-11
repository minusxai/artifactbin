import { describe, it, expect } from 'vitest';
import { parseDatasetPolicy, compilePolicyPredicate } from '../dataset-policy';

const policy = (permission: unknown, operation = 'insert') => ({
  version: 1,
  enforcement: 'enabled',
  tables: [
    {
      table: { schema: 'public', name: 'article' },
      [`${operation}_permissions`]: [{ role: 'visitor', permission }],
    },
  ],
});
describe('Hasura v2 write permission compatibility', () => {
  it('accepts unchanged insert columns/check/set permission entries', () => {
    const input = policy({
      columns: ['title', 'author_id'],
      check: { author_id: { _eq: 'X-Hasura-User-Id' } },
      set: { author_id: 'x-hasura-user-id' },
    });
    expect(parseDatasetPolicy(input)).toEqual(input);
  });
  it('preserves Hasura optional insert columns and exported backend_only false', () => {
    const input = policy({ check: {}, backend_only: false });
    expect(parseDatasetPolicy(input)).toEqual(input);
  });
  it('accepts update filter, optional/null post-check and wildcard columns', () => {
    for (const check of [undefined, null, {}, { rating: { _gte: 0 } }])
      expect(
        parseDatasetPolicy(
          policy(
            {
              columns: '*',
              filter: { author_id: { _eq: 'X-Hasura-User-Id' } },
              ...(check === undefined ? {} : { check }),
            },
            'update',
          ),
        ),
      ).toBeDefined();
  });
  it('accepts delete filter without inventing columns/check fields', () => {
    expect(
      parseDatasetPolicy(
        policy({ filter: { published: { _eq: false } } }, 'delete'),
      ),
    ).toBeDefined();
    expect(() =>
      parseDatasetPolicy(policy({ filter: {}, columns: '*' }, 'delete')),
    ).toThrow();
  });
  it('rejects unsupported metadata instead of ignoring it', () => {
    for (const permission of [
      { columns: '*', check: {}, backend_only: true },
      { columns: '*', check: {}, validate_input: {} },
      { columns: '*', check: { author: { id: { _eq: 1 } } } },
      { columns: '*', check: { id: { _regex: '.*' } } },
    ])
      expect(() => parseDatasetPolicy(policy(permission))).toThrow();
    expect(() =>
      parseDatasetPolicy(policy({ columns: '*', filter: {} }, 'select')),
    ).toThrow();
    expect(() =>
      parseDatasetPolicy({
        ...policy({ columns: '*', check: {} }),
        version: 2,
      }),
    ).toThrow();
  });
  it('rejects duplicate roles and malformed delegation', () => {
    const p = policy({ columns: '*', check: {} });
    const entries = p.tables[0].insert_permissions as Array<{
      role: string;
      permission: unknown;
    }>;
    entries.push(entries[0]);
    expect(() => parseDatasetPolicy(p)).toThrow();
    expect(() =>
      parseDatasetPolicy({
        ...policy({ columns: '*', check: {} }),
        delegated_mutations: {
          audience: 'anyone',
          operations: ['select'],
          via: 'declared_mutation',
        },
      }),
    ).toThrow();
  });
  it('compiles the standard operators and session variables as bound values', () => {
    const out = compilePolicyPredicate(
      {
        _and: [
          { id: { _eq: 'X-Hasura-User-Id' } },
          { score: { _gte: 2, _lt: 9 } },
          { status: { _in: ['open', 'pending'] } },
          { deleted: { _is_null: true } },
        ],
        _not: { score: { _neq: 3 } },
      },
      ['id', 'score', 'status', 'deleted'],
      { 'x-hasura-user-id': 'u1' },
    );
    expect(out.sql).toContain('IS NULL');
    expect(Object.values(out.params)).toContain('u1');
    expect(out.sql).not.toContain('u1');
  });
  it('empty predicates are true; unknown columns and missing session variables fail closed', () => {
    expect(compilePolicyPredicate({}, [], {}).sql).toBe('TRUE');
    expect(() =>
      compilePolicyPredicate({ secret: { _eq: 1 } }, ['id'], {}),
    ).toThrow();
    expect(() =>
      compilePolicyPredicate({ id: { _eq: 'X-Hasura-User-Id' } }, ['id'], {}),
    ).toThrow();
  });
  it('bounds depth and rejects null comparison operands; use _is_null', () => {
    let filter: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) filter = { _not: filter };
    expect(() =>
      parseDatasetPolicy(policy({ columns: '*', check: filter })),
    ).toThrow();
    expect(() =>
      parseDatasetPolicy(
        policy({ columns: '*', check: { id: { _eq: null } } }),
      ),
    ).toThrow();
  });
});

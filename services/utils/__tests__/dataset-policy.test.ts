import { describe, it, expect } from 'vitest';
import { parseDatasetPolicy, compilePolicyPredicate, datasetPatternMatch } from '@artifactbin/utils/dataset-policy';

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
  it('compiles the pattern operators to the engine library matcher, and _id to the row ID column it is handed', () => {
    const out = compilePolicyPredicate(
      { _and: [{ body: { _like: 'a%' } }, { body: { _nilike: 'X-Hasura-User-Id' } }, { _id: { _eq: 'r_1' } }] },
      ['body', 'rid'],
      { 'x-hasura-user-id': 'u1' },
      'p',
      { rowId: 'rid' },
    );
    expect(out.sql).toContain('like_matches("body", $p_0)');
    expect(out.sql).toContain('(NOT ilike_matches("body", $p_1))');
    expect(out.sql).toContain('"rid" = $p_2');
    expect(out.params).toEqual({ p_0: 'a%', p_1: 'u1', p_2: 'r_1' });
    expect(() => compilePolicyPredicate({ _id: { _eq: 'r_1' } }, ['body'], {})).toThrow(/row ID/);
    expect(() => compilePolicyPredicate({ _rid: { _eq: 'r_1' } }, ['_rid'], {}, 'p', { rowId: 'rid' })).toThrow(/unsupported predicate/);
    expect(() => compilePolicyPredicate({ body: { _like: 3 } } as never, ['body'], {})).toThrow(/text pattern/);
    expect(datasetPatternMatch('École', 'éCOLE', true)).toBe(true);
    expect(datasetPatternMatch('École', 'éCOLE', false)).toBe(false);
    expect(datasetPatternMatch(null, '%', false)).toBeNull();
    expect(datasetPatternMatch(3, '%', false)).toBeNull();
    expect(datasetPatternMatch('50% off', '50\\%%', false)).toBe(true);
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

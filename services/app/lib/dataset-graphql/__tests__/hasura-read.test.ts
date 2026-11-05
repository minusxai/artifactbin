/**
 * THE READ COMPILER: GraphQL arguments to one engine statement over the role view's table. Values are always
 * bound parameters, columns are always the role's visible source columns (looked up by GraphQL name, again,
 * after schema validation), `_id asc` is always the last ordering, and the limits hold.
 */
import { describe, expect, it } from 'vitest';
import type { HasuraTableModel } from '../hasura-schema';
import { compileAggregate, compileRows, compileWhere, HasuraReadError } from '../hasura-read';
import { withCan } from '../can';

const T: HasuraTableModel = {
  root: 'orders', table: { schema: 'public', name: 'rows' }, aggregations: true,
  columns: [
    { field: 'region', source: 'Region', type: 'String' },
    { field: 'amount', source: 'amount', type: 'Float' },
    { field: 'paid', source: 'paid', type: 'Boolean' },
  ],
};
const where = (exp: unknown) => { const params: Record<string, unknown> = {}; return { sql: compileWhere(T, exp, params), params }; };

describe('where', () => {
  it('compiles every comparison operator with bound values and source column names', () => {
    expect(where({ region: { _eq: 'west', _neq: 'x' }, amount: { _gt: 1, _gte: 2, _lt: 3, _lte: 4 } })).toEqual({
      sql: '(("Region" = $w0 AND "Region" <> $w1) AND ("amount" > $w2 AND "amount" >= $w3 AND "amount" < $w4 AND "amount" <= $w5))',
      params: { w0: 'west', w1: 'x', w2: 1, w3: 2, w4: 3, w5: 4 },
    });
    expect(where({ region: { _in: ['a', 'b'], _nin: ['c'] } }).sql).toBe('(("Region" IN ($w0, $w1) AND "Region" NOT IN ($w2)))');
    expect(where({ region: { _in: [] } }).sql).toBe('(((1=0)))');
    expect(where({ region: { _nin: [] } }).sql).toBe('(((1=1)))');
    expect(where({ region: { _is_null: true }, amount: { _is_null: false } }).sql).toBe('(("Region" IS NULL) AND ("amount" IS NOT NULL))');
    expect(where({ _id: { _eq: 'r_1' } }).sql).toBe('(("__af_graphql_row_id" = $w0))');
  });

  it('the pattern operators call the engine library matcher, the pattern bound as written', () => {
    expect(where({ region: { _like: '%we_t*[x]\\%' } })).toEqual({ sql: '((like_matches("Region", $w0)))', params: { w0: '%we_t*[x]\\%' } });
    expect(where({ region: { _nlike: 'a%' } }).sql).toBe('(((NOT like_matches("Region", $w0))))');
    expect(where({ region: { _ilike: 'A%' } })).toEqual({ sql: '((ilike_matches("Region", $w0)))', params: { w0: 'A%' } });
    expect(where({ region: { _nilike: 'A%' } }).sql).toBe('(((NOT ilike_matches("Region", $w0))))');
  });

  it('_and, _or, _not; empty _and is true, empty _or is false, {} is true', () => {
    expect(where({}).sql).toBe('(1=1)');
    expect(where({ _and: [] }).sql).toBe('((1=1))');
    expect(where({ _or: [] }).sql).toBe('((1=0))');
    expect(where({ _not: { paid: { _eq: true } } }).sql).toBe('((NOT (("paid" = $w0))))');
    expect(where({ _or: [{ region: { _eq: 'a' } }, { _and: [{ amount: { _gt: 1 } }, { amount: { _lt: 9 } }] }] }).sql)
      .toBe('(((("Region" = $w0)) OR (((("amount" > $w1)) AND (("amount" < $w2))))))');
  });

  it('refuses null operands, unknown or hidden columns and unknown operators (defence in depth)', () => {
    expect(() => where({ region: { _eq: null } })).toThrow(/_is_null/);
    expect(() => where({ Region: { _eq: 'a' } })).toThrow(HasuraReadError);
    expect(() => where({ salary: { _eq: 1 } })).toThrow(HasuraReadError);
    expect(() => where({ region: { _regex: 'a' } })).toThrow(HasuraReadError);
    expect(() => where({ amount: { _like: 'a' } })).toThrow(HasuraReadError);
    expect(() => where({ _id: { _gt: 'a' } })).toThrow(HasuraReadError);
  });

  it('holds the permission grammar\'s limits: depth 12 (counted as the validator counts), 64 predicates, 100 values per _in', () => {
    let deep: Record<string, unknown> = { region: { _eq: 'a' } };
    for (let i = 0; i < 12; i++) deep = { _not: deep };
    expect(() => where(deep)).not.toThrow();
    deep = { _not: deep };
    expect(() => where(deep)).toThrow(/deeper/);
    expect(() => where({ _and: Array.from({ length: 65 }, () => ({ region: { _eq: 'a' } })) })).toThrow(/predicates/);
    expect(() => where({ region: { _in: Array.from({ length: 101 }, (_, i) => String(i)) } })).toThrow(/100/);
    expect(() => where({ region: { _in: Array.from({ length: 100 }, (_, i) => String(i)) } })).not.toThrow();
  });
});

describe('rows', () => {
  it('selects the visible columns under their GraphQL names, orders with explicit nulls and the _id tie-break', () => {
    const plan = compileRows(T, { where: { paid: { _eq: true } }, order_by: [{ amount: 'desc', region: 'asc_nulls_first' }, { _id: 'desc' }], limit: 10, offset: 5 });
    expect(plan.statement).toEqual({
      sql: 'SELECT "__af_graphql_row_id" AS "_id", "Region" AS "region", "amount" AS "amount", "paid" AS "paid" FROM "public"."rows" WHERE (("paid" = $w0)) ORDER BY "amount" DESC NULLS FIRST, "Region" ASC NULLS FIRST, "__af_graphql_row_id" DESC NULLS FIRST, "__af_graphql_row_id" ASC',
      params: { w0: true },
    });
    expect(plan.window).toEqual({ limit: 10, offset: 5 });
    expect(compileRows(T, { order_by: { amount: 'asc' } }).statement.sql).toContain('ORDER BY "amount" ASC NULLS LAST, "__af_graphql_row_id" ASC');
  });

  it('limit defaults to 100, never exceeds 1000 or the select rule\'s limit; offset and limit are non-negative', () => {
    expect(compileRows(T, {}).window).toEqual({ limit: 100, offset: 0 });
    expect(compileRows(T, { limit: 5000 }).window.limit).toBe(1000);
    expect(compileRows({ ...T, limit: 200 }, { limit: 500 }).window.limit).toBe(200);
    expect(compileRows({ ...T, limit: 20 }, {}).window.limit).toBe(20);
    expect(compileRows(T, { limit: 0 }).window.limit).toBe(0);
    expect(() => compileRows(T, { limit: -1 })).toThrow(HasuraReadError);
    expect(() => compileRows(T, { offset: -1 })).toThrow(HasuraReadError);
  });

  it('_by_pk is the rows plan on one _id', () => {
    expect(compileRows(T, { where: { _id: { _eq: 'r_x' } }, limit: 1 }).statement.sql).toContain('WHERE (("__af_graphql_row_id" = $w0))');
  });
});

describe('aggregates', () => {
  it('aggregates over the filtered, ordered, windowed visible rows', () => {
    expect(compileAggregate(T, { where: { region: { _eq: 'w' } }, order_by: { amount: 'desc' }, limit: 3, offset: 1 }, { kind: 'count', columns: ['amount'], distinct: true })).toEqual({
      sql: 'SELECT COUNT(DISTINCT "amount") AS "value" FROM (SELECT * FROM "public"."rows" WHERE (("Region" = $w0)) ORDER BY "amount" DESC NULLS FIRST, "__af_graphql_row_id" ASC LIMIT 3 OFFSET 1) AS af_hasura',
      params: { w0: 'w' },
    });
    expect(compileAggregate(T, {}, { kind: 'count' }).sql).toBe('SELECT COUNT(*) AS "value" FROM (SELECT * FROM "public"."rows") AS af_hasura');
    expect(compileAggregate(T, {}, { kind: 'count', columns: ['region', 'amount'] }).sql).toContain('COUNT(*)');
    expect(compileAggregate(T, {}, { kind: 'count', columns: ['region', 'amount'], distinct: true }).sql).toContain('COUNT(DISTINCT json_array("Region", "amount"))');
    expect(compileAggregate(T, {}, { kind: 'sum' }).sql).toBe('SELECT SUM("amount") AS "amount" FROM (SELECT * FROM "public"."rows") AS af_hasura');
    expect(compileAggregate(T, {}, { kind: 'max' }).sql).toBe('SELECT MAX("Region") AS "region", MAX("amount") AS "amount" FROM (SELECT * FROM "public"."rows") AS af_hasura');
  });

  it('refuses a hidden or unknown count column', () => {
    expect(() => compileAggregate(T, {}, { kind: 'count', columns: ['salary'] })).toThrow(HasuraReadError);
  });
});

/**
 * WHAT THE VIEWER MAY CHANGE, decided in the row read: each asked `_can` field whose rule has a filter adds ONE
 * boolean expression to the same statement, compiled by the write engine's compiler (utils compilePolicyPredicate)
 * over the role view's columns and `_id`, its values bound under their own names. Nothing is added unless asked, a
 * constant answer adds nothing, and a filter that cannot hold over the role view (a hidden column, a session value
 * the caller lacks) answers false without SQL.
 */
describe('_can in the row read', () => {
  const MINE = { filter: { Region: { _eq: 'X-Hasura-User-Id' } }, session: { 'x-hasura-user-id': 'u1' } };
  const OWNED: HasuraTableModel = { ...T, can: { insert: true, update: MINE, delete: { filter: { _id: { _eq: 'r_1' } }, session: {} } } };
  const BOTH = { update: true, delete: true } as const;

  it('adds nothing unless asked: the statement is exactly the one without capabilities', () => {
    const args = { where: { amount: { _gt: 1 } }, order_by: { region: 'asc' }, limit: 5 };
    expect(compileRows(OWNED, args)).toEqual(compileRows(T, args));
    expect(compileRows(OWNED, args, null)).toEqual(compileRows(T, args));
    expect(compileRows(OWNED, args, { update: false, delete: false })).toEqual(compileRows(T, args));
  });

  it('one expression per asked rule field, in the same statement, values bound apart from the where', () => {
    const plan = compileRows(OWNED, { where: { amount: { _gt: 1 } } }, BOTH);
    expect(plan.statement).toEqual({
      sql: 'SELECT "__af_graphql_row_id" AS "_id", "Region" AS "region", "amount" AS "amount", "paid" AS "paid", CASE WHEN (("Region" = $can_update_0)) THEN 1 ELSE 0 END AS "_can_update", CASE WHEN (("__af_graphql_row_id" = $can_delete_0)) THEN 1 ELSE 0 END AS "_can_delete" FROM "public"."rows" WHERE (("amount" > $w0)) ORDER BY "__af_graphql_row_id" ASC',
      params: { can_update_0: 'u1', can_delete_0: 'r_1', w0: 1 },
    });
    expect(compileRows(OWNED, {}, { update: false, delete: true }).statement.sql).not.toContain('_can_update');
  });

  it('a constant answer adds no SQL: owner and editor (true), no usable rule (false)', () => {
    expect(compileRows({ ...T, can: { insert: true, update: true, delete: true } }, {}, BOTH)).toEqual(compileRows(T, {}));
    expect(compileRows({ ...T, can: { insert: false, update: false, delete: false } }, {}, BOTH)).toEqual(compileRows(T, {}));
    expect(compileRows(T, {}, BOTH)).toEqual(compileRows(T, {}));
  });

  it('fails closed without SQL: a filter on a hidden column, or a session value the caller lacks', () => {
    const hidden: HasuraTableModel = { ...T, columns: [T.columns[1]!], can: { insert: false, update: MINE, delete: false } };
    expect(compileRows(hidden, {}, BOTH).statement.sql).not.toContain('CASE');
    const signedOut: HasuraTableModel = { ...T, can: { insert: false, update: { ...MINE, session: { 'x-hasura-role': 'anonymous' } }, delete: false } };
    expect(compileRows(signedOut, {}, BOTH).statement.sql).not.toContain('CASE');
    expect(withCan(hidden, BOTH, [{ _id: 'r_1', amount: 1 }])).toEqual([{ _id: 'r_1', amount: 1, _can: { update: false, delete: false } }]);
  });

  it('answers each row from its expression: 1 is true, 0 and NULL false; the raw columns never leave', () => {
    expect(withCan(OWNED, BOTH, [
      { _id: 'r_1', region: 'u1', _can_update: 1, _can_delete: 1 },
      { _id: 'r_2', region: 'u2', _can_update: 0, _can_delete: null },
    ])).toEqual([
      { _id: 'r_1', region: 'u1', _can: { update: true, delete: true } },
      { _id: 'r_2', region: 'u2', _can: { update: false, delete: false } },
    ]);
    const rows = [{ _id: 'r_1' }];
    expect(withCan(OWNED, null, rows)).toBe(rows);
  });
});

/**
 * THE ROLE VIEW over one stored table: the filter in three-valued logic (visible only when TRUE), the column
 * list, the limit, stored order, and every way a rule fails closed. Also the materialisation cost at the
 * dataset row cap.
 */
import { describe, expect, it } from 'vitest';
import type { DatasetSelectPermission } from '@artifactbin/contracts';
import { keptRows, unrestricted, viewRows } from '../view';

const COLUMNS = ['name', 'team', 'salary', 'owner', 'note'];
const ROWS = [
  { name: 'ada', team: 'red', salary: 10, owner: 'usr_a', note: 'Alpha' },
  { name: 'bo', team: 'blue', salary: 20, owner: 'usr_b', note: 'alpha%' },
  { name: 'cy', team: null, salary: 30, owner: 'usr_a', note: null },
  { name: 'di', team: 'red', salary: '40', owner: 'usr_c', note: 'beta' },
];
const SESSION = { 'x-hasura-role': 'signed_in', 'x-hasura-user-id': 'usr_a' };
const rule = (filter: object, extra: Partial<DatasetSelectPermission> = {}): DatasetSelectPermission => ({ columns: '*', filter: filter as DatasetSelectPermission['filter'], ...extra });
const names = (filter: object, session: Record<string, string> = SESSION) => keptRows(ROWS, COLUMNS, rule(filter), session).map((i) => ROWS[i]!.name);

describe('the filter', () => {
  it.each<[string, object, string[]]>([
    ['{} keeps every row', {}, ['ada', 'bo', 'cy', 'di']],
    ['_eq', { team: { _eq: 'red' } }, ['ada', 'di']],
    ['_neq leaves NULL out (unknown, not true)', { team: { _neq: 'red' } }, ['bo']],
    ['_gt on numbers, and a numeric string against a number', { salary: { _gt: 15 } }, ['bo', 'cy', 'di']],
    ['_lte', { salary: { _lte: 20 } }, ['ada', 'bo']],
    ['_in', { team: { _in: ['red', 'green'] } }, ['ada', 'di']],
    ['empty _in is false', { team: { _in: [] } }, []],
    ['_nin leaves NULL out', { team: { _nin: ['red'] } }, ['bo']],
    ['empty _nin is true', { team: { _nin: [] } }, ['ada', 'bo', 'cy', 'di']],
    ['_is_null true', { team: { _is_null: true } }, ['cy']],
    ['_is_null false', { team: { _is_null: false } }, ['ada', 'bo', 'di']],
    ['_like is case-sensitive', { note: { _like: 'alpha%' } }, ['bo']],
    ['_ilike is not', { note: { _ilike: 'alpha%' } }, ['ada', 'bo']],
    ['_like escapes a literal %', { note: { _like: 'alpha\\%' } }, ['bo']],
    ['_like _ matches one character', { note: { _like: 'bet_' } }, ['di']],
    ['_nlike leaves NULL out', { note: { _nlike: 'beta' } }, ['ada', 'bo']],
    ['_and', { _and: [{ team: { _eq: 'red' } }, { salary: { _lt: 20 } }] }, ['ada']],
    ['_or', { _or: [{ team: { _eq: 'blue' } }, { salary: { _eq: 30 } }] }, ['bo', 'cy']],
    ['_not of unknown stays unknown', { _not: { team: { _eq: 'red' } } }, ['bo']],
    ['a session variable (any case)', { owner: { _eq: 'X-HASURA-USER-ID' } }, ['ada', 'cy']],
    ['several operators in one comparison all hold', { salary: { _gt: 10, _lt: 40 } }, ['bo', 'cy']],
  ])('%s', (_, filter, kept) => expect(names(filter)).toEqual(kept));

  it.each<[string, object, Record<string, string>]>([
    ['a session value the request lacks (anonymous has no user id)', { owner: { _eq: 'X-Hasura-User-Id' } }, { 'x-hasura-role': 'anonymous' }],
    ['a session value inside _not still hides everything', { _not: { owner: { _eq: 'X-Hasura-User-Id' } } }, { 'x-hasura-role': 'anonymous' }],
    ['a column the table no longer has, even under _is_null', { gone: { _is_null: true } }, SESSION],
    ['the platform row id on rows of a door that carries none (SQL, downloads)', { _id: { _eq: 'r1' } }, SESSION],
    ['an unknown operator', { team: { _regex: '.*' } }, SESSION],
    ['a type mismatch (text against a boolean)', { team: { _neq: true } }, SESSION],
  ])('fails closed: %s keeps no row', (_, filter, session) => expect(names(filter, session)).toEqual([]));
});

describe('viewRows', () => {
  it('keeps stored order, applies the limit after the filter and drops hidden columns (the filter may read them)', () => {
    const permission = rule({ salary: { _gte: 20 } }, { columns: ['name', 'team'], limit: 2 });
    expect(viewRows(ROWS, COLUMNS, permission, SESSION)).toEqual([{ name: 'bo', team: 'blue' }, { name: 'cy', team: null }]);
  });

  it('keeps a door decoration the dataset does not declare (the page row id)', () => {
    const decorated = ROWS.map((row, i) => ({ ...row, __af_graphql_row_id: `r${i}` }));
    expect(viewRows(decorated, COLUMNS, rule({ team: { _eq: 'blue' } }, { columns: ['name'] }), SESSION)).toEqual([{ name: 'bo', __af_graphql_row_id: 'r1' }]);
  });

  it('reads `_id` from the ID a door carries on its rows, and never caches positions that depend on it', () => {
    const decorated = ROWS.map((row, i) => ({ ...row, __af_graphql_row_id: `r${i}` }));
    const byId = rule({ _id: { _in: ['r0', 'r2'] } }, { columns: ['name'] });
    expect(viewRows(decorated, COLUMNS, byId, SESSION, 'obj-1')).toEqual([{ name: 'ada', __af_graphql_row_id: 'r0' }, { name: 'cy', __af_graphql_row_id: 'r2' }]);
    // The same object through a door without IDs keeps nothing (no stale positions from the call above).
    expect(viewRows(ROWS, COLUMNS, byId, SESSION, 'obj-1')).toEqual([]);
  });

  it('returns the stored rows themselves for a rule that hides nothing', () => {
    expect(unrestricted(rule({}))).toBe(true);
    expect(unrestricted(rule({}, { limit: 5 }))).toBe(false);
    expect(viewRows(ROWS, COLUMNS, rule({}), SESSION)).toBe(ROWS);
  });

  it('caches kept positions by object, rule and session: another session is decided again', () => {
    const permission = rule({ owner: { _eq: 'X-Hasura-User-Id' } });
    expect(viewRows(ROWS, COLUMNS, permission, SESSION, 'obj-1').map((r) => r.name)).toEqual(['ada', 'cy']);
    expect(viewRows(ROWS, COLUMNS, permission, { ...SESSION, 'x-hasura-user-id': 'usr_b' }, 'obj-1').map((r) => r.name)).toEqual(['bo']);
    expect(viewRows(ROWS, COLUMNS, permission, SESSION, 'obj-1').map((r) => r.name)).toEqual(['ada', 'cy']);
  });

  it('materialises the 10,000-row dataset cap quickly, and a cached view faster', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ name: `n${i}`, team: i % 3 ? 'red' : 'blue', salary: i, owner: `usr_${i % 50}`, note: `note ${i}` }));
    const permission = rule({ _or: [{ owner: { _eq: 'X-Hasura-User-Id' } }, { _and: [{ team: { _eq: 'blue' } }, { salary: { _gt: 5000 } }] }] }, { columns: ['name', 'team'] });
    let started = performance.now();
    const cold = viewRows(rows, COLUMNS, permission, { 'x-hasura-user-id': 'usr_7' }, 'obj-10k');
    const coldMs = performance.now() - started;
    started = performance.now();
    const warm = viewRows(rows, COLUMNS, permission, { 'x-hasura-user-id': 'usr_7' }, 'obj-10k');
    const warmMs = performance.now() - started;
    expect(warm).toEqual(cold);
    expect(cold.length).toBe(rows.filter((r) => r.owner === 'usr_7' || (r.team === 'blue' && r.salary > 5000)).length);
    // Measured cost (logged for the PR): cold evaluation of 10k rows, then a cached projection.
    console.info(`role view 10k rows: cold ${coldMs.toFixed(1)}ms, cached ${warmMs.toFixed(1)}ms`);
    // A generous bound for shared CI runners; the logged numbers are the measurement.
    expect(coldMs).toBeLessThan(3000);
  });
});

import { expect, it } from 'vitest';
import { relayedRequest } from '../../html-reader/frame-bridge/parent';
const win = { location: { origin: 'https://platform.example' } } as Window;
const request = (path: string, method = 'POST') => relayedRequest(win, 'p1', { path, method, headers: { authorization: 'private', 'content-type': 'application/json' }, body: '{"query":"{ orders { total } }","operation":"query","variables":{},"revision":"spoof"}' }, { revision: '7', readOnly: false });
it('admits only the current page GraphQL POST and binds the trusted version', () => {
  const result = request('/api/artifacts/p1/graphql');
  expect(result?.path).toBe('/api/artifacts/p1/graphql');
  expect(result?.init.headers).toEqual({ 'content-type': 'application/json' });
  expect(JSON.parse(result!.init.body as string)).toEqual({ query: '{ orders { total } }', operation: 'query', variables: {}, revision: '7' });
  expect(request('/api/artifacts/p2/graphql')).toBeNull();
  expect(request('/api/artifacts/p1/graphql', 'GET')).toBeNull();
  expect(request('https://other.example/api/artifacts/p1/graphql')).toBeNull();
  expect(request('/api/artifacts/p1/graphql?revision=spoof')).toBeNull();
});
it('refuses GraphQL without trusted HTML context and refuses mutations in archived context', () => {
  const payload = { path: '/api/artifacts/p1/graphql', method: 'POST', headers: {}, body: '{"query":"mutation { orders { reserve } }","operation":"mutation","variables":{}}' };
  expect(relayedRequest(win, 'p1', payload)).toBeNull();
  expect(relayedRequest(win, 'p1', payload, { revision: '2', readOnly: true })).toBeNull();
  expect(relayedRequest(win, 'p1', { ...payload, body: 'not JSON' }, { revision: '2', readOnly: false })).toBeNull();
});
it('relays a mutation\'s Idempotency-Key in its own shape, and never a query\'s', () => {
  const key = 'k_0123456789abcdef';
  const relay = (operation: string, value: string) => relayedRequest(win, 'p1', { path: '/api/artifacts/p1/graphql', method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': value }, body: JSON.stringify({ query: `${operation} { insert_orders_one(object: {}) { _id } }`, operation, variables: {} }) }, { revision: '7', readOnly: false });
  expect(relay('mutation', key)?.init.headers).toEqual({ 'content-type': 'application/json', 'Idempotency-Key': key });
  expect(relay('query', key)?.init.headers).toEqual({ 'content-type': 'application/json' });
  expect(relay('mutation', 'short')?.init.headers).toEqual({ 'content-type': 'application/json' });
  expect(relay('mutation', `${key}\r\nx-evil: 1`)?.init.headers).toEqual({ 'content-type': 'application/json' });
});
it('admits the page SQL door: the trusted revision and read-only state bound, its Idempotency-Key relayed, nothing else carried', () => {
  const key = 'k_0123456789abcdef';
  const sql = (path: string, body: unknown, context?: { revision: string; readOnly: boolean }, method = 'POST') => relayedRequest(win, 'p1', { path, method, headers: { 'content-type': 'application/json', authorization: 'private', 'idempotency-key': key }, body: typeof body === 'string' ? body : JSON.stringify(body) }, context);
  const live = sql('/api/artifacts/p1/sql', { sql: 'update t set a = $p0', params: { p0: 1 }, revision: 'spoof', readOnly: false, extra: 'x' }, { revision: '7', readOnly: false });
  expect(live?.path).toBe('/api/artifacts/p1/sql');
  expect(live?.init.headers).toEqual({ 'content-type': 'application/json', 'Idempotency-Key': key });
  expect(JSON.parse(live!.init.body as string)).toEqual({ sql: 'update t set a = $p0', params: { p0: 1 }, revision: '7' });
  // An archived page still reads through the door; the server refuses its writes.
  expect(JSON.parse(sql('/api/artifacts/p1/sql', { sql: 'select 1' }, { revision: '2', readOnly: true })!.init.body as string)).toEqual({ sql: 'select 1', params: {}, revision: '2', readOnly: true });
  expect(sql('/api/artifacts/p1/sql', { sql: 'select 1' })).toBeNull();
  expect(sql('/api/artifacts/p2/sql', { sql: 'select 1' }, { revision: '7', readOnly: false })).toBeNull();
  expect(sql('/api/artifacts/p1/sql?x=1', { sql: 'select 1' }, { revision: '7', readOnly: false })).toBeNull();
  expect(sql('/api/artifacts/p1/sql', { sql: 'select 1' }, { revision: '7', readOnly: false }, 'GET')).toBeNull();
  expect(sql('/api/artifacts/p1/sql', { sql: 1 }, { revision: '7', readOnly: false })).toBeNull();
  expect(sql('/api/artifacts/p1/sql', { sql: 'select 1', params: [1] }, { revision: '7', readOnly: false })).toBeNull();
  expect(sql('/api/artifacts/p1/sql', 'not JSON', { revision: '7', readOnly: false })).toBeNull();
});
it('routes the page runtime\'s sql, sent through the one GraphQL relay as operation "sql", to the SQL door', () => {
  const key = 'k_0123456789abcdef';
  const viaGraphql = relayedRequest(win, 'p1', { path: '/api/artifacts/p1/graphql', method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key, authorization: 'private' }, body: JSON.stringify({ sql: 'select 1', params: { p0: 1 }, operation: 'sql', revision: 'spoof', query: 'ignored' }) }, { revision: '7', readOnly: true });
  expect(viaGraphql?.path).toBe('/api/artifacts/p1/sql');
  expect(viaGraphql?.init.headers).toEqual({ 'content-type': 'application/json', 'Idempotency-Key': key });
  // Only {sql, params} travel, under the trusted revision and read-only state; nothing else the frame sent.
  expect(JSON.parse(viaGraphql!.init.body as string)).toEqual({ sql: 'select 1', params: { p0: 1 }, revision: '7', readOnly: true });
  // Malformed, or without trusted context: refused, never relayed to GraphQL instead.
  expect(relayedRequest(win, 'p1', { path: '/api/artifacts/p1/graphql', method: 'POST', headers: {}, body: JSON.stringify({ sql: 7, operation: 'sql' }) }, { revision: '7', readOnly: false })).toBeNull();
  expect(relayedRequest(win, 'p1', { path: '/api/artifacts/p1/graphql', method: 'POST', headers: {}, body: JSON.stringify({ sql: 'select 1', operation: 'sql' }) })).toBeNull();
  expect(relayedRequest(win, 'p2', { path: '/api/artifacts/p1/graphql', method: 'POST', headers: {}, body: JSON.stringify({ sql: 'select 1', operation: 'sql' }) }, { revision: '7', readOnly: false })).toBeNull();
});

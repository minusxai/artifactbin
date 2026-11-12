import {expect,it} from 'vitest';
import {relayedRequest} from '../../html-reader/frame-bridge/parent';
const win={location:{origin:'https://platform.example'}} as Window;
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
it('routes the page runtime\'s sql, sent through the SQL relay as operation "sql", to the SQL door', () => {
  const key = 'k_0123456789abcdef';
  const viaSql = relayedRequest(win, 'p1', { path: '/api/artifacts/p1/sql', method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key, authorization: 'private' }, body: JSON.stringify({ sql: 'select 1', params: { p0: 1 }, operation: 'sql', revision: 'spoof', query: 'ignored' }) }, { revision: '7', readOnly: true });
  expect(viaSql?.path).toBe('/api/artifacts/p1/sql');
  expect(viaSql?.init.headers).toEqual({ 'content-type': 'application/json', 'Idempotency-Key': key });
  // Only {sql, params} travel, under the trusted revision and read-only state; nothing else the frame sent.
  expect(JSON.parse(viaSql!.init.body as string)).toEqual({ sql: 'select 1', params: { p0: 1 }, revision: '7', readOnly: true });
  // A declared query (`sql.query`): its name and values only, never SQL text, under the trusted revision.
  const declared = relayedRequest(win, 'p1', { path: '/api/artifacts/p1/sql', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'mine', params: { year: 2026 }, operation: 'sql', revision: 'spoof' }) }, { revision: '7', readOnly: false });
  expect(declared?.path).toBe('/api/artifacts/p1/sql');
  expect(JSON.parse(declared!.init.body as string)).toEqual({ query: 'mine', params: { year: 2026 }, revision: '7' });
  expect(relayedRequest(win, 'p1', { path: '/api/artifacts/p1/sql', method: 'POST', headers: {}, body: JSON.stringify({ query: 7, operation: 'sql' }) }, { revision: '7', readOnly: false })).toBeNull();
  // Malformed, or without trusted context: refused, never relayed to GraphQL instead.
  expect(relayedRequest(win, 'p1', { path: '/api/artifacts/p1/sql', method: 'POST', headers: {}, body: JSON.stringify({ sql: 7, operation: 'sql' }) }, { revision: '7', readOnly: false })).toBeNull();
  expect(relayedRequest(win, 'p1', { path: '/api/artifacts/p1/sql', method: 'POST', headers: {}, body: JSON.stringify({ sql: 'select 1', operation: 'sql' }) })).toBeNull();
  expect(relayedRequest(win, 'p2', { path: '/api/artifacts/p1/sql', method: 'POST', headers: {}, body: JSON.stringify({ sql: 'select 1', operation: 'sql' }) }, { revision: '7', readOnly: false })).toBeNull();
});

it('never relays retired GraphQL paths, even with an otherwise valid SQL body',()=>{
 const payload={method:'POST',headers:{},body:JSON.stringify({sql:'select 1',params:{},operation:'sql'})};
 for(const path of ['/api/artifacts/p1/graphql','/api/local-connection/p1/graphql'])expect(relayedRequest(win,'p1',{...payload,path},{revision:'7',readOnly:false})).toBeNull();
});

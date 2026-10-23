import { expect, it } from 'vitest';
import { relayedRequest } from '../../story-runtime/frame-bridge/parent';
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

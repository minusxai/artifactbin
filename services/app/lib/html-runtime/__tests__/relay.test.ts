import { expect, it } from 'vitest';
import { relayedRequest } from '../../story-runtime/frame-bridge/parent';
const win = { location: { origin: 'https://platform.example' } } as Window;
const request = (path: string, method = 'POST') => relayedRequest(win, 'p1', { path, method, headers: { authorization: 'private', 'content-type': 'application/json' }, body: '{}' });
it('admits only the current page GraphQL POST and strips caller credentials', () => {
  expect(request('/api/pages/p1/graphql')).toEqual({ path: '/api/pages/p1/graphql', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } });
  expect(request('/api/pages/p2/graphql')).toBeNull();
  expect(request('/api/pages/p1/graphql', 'GET')).toBeNull();
  expect(request('https://other.example/api/pages/p1/graphql')).toBeNull();
  expect(request('/api/pages/p1/graphql?revision=spoof')).toBeNull();
});

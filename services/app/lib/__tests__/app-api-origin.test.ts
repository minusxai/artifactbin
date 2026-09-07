import {expect,it,vi} from 'vitest';
import {createAppApi} from '@/web/api-origin';

it('uses host-only API cookies from the configured controls origin without widening unrelated requests', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response());
  const api = createAppApi('https://i.artifactbin.test', 'https://artifactbin.test', fetch);
  await api.fetch('/api/my/artifacts/x/like', {method:'POST',credentials:'same-origin'});
  expect(fetch).toHaveBeenLastCalledWith('/api/my/artifacts/x/like', expect.objectContaining({method:'POST',credentials:'same-origin'}));
  expect(new Headers(fetch.mock.calls.at(-1)![1]?.headers).get('x-artifactbin-csrf')).toBe('1');
  await api.fetch('/a/x/query', {credentials:'omit'});
  expect(fetch).toHaveBeenLastCalledWith('/a/x/query', expect.objectContaining({credentials:'omit'}));
  await api.fetch('https://other.test/file');
  expect(fetch).toHaveBeenLastCalledWith('https://other.test/file', undefined);
  expect(api.url('/a/x/events')).toBe('https://artifactbin.test/a/x/events');
  expect(api.url('/login')).toBe('https://i.artifactbin.test/login');
  expect(api.url('/tokens/new')).toBe('https://i.artifactbin.test/tokens/new');
});
it('marks ordinary same-origin app requests with the protected browser header', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response());
  const api = createAppApi('https://artifactbin.test', null, fetch);
  await api.fetch('/api/page/home');
  expect(fetch).toHaveBeenCalledWith('/api/page/home', expect.any(Object));
  expect(new Headers(fetch.mock.calls.at(-1)![1]?.headers).get('x-artifactbin-csrf')).toBe('1');
});

import {expect,it,vi} from 'vitest';
import {createAppApi} from '@/web/api-origin';

it('uses host-only API cookies from the configured controls origin without widening unrelated requests', async () => {
  const fetch = vi.fn(async () => new Response());
  const api = createAppApi('https://i.artifactbin.test', 'https://artifactbin.test', fetch);
  await api.fetch('/api/my/artifacts/x/like', {method:'POST',credentials:'same-origin'});
  expect(fetch).toHaveBeenLastCalledWith('https://artifactbin.test/api/my/artifacts/x/like', {method:'POST',credentials:'include'});
  await api.fetch('/a/x/query', {credentials:'omit'});
  expect(fetch).toHaveBeenLastCalledWith('https://artifactbin.test/a/x/query', {credentials:'omit'});
  await api.fetch('https://other.test/file');
  expect(fetch).toHaveBeenLastCalledWith('https://other.test/file', undefined);
  expect(api.url('/a/x/events')).toBe('https://artifactbin.test/a/x/events');
});
it('does not change ordinary same-origin app requests', async () => {
  const fetch = vi.fn(async () => new Response());
  const api = createAppApi('https://artifactbin.test', null, fetch);
  await api.fetch('/api/page/home');
  expect(fetch).toHaveBeenCalledWith('/api/page/home', undefined);
});

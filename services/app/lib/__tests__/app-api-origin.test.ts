import {expect,it,vi} from 'vitest';
import {createAppApi} from '@/web/api-origin';
import {artifactReturnAddress} from '@/lib/intent';

it('accepts only this artifact on main as a return address, preserving selection and fragment', () => {
  const own = 'https://artifactbin.test';
  expect(artifactReturnAddress(`${own}/@me/abc123-report?$x=a+b#section`, own, 'abc123')).toBe(`${own}/@me/abc123-report?$x=a+b#section`);
  expect(artifactReturnAddress(`${own}/a/abc123?intent=fork`, own, 'abc123')).toBe(`${own}/a/abc123?intent=fork`);
  expect(artifactReturnAddress(`${own}/@me/folder/abc123-report`, own, 'abc123')).toBe(`${own}/@me/folder/abc123-report`);
  for (const value of [null, '//evil.test/a/abc123', `${own}/a/other`, `${own}/controls/a/abc123`, 'https://i.artifactbin.test/a/abc123', `${own}/login`, `${own}/@me/abc123wrong`, `https://u:p@artifactbin.test/a/abc123`]) {
    expect(artifactReturnAddress(value, own, 'abc123')).toBeNull();
  }
});

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

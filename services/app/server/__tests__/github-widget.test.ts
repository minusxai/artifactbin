import { afterEach, expect, it, vi } from 'vitest';
import { createAppServer, APP_CSP } from '../app';
import { createGithubResponse } from '../external/github';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('exposes only the fixed repository metadata without loading third-party scripts', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ stargazers_count: 42 }));
  vi.stubGlobal('fetch', fetch);
  const response = await createAppServer().request('/api/external/github?url=https://evil.example');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url: 'https://github.com/minusxai/artifactbin', stars: 42 });
  expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/minusxai/artifactbin');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(APP_CSP).not.toContain('buttons.github.io');
});
it('coalesces upstream requests, expires after a minute, and limits downstream cache age', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(0);
  const fetch = vi.fn().mockImplementation(async () => Response.json({ stargazers_count: 42 }));
  vi.stubGlobal('fetch', fetch);
  const respond = createGithubResponse();
  const responses = await Promise.all([respond(), respond()]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(responses[0].headers.get('cache-control')).toBe('public, max-age=60');
  now.mockReturnValue(59_000);
  expect((await respond()).headers.get('cache-control')).toBe('public, max-age=1');
  expect(fetch).toHaveBeenCalledTimes(1);
  now.mockReturnValue(60_000);
  await respond();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([null, -1, '42', 1.5])('hides invalid upstream counts (%s)', async stars => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ stargazers_count: stars })));
  expect(await (await createGithubResponse()()).json()).toMatchObject({ stars: null });
});
it('caches network failures so an outage does not amplify requests', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetch);
  const respond = createGithubResponse();
  expect(await (await respond()).json()).toMatchObject({ stars: null });
  await respond();
  expect(fetch).toHaveBeenCalledTimes(1);
});

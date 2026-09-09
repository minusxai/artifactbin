import { describe, expect, it, vi } from 'vitest';
import { createGitHubStarsCache } from '../github-stars.server';

describe('fixed public GitHub count cache', () => {
  it('single-flights, caches and refreshes only the fixed public endpoint without credentials', async () => {
    let now = 0;
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stargazers_count: 1234 })));
    const cache = createGitHubStarsCache({ fetch, now: () => now, ttlMs: 100 });
    expect(await Promise.all([cache.get(), cache.get(), cache.get()])).toEqual([1234, 1234, 1234]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/minusxai/artifactbin');
    expect(init.headers).not.toHaveProperty('authorization');
    expect(init.headers).not.toHaveProperty('cookie');
    expect(await cache.get()).toBe(1234);
    now = 101;
    fetch.mockResolvedValue(new Response(JSON.stringify({ stargazers_count: 1235 })));
    expect(await cache.get()).toBe(1235);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([403, 429, 500, 'invalid', -1, 1.2, null])('preserves last good value and backs off after %s', async failure => {
    let now = 0;
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stargazers_count: 42 })));
    const cache = createGitHubStarsCache({ fetch, now: () => now, ttlMs: 10, backoffMs: 100 });
    expect(await cache.get()).toBe(42);
    now = 11;
    fetch.mockResolvedValue(typeof failure === 'number' && failure >= 400 ? new Response('', { status: failure }) : new Response(JSON.stringify({ stargazers_count: failure })));
    expect(await cache.get()).toBe(42);
    now = 20;
    expect(await cache.get()).toBe(42);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('bounds a stuck upstream even if it ignores abort, and never invents zero', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const cache = createGitHubStarsCache({ fetch, timeoutMs: 5 });
    expect(await cache.get()).toBeNull();
    expect(await cache.get()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

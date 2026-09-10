import { REPO_URL } from '@/lib/repo';

const TTL = 60_000;
const API_URL = 'https://api.github.com/repos/minusxai/artifactbin';

/** Fixed upstream only: this namespace must not become an arbitrary URL proxy.
 * Cache per server, coalesce concurrent requests, and briefly cache failures so
 * a rate-limited GitHub does not receive a request for every page view. */
export function createGithubResponse() {
  let cached: { stars: number | null; expires: number } | undefined;
  let pending: Promise<number | null> | undefined;
  return async (): Promise<Response> => {
    if (!cached || cached.expires <= Date.now()) {
      pending ??= (async () => {
        try {
          const response = await fetch(API_URL, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'artifactbin' },
            signal: AbortSignal.timeout(5_000),
            redirect: 'error',
          });
          if (!response.ok) return null;
          const data = await response.json();
          return Number.isSafeInteger(data.stargazers_count) && data.stargazers_count >= 0
            ? data.stargazers_count as number : null;
        } catch { return null; }
      })().then(stars => {
        cached = { stars, expires: Date.now() + TTL };
        return stars;
      }).finally(() => { pending = undefined; });
      await pending;
    }
    // Bound downstream cache age by the remaining server TTL, avoiding a
    // second full minute of staleness when serving near-expired cached data.
    const maxAge = Math.max(0, Math.floor((cached!.expires - Date.now()) / 1_000));
    return Response.json({ url: REPO_URL, stars: cached!.stars }, {
      headers: { 'Cache-Control': `public, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff' },
    });
  };
}

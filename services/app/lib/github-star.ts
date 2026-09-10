import { REPO_URL } from './repo';
import { GITHUB_MARK_PATH, GITHUB_MARK_VIEWBOX } from './github-mark';

export const GITHUB_EXTERNAL_URL = '/api/external/github';

/** Always available, including before hydration or when GitHub is unavailable.
 * currentColor follows the app or reader palette without scripting. */
export function githubStarMarkup(showCount = true): string {
  return `<a href="${REPO_URL}" target="_blank" rel="noopener noreferrer" aria-label="Star artifactbin on GitHub" title="Star artifactbin on GitHub" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:28px;height:28px;color:inherit;text-decoration:none;font:600 12px system-ui"><svg xmlns="http://www.w3.org/2000/svg" viewBox="${GITHUB_MARK_VIEWBOX}" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="${GITHUB_MARK_PATH}"></path></svg>${showCount ? '<span data-mx-github-count hidden></span>' : ''}</a>`;
}

let cached: { stars: number | null; expires: number } | undefined;
let pending: Promise<number | null> | undefined;
function githubStars(): Promise<number | null> {
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.stars);
  if (pending) return pending;
  let lifetime = 60_000;
  pending = fetch(GITHUB_EXTERNAL_URL, { credentials: 'omit', cache: 'no-store' })
    .then(async response => {
      if (!response.ok) return null;
      const maxAge = /(?:^|,)\s*max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '');
      if (maxAge) lifetime = Math.min(60_000, Number(maxAge[1]) * 1_000);
      const data = await response.json();
      return Number.isSafeInteger(data.stars) && data.stars >= 0 ? data.stars as number : null;
    })
    .catch(() => null)
    .then(stars => { cached = { stars, expires: Date.now() + lifetime }; return stars; })
    .finally(() => { pending = undefined; });
  return pending;
}

/** Share one count request between desktop/mobile and inline reader chrome. */
export function wireGithubStar(root: HTMLElement): () => void {
  const counts = root.querySelectorAll<HTMLElement>('[data-mx-github-count]');
  let disposed = false;
  if (counts.length) void githubStars().then(stars => {
    if (disposed) return;
    for (const count of counts) {
      count.hidden = stars === null;
      count.textContent = stars === null ? '' : stars.toLocaleString('en-US');
    }
  });
  return () => { disposed = true; };
}

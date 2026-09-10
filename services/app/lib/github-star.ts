import { REPO_URL } from './repo';

export const GITHUB_EXTERNAL_URL = '/api/external/github';

/** Always available, including before hydration or when GitHub is unavailable.
 * Label and count follow the surrounding palette; the star uses Primer’s
 * --button-star-iconColor (#eac54f): https://primer-docs-preview.github.com/product/primitives/color/ */
export function githubStarMarkup(showCount = true): string {
  return `<a href="${REPO_URL}" target="_blank" rel="noopener noreferrer" aria-label="Star artifactbin on GitHub" style="display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:28px;overflow:hidden;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:5px;background:var(--mx-reader-bg,var(--color-surface,#fff));color:inherit;text-decoration:none;font:600 12px system-ui;letter-spacing:normal;white-space:nowrap"><span style="display:inline-flex;align-items:center;gap:4px;height:100%;padding:0 8px;background:linear-gradient(transparent,color-mix(in srgb,currentColor 7%,transparent))"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="#eac54f" aria-hidden="true"><path d="m12 2.5 2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96Z"></path></svg><span>Star</span></span>${showCount ? '<span data-mx-github-count hidden style="align-self:stretch;align-content:center;padding:0 8px;border-left:1px solid color-mix(in srgb,currentColor 25%,transparent);font-variant-numeric:tabular-nums"></span>' : ''}</a>`;
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

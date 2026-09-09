/** Shared presentation for React chrome and the document chrome bridge. */
export const githubStarLabel = (count: number | null) => `Star artifactbin on GitHub${count === null ? '' : ` · ${count.toLocaleString('en-US')} stars`} (opens in a new tab)`;
export const githubCountText = (count: number | null) => count === null ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(count);
export const GITHUB_COUNT_STYLE = 'display:inline-block;width:6ch;text-align:right;font-variant-numeric:tabular-nums';
export const githubCountMarkup = () => `<span data-mx-github-count aria-hidden="true" style="${GITHUB_COUNT_STYLE}">—</span>`;

let count: number | null = null;
let nextAttempt = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<(value: number | null) => void>();
/** One same-origin request shared across chrome mounts; failure keeps the link. */
export function subscribeGithubStars(listener: (value: number | null) => void): () => void {
  listeners.add(listener);
  listener(count);
  if (!pending && Date.now() >= nextAttempt) {
    pending = fetch('/api/github-stars', { credentials: 'omit', signal: AbortSignal.timeout(4000) })
      .then(async response => {
        if (!response.ok) throw new Error('count unavailable');
        const data = await response.json();
        if (!Number.isSafeInteger(data.count) || data.count < 0) throw new Error('invalid count');
        count = data.count;
        nextAttempt = Date.now() + 60_000;
        for (const notify of listeners) notify(count);
      }).catch(() => { nextAttempt = Date.now() + 60_000; })
      .finally(() => { pending = null; });
  }
  return () => { listeners.delete(listener); };
}
export function wireGithubStars(root: ParentNode): () => void {
  return subscribeGithubStars(value => {
    for (const link of root.querySelectorAll('[data-mx-github-star]')) {
      link.setAttribute('aria-label', githubStarLabel(value));
      const counter = link.querySelector('[data-mx-github-count]');
      if (counter) counter.textContent = githubCountText(value);
    }
  });
}

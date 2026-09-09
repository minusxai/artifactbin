/** Fixed public repository cache. Request credentials never enter this boundary. */
export interface GitHubStarsOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  ttlMs?: number;
  backoffMs?: number;
  timeoutMs?: number;
}
export function createGitHubStarsCache(options: GitHubStarsOptions = {}): { get(): Promise<number | null> } {
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let count: number | null = null;
  let nextAttempt = 0;
  let pending: Promise<number | null> | null = null;
  return { get() {
    if (pending) return pending;
    if (now() < nextAttempt) return Promise.resolve(count);
    pending = (async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const value = await Promise.race([
          (async () => {
            const response = await fetch('https://api.github.com/repos/minusxai/artifactbin', {
              headers: { accept: 'application/vnd.github+json', 'user-agent': 'artifactbin-stars', 'x-github-api-version': '2022-11-28' },
              redirect: 'error', signal: controller.signal,
            });
            if (!response.ok) throw new Error('GitHub unavailable');
            const data = await response.json();
            if (!Number.isSafeInteger(data.stargazers_count) || data.stargazers_count < 0) throw new Error('Invalid count');
            return data.stargazers_count as number;
          })(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('GitHub timeout')); }, options.timeoutMs ?? 2000); }),
        ]);
        count = value;
        nextAttempt = now() + (options.ttlMs ?? 15 * 60_000);
      } catch {
        nextAttempt = now() + (options.backoffMs ?? 60_000);
      } finally {
        clearTimeout(timer);
        pending = null;
      }
      return count;
    })();
    return pending;
  } };
}

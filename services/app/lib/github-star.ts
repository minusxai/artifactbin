import { REPO_URL } from './repo';

/** Only this fixed vendor document is admitted by the page's frame-src policy. */
export const GITHUB_WIDGET_URL = 'https://buttons.github.io/buttons.html';
export const GITHUB_WIDGET_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
export const GITHUB_WIDGET_TITLE = 'Star artifactbin on GitHub';

/** Shared by React and document chrome; vendor code runs only inside its sandbox. */
export function githubWidgetMarkup(showCount = true): string {
  const options = new URLSearchParams({
    href: REPO_URL,
    'data-show-count': String(showCount),
    'data-size': 'large',
    'data-text': 'Star',
    'data-color-scheme': 'light',
    'aria-label': GITHUB_WIDGET_TITLE,
  });
  // The vendor uses decodeURIComponent, not form encoding: spaces must be %20.
  const src = `${GITHUB_WIDGET_URL}?theme=light#${options}`.replaceAll('+', '%20').replaceAll('&', '&amp;');
  // This independent link remains available even when the vendor is blocked.
  return `<iframe src="${src}" title="${GITHUB_WIDGET_TITLE}" sandbox="${GITHUB_WIDGET_SANDBOX}" referrerpolicy="no-referrer" loading="lazy" width="${showCount ? 150 : 80}" height="28" scrolling="no" style="display:block;flex:none;border:0;height:28px;width:${showCount ? 150 : 80}px;color-scheme:normal"></iframe>`
    + `<a href="${REPO_URL}" target="_blank" rel="noopener noreferrer" aria-label="Open artifactbin on GitHub (fallback link)" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;color:inherit;text-decoration:none">↗</a>`;
}

/** Match the actual chrome palette, never the OS preference or an unrelated
 * document theme. Watch only this chrome's ancestors, including a trusted
 * shadow root, and leave the vendor frame alone when its scheme is unchanged. */
export function wireGithubWidgetTheme(root: HTMLElement): () => void {
  const sync = () => {
    for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe')) {
      const url = new URL(frame.src);
      if (url.origin + url.pathname !== GITHUB_WIDGET_URL) continue;
      const reader = frame.closest<HTMLElement>('[data-mx-reader-chrome]');
      const host = reader ?? frame.closest<HTMLElement>('[data-mx-github-star]')!;
      const palette = getComputedStyle(host);
      const actual = reader ? palette.getPropertyValue('--mx-reader-scheme').trim() : palette.colorScheme;
      const scheme = actual === 'dark' ? 'dark' : 'light';
      const options = new URLSearchParams(url.hash.slice(1));
      if (options.get('data-color-scheme') === scheme) continue;
      options.set('data-color-scheme', scheme);
      // The vendor parses its hash only at startup. A query change performs
      // a document navigation; a fragment-only change would leave old paint.
      url.searchParams.set('theme', scheme);
      url.hash = options.toString().replaceAll('+', '%20');
      frame.setAttribute('src', url.href);
    }
  };
  const observer = new MutationObserver(sync);
  let ancestor: HTMLElement | null = root;
  while (ancestor) {
    observer.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-app-appearance'] });
    const tree = ancestor.getRootNode();
    ancestor = ancestor.parentElement ?? (tree instanceof ShadowRoot ? tree.host as HTMLElement : null);
  }
  sync();
  return () => observer.disconnect();
}

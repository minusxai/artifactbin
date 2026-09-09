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
    'data-color-scheme': '',
    'aria-label': GITHUB_WIDGET_TITLE,
  });
  const src = `${GITHUB_WIDGET_URL}#${options}`.replaceAll('&', '&amp;');
  // This independent link remains available even when the vendor is blocked.
  return `<iframe src="${src}" title="${GITHUB_WIDGET_TITLE}" sandbox="${GITHUB_WIDGET_SANDBOX}" referrerpolicy="no-referrer" loading="lazy" width="${showCount ? 150 : 80}" height="28" scrolling="no" style="display:block;flex:none;border:0;height:28px;width:${showCount ? 150 : 80}px;color-scheme:inherit"></iframe>`
    + `<a href="${REPO_URL}" target="_blank" rel="noopener noreferrer" aria-label="Open artifactbin on GitHub (fallback link)" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;color:inherit;text-decoration:none">↗</a>`;
}

import { REPO_URL } from './repo';

/** Static first-party wrapper; vendor code executes only inside its sandbox. */
export const GITHUB_WIDGET_URL = '/-/github-star';
export const GITHUB_WIDGET_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
export const GITHUB_WIDGET_TITLE = 'Star artifactbin on GitHub';

/** Shared by React and document chrome; vendor code runs only inside its sandbox. */
export function githubWidgetMarkup(showCount = true): string {
  const options = new URLSearchParams({
    'data-show-count': String(showCount),
    'data-color-scheme': 'light',
  });
  const src = `${GITHUB_WIDGET_URL}?theme=light#${options}`.replaceAll('+', '%20').replaceAll('&', '&amp;');
  // Stack the loading/failure link and frame in one slot, never side-by-side.
  return `<span style="display:inline-grid;height:28px"><iframe src="${src}" title="${GITHUB_WIDGET_TITLE}" sandbox="${GITHUB_WIDGET_SANDBOX}" referrerpolicy="no-referrer" width="80" height="28" scrolling="no" style="grid-area:1/1;visibility:hidden;display:block;border:0;height:28px;width:80px;color-scheme:normal"></iframe>`
    + `<a href="${REPO_URL}" target="_blank" rel="noopener noreferrer" aria-label="Open artifactbin on GitHub (fallback link)" style="grid-area:1/1;display:inline-flex;align-items:center;justify-content:center;height:28px;color:inherit;text-decoration:none;font:600 12px system-ui">GitHub ↗</a></span>`;
}

/** Size the isolated vendor and match the actual chrome palette, never an unrelated
 * document theme. Watch only this chrome's ancestors, including a trusted
 * shadow root, and leave the vendor frame alone when its scheme is unchanged. */
export function wireGithubWidgetTheme(root: HTMLElement): () => void {
  const resize = (event: MessageEvent) => {
    if (event.origin !== 'null' || event.data?.type !== 'github-widget-size') return;
    const { width, height } = event.data;
    // Browser zoom rounds CSS geometry to fractional values. Validate a bounded
    // rectangle, not an exact nominal pixel height, and round UP to avoid clipping.
    if (typeof width !== 'number' || !Number.isFinite(width) || width < 40 || width > 300
      || typeof height !== 'number' || !Number.isFinite(height) || height < 16 || height > 40) return;
    for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe')) {
      if (new URL(frame.src).pathname !== GITHUB_WIDGET_URL || event.source !== frame.contentWindow) continue;
      frame.style.width = `${Math.ceil(width)}px`;
      frame.style.height = `${Math.ceil(height)}px`;
      frame.parentElement!.style.height = `${Math.ceil(height)}px`;
      frame.style.visibility = 'visible';
      const fallback = frame.nextElementSibling as HTMLElement | null;
      if (fallback) fallback.style.display = 'none';
    }
  };
  window.addEventListener('message', resize);
  const frames = [...root.querySelectorAll<HTMLIFrameElement>('iframe')].filter(frame => new URL(frame.src).pathname === GITHUB_WIDGET_URL);
  const measure = () => { for (const frame of frames) frame.contentWindow?.postMessage('github-widget-measure', '*'); };
  for (const frame of frames) frame.addEventListener('load', measure);
  window.addEventListener('resize', measure);
  window.addEventListener('pageshow', measure);
  measure();
  const sync = () => {
    for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe')) {
      const url = new URL(frame.src);
      if (url.pathname !== GITHUB_WIDGET_URL) continue;
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
      frame.style.visibility = 'hidden';
      const fallback = frame.nextElementSibling as HTMLElement | null;
      if (fallback) fallback.style.display = 'inline-flex';
      frame.setAttribute('src', url.href);
    }
    measure();
  };
  const observer = new MutationObserver(sync);
  let ancestor: HTMLElement | null = root;
  while (ancestor) {
    observer.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-app-appearance'] });
    const tree = ancestor.getRootNode();
    ancestor = ancestor.parentElement ?? (tree instanceof ShadowRoot ? tree.host as HTMLElement : null);
  }
  sync();
  return () => {
    observer.disconnect(); window.removeEventListener('message', resize);
    for (const frame of frames) frame.removeEventListener('load', measure);
    window.removeEventListener('resize', measure);
    window.removeEventListener('pageshow', measure);
  };
}

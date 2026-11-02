import {escapeHtml} from '@artifactbin/utils/escape';
export function fontPreloadTags(urls: readonly string[], highPriority = false): string {
  return [...new Set(urls)].map((url) => `<link ${highPriority ? 'fetchpriority="high" ' : ''}rel="preload" href="${escapeHtml(url)}" as="font" type="font/woff2" crossorigin>`).join('');
}

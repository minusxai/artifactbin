/**
 * The isolated scripted browser has no network. It may ask the app for only
 * the two Google Fonts resources already admitted by document CSP; the app
 * fetches each through the same DNS-pinned external transport as imports.
 */
import { FONT_FILES, FONT_STYLES } from '@artifactbin/contracts';
import { fetchWebResource } from './fetch';
import { WebIngestError } from './guard';
import { sniffFontType } from './sniff';

export const BROWSER_FONT_MAX_BYTES = 2_000_000;
export const BROWSER_FONT_TIMEOUT_MS = 10_000;
const MAX_URL_BYTES = 8192;
const FONT_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const GOOGLE_FONT_FILE_PATH = /^\/s\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:woff2?|ttf|otf)$/i;

/** One CSS API and Google-hosted font files only; redirect hops use this same predicate. */
export function browserFontUrlAllowed(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
  if (url.origin === FONT_STYLES) return (url.pathname === '/css' || url.pathname === '/css2') && url.search.length > 1;
  if (url.origin === FONT_FILES) return GOOGLE_FONT_FILE_PATH.test(url.pathname) && !url.search;
  return false;
}

function parsedFontUrl(raw: string): URL {
  if (raw.length > MAX_URL_BYTES) throw new WebIngestError('invalid_url', 'font URL exceeds the relay limit');
  let url: URL;
  try { url = new URL(raw); } catch { throw new WebIngestError('invalid_url', 'font URL is invalid'); }
  if (!browserFontUrlAllowed(url)) throw new WebIngestError('forbidden_host', 'font URL is outside the supported Google Fonts resources');
  return url;
}

/** Fetch bytes under an exact URL policy; caller credentials, headers, and user agents never enter. */
export async function fetchBrowserFontResource(
  raw: string,
  fetcher: typeof fetchWebResource = fetchWebResource,
): Promise<{ bytes: Buffer; contentType: string }> {
  const url = parsedFontUrl(raw);
  const css = url.origin === FONT_STYLES;
  const got = await fetcher(url.href, {
    maxBytes: BROWSER_FONT_MAX_BYTES,
    timeoutMs: BROWSER_FONT_TIMEOUT_MS,
    accept: css ? 'text/css,*/*;q=0.1' : 'font/woff2,font/woff,*/*;q=0.1',
    userAgent: FONT_USER_AGENT,
    allowHosts: hostname => hostname === new URL(FONT_STYLES).hostname || hostname === new URL(FONT_FILES).hostname,
    allowUrl: browserFontUrlAllowed,
  });
  if (css) {
    if (got.contentType !== 'text/css') throw new WebIngestError('unsupported_type', 'Google Fonts returned a non-CSS stylesheet');
    return { bytes: got.bytes, contentType: 'text/css' };
  }
  const contentType = sniffFontType(got.bytes);
  if (!contentType) throw new WebIngestError('unsupported_type', 'Google Fonts returned a non-font resource');
  return { bytes: got.bytes, contentType };
}

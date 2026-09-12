import { BUILD_ASSET_HEADER, BUILD_ASSET_PATH } from '@artifactbin/contracts';

/** A candidate is only a probe; the app's manifest is the authority. */
export function isBuildAssetPath(pathname: string): boolean {
  return /^\/assets\/[\w.-]+\.(?:js|css|woff2)$/.test(pathname);
}

/** Rebuild from an allowlist: no credentials, identity or forwarding inputs. */
export function buildAssetRequest(incoming: Request): Request | null {
  const url = new URL(incoming.url);
  if (!['GET', 'HEAD'].includes(incoming.method) || url.search || !isBuildAssetPath(url.pathname)) return null;
  url.pathname = BUILD_ASSET_PATH + url.pathname;
  const headers = new Headers();
  for (const name of ['accept-encoding', 'if-none-match', 'if-modified-since', 'range', 'if-range']) {
    const value = incoming.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(url, { method: incoming.method, headers, signal: incoming.signal });
}

/** Admit only the dedicated handler's bytes; never cache a fallback or redirect. */
export function buildAssetResponse(response: Response): Response | null {
  if (response.headers.get(BUILD_ASSET_HEADER) !== '1' || ![200, 206, 304].includes(response.status)) return null;
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (!mime || !['text/javascript', 'application/javascript', 'text/css', 'font/woff2'].includes(mime)) return null;
  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'content-encoding', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'vary']) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}

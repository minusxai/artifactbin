/** Deployment-owned origin and exact public byte-route boundary. */
export function parseAssetsOrigin(main: string, controls: string | null, configured: string): string {
  const root = new URL(main), asset = new URL(configured);
  const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.localhost');
  if (!['http:', 'https:'].includes(asset.protocol) || asset.username || asset.password
    || asset.pathname !== '/' || asset.search || asset.hash
    || asset.hostname === root.hostname || (controls && asset.hostname === new URL(controls).hostname)
    || (asset.protocol !== 'https:' && !(loopback(root.hostname) && loopback(asset.hostname)))) {
    throw new Error('APP__ASSETS_ORIGIN must be a distinct HTTPS hostname without a path, query or credentials (HTTP only on loopback)');
  }
  return asset.origin;
}

export function isPublicAssetRequest(request: Request, origin: string): boolean {
  const url = new URL(request.url);
  if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method)) return false;
  if (/^\/assets\/ref\/[A-Za-z0-9]{6}$/.test(url.pathname)) return url.search === '';
  if (!/^\/assets\/[0-9a-f]{64}$/.test(url.pathname)) return false;
  for (const [key, value] of url.searchParams) {
    if (url.searchParams.getAll(key).length !== 1
      || !(key === 'v' ? /^[0-9a-f]{8,64}$/.test(value) : key === 'w' && /^[1-9][0-9]{0,4}$/.test(value))) return false;
  }
  return true;
}

/** Strip authority-bearing response metadata and refuse upstream redirects. */
export function publicAssetResponse(response: Response): Response {
  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel();
    return new Response('asset upstream refused', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  headers.delete('location');
  headers.delete('access-control-allow-credentials');
  headers.set('access-control-allow-origin', '*');
  const policy = headers.get('content-security-policy');
  if (!policy) headers.set('content-security-policy', 'sandbox');
  else if (!policy.split(';').some(directive => directive.trim() === 'sandbox')) headers.set('content-security-policy', `${policy}; sandbox`);
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

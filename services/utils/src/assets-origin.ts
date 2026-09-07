/** Deployment-owned origin and exact public byte-route boundary. */
export function parseAssetsOrigin(main: string, controls: string | null, configured: string): string {
  const root = new URL(main), asset = new URL(configured);
  const loopback = (host: string) => ['localhost','127.0.0.1','[::1]'].includes(host) || host.endsWith('.localhost');
  if (!['http:','https:'].includes(asset.protocol) || asset.username || asset.password
    || asset.pathname !== '/' || asset.search || asset.hash
    || asset.hostname === root.hostname || (controls && asset.hostname === new URL(controls).hostname)
    || (asset.protocol !== 'https:' && !(loopback(root.hostname) && loopback(asset.hostname)))) {
    throw new Error('APP__ASSETS_ORIGIN must be a distinct HTTPS hostname without a path, query or credentials (HTTP only on loopback)');
  }
  return asset.origin;
}
export function isPublicAssetRequest(request: Request, origin: string): boolean {
  const url = new URL(request.url);
  if (url.origin !== origin || !['GET','HEAD'].includes(request.method) || !/^\/assets\/[0-9a-f]{64}$/.test(url.pathname)) return false;
  for (const [key,value] of url.searchParams) {
    if (url.searchParams.getAll(key).length !== 1 || !(key === 'v' ? /^[0-9a-f]{8,64}$/.test(value) : key === 'w' && /^[1-9][0-9]{0,4}$/.test(value))) return false;
  }
  return true;
}

/** This public byte host never sets credentials or redirects to another surface. */
export function publicAssetResponse(response: Response): Response {
  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel();
    return new Response('asset upstream refused',{status:502,headers:{'cache-control':'no-store'}});
  }
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');headers.delete('location');headers.delete('access-control-allow-credentials');
  headers.set('access-control-allow-origin','*');
  headers.set('content-security-policy','sandbox');headers.set('x-content-type-options','nosniff');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

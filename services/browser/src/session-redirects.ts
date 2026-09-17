/**
 * Playwright routing only intercepts the first request in a redirect chain.
 * Resolve redirects here so the isolated browser never needs direct network
 * access. The browser retains the requested URL; every hop revalidates identity.
 */
export async function sessionRequest(request: Request, send: (request: Request) => Promise<Response>): Promise<Response> {
  const origin = new URL(request.url).origin;
  let url = new URL(request.url), method = request.method;
  let body: ArrayBuffer | undefined = request.body ? await request.arrayBuffer() : undefined;
  const headers = new Headers(request.headers), visited = new Set<string>();
  for (let hop = 0; hop < 10; hop++) {
    const key = `${method} ${url.href}`;
    if (visited.has(key)) throw new Error('Session redirect loop');
    visited.add(key);
    const response = await send(new Request(url, {method, headers, body, signal:request.signal, redirect:'manual'}));
    const location = response.headers.get('location');
    if (![301,302,303,307,308].includes(response.status) || !location) return response;
    await response.body?.cancel();
    url = new URL(location, url);
    if (url.origin !== origin || url.username || url.password) throw new Error('Redirect origin is outside this session');
    if ((response.status === 303 && method !== 'HEAD') || ([301,302].includes(response.status) && method === 'POST')) {
      method = 'GET'; body = undefined; headers.delete('content-type'); headers.delete('content-length');
    }
  }
  throw new Error('Session redirect limit exceeded');
}

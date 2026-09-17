import http from 'node:http';

/** JSON with a Set on the wire as an array — a Set stringifies to `{}` and binds nothing, which is a bug this was found by. */
const replacer = (_k: string, v: unknown) => (v instanceof Set ? [...v] : v);

export interface HttpClient { post<T>(path: string, body: unknown): Promise<T> }

/** A deadline on EVERY call: a hung service is a failure the caller sees, never a render that waits forever. */
export function httpClient(url: string, opts: { deadlineMs: number; headers?: Record<string, string> }): HttpClient {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...opts.headers }, body: JSON.stringify(body, replacer), signal: AbortSignal.timeout(opts.deadlineMs) });
      if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return (await res.json()) as T;
    },
  };
}

export type JsonRoutes = Record<string, (body: unknown) => Promise<unknown>>;
export interface JsonServer { listen(port: number, host?: string): { port: number; url: string }; close(): Promise<void> }

/**
 * A POST per route, a body cap, the detail to the operator log and only the
 * name to the caller (a parser's message quotes the bytes it choked on).
 */
export function jsonServer(routes: JsonRoutes, opts: { maxBody: number }): JsonServer {
  const server = http.createServer(async (req, res) => {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body, replacer)); };
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const route = routes[req.url ?? ''];
    if (!route) return json(404, { error: 'not_found' });
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > opts.maxBody) { json(413, { error: 'too_large' }); req.destroy(); return; } chunks.push(c as Buffer); }
    try {
      return json(200, await route(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    } catch (error) {
      // The url is CALLER INPUT: as the format string its own `%s`/`%d` would eat
      // the arguments after it and the error would vanish from the line (CodeQL
      // js/tainted-format-string). It travels as an argument, logged verbatim.
      console.error('[json-server] %s failed:', req.url, error);
      return json(400, { error: 'bad_request' });
    }
  });
  return {
    // No host → Node binds synchronously and the port is known on return; a hostname bind resolves asynchronously.
    listen: (port, host) => { if (host) server.listen(port, host); else server.listen(port); const a = server.address(); const p = typeof a === 'object' && a ? a.port : port; return { port: p, url: `http://${host ?? '127.0.0.1'}:${p}` }; },
    close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((e) => (e ? reject(e) : resolve())); }),
  };
}

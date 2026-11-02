import http from 'node:http';
import { SERVICE_AUTH_HEADER } from '@artifactbin/contracts';
import { collectNodeBody } from './body';

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

/** How a service shell is served: the body cap, and what a service process adds to the bare transport. */
export interface PostServerOptions {
  maxBody: number;
  /** The one GET path answered `{ ok: true }`, BEFORE the secret check, so an orchestrator's probe works with a secret set. */
  health?: string;
  /** Every other request must carry it in SERVICE_AUTH_HEADER, or is a 401. */
  serviceSecret?: string;
}

interface JsonServerOptions extends PostServerOptions {
  /** The operator log's prefix for a failed route (`[label] <url> failed:`). */
  label?: string;
  /** SQL/credential-bearing services must not log parser or engine exception text. */
  redactErrors?: boolean;
}

/**
 * A POST per route, a body cap, the detail to the operator log and only the
 * name to the caller (a parser's message quotes the bytes it choked on). The
 * services' shells (events, sql) are this server with a health probe and a secret.
 */
export function jsonServer(routes: JsonRoutes, opts: JsonServerOptions): JsonServer {
  const failed = `[${opts.label ?? 'json-server'}] %s failed:`;
  return postServer(path => Boolean(routes[path]), async (req, res, raw) => {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body, replacer)); };
    try {
      return json(200, await routes[req.url ?? '']!(JSON.parse(raw.toString('utf8'))));
    } catch (error) {
      // Caller-controlled URLs travel as arguments, never as the format string.
      console.error(failed, req.url, opts.redactErrors ? 'request_failed' : error);
      return json(400, { error: 'bad_request' });
    }
  }, opts);
}

/** Shared request admission and socket lifecycle; each shell owns parsing, route errors and response bytes. */
export function postServer(
  accepts: (path: string) => boolean,
  handle: (req: http.IncomingMessage, res: http.ServerResponse, raw: Buffer) => Promise<unknown>,
  opts: PostServerOptions,
): JsonServer {
  const server = http.createServer(async (req, res) => {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (opts.health && req.method === 'GET' && req.url === opts.health) return json(200, { ok: true });
    if (opts.serviceSecret && req.headers[SERVICE_AUTH_HEADER] !== opts.serviceSecret) return json(401, { error: 'unauthorized' });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!accepts(req.url ?? '')) return json(404, { error: 'not_found' });
    const raw = await collectNodeBody(req, opts.maxBody);
    if (!raw) { json(413, { error: 'too_large' }); req.destroy(); return; }
    return handle(req, res, raw);
  });
  return {
    // No host → Node binds synchronously; a hostname bind resolves asynchronously.
    listen: (port, host) => { if (host) server.listen(port, host); else server.listen(port); const a = server.address(); const p = typeof a === 'object' && a ? a.port : port; return { port: p, url: `http://${host ?? '127.0.0.1'}:${p}` }; },
    close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((e) => (e ? reject(e) : resolve())); }),
  };
}

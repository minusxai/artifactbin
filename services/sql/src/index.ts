/**
 * THE SQL SERVICE, from the outside: the contract (re-exported from
 * @artifactbin/contracts), an HTTP client that speaks it, and the server
 * shell that serves ANY SqlService over the same wire. No DuckDB here — the
 * engine is `@artifactbin/sql/local`, and only a composition root loads it.
 */
import http from 'node:http';
import type { SqlService } from '@artifactbin/contracts';
import { SERVICE_AUTH_HEADER, SQL_ROUTES } from '@artifactbin/contracts';
import { type JsonServer } from '@artifactbin/utils';
import { DEFAULT_CAPS, type SqlCaps } from './caps';

export type * from '@artifactbin/contracts';
export { isQueryFailure, SQL_ROUTES } from '@artifactbin/contracts';
export { inferColumns } from './dataset-shape';
export { queryBounds } from './bounds';
// One-wave compatibility re-export while consumers move to @artifactbin/utils.
export { sqlClient } from '@artifactbin/utils';
export { DEFAULT_CAPS, type SqlCaps };

/** The one GET a shell answers — the Docker HEALTHCHECK and the compose `depends_on` condition. */
const HEALTH = '/health';
/** JSON with a Set on the wire as an array (utils' rule, repeated here because the shell owns its server). */
const replacer = (_k: string, v: unknown) => (v instanceof Set ? [...v] : v);

/**
 * One POST per method, plus `GET /health`. Holds no credentials, opens no database, reads no identity:
 * put it on a private network. (The POST plumbing mirrors utils' `jsonServer`, which is POST-only —
 * the health route is this shell's, so the shared helper stays untouched for every other caller.)
 */
export function serveSql(svc: SqlService, opts: { maxBody?: number; serviceSecret?: string } = {}): JsonServer {
  const routes: Record<string, (body: unknown) => Promise<unknown>> = {
    [SQL_ROUTES.run]: async (b) => ({ results: await svc.run(b as Parameters<SqlService['run']>[0]) }),
    [SQL_ROUTES.mutate]: async (b) => ({ result: await svc.mutate(b as Parameters<SqlService['mutate']>[0]) }),
    [SQL_ROUTES.dryRun]: (b) => svc.dryRun(b as Parameters<SqlService['dryRun']>[0]),
    [SQL_ROUTES.dryRunMutations]: (b) => svc.dryRunMutations(b as Parameters<SqlService['dryRunMutations']>[0]),
  };
  const maxBody = opts.maxBody ?? 64 * 1024 * 1024;
  const server = http.createServer(async (req, res) => {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body, replacer)); };
    if (req.method === 'GET' && req.url === HEALTH) return json(200, { ok: true });
    if (opts.serviceSecret && req.headers[SERVICE_AUTH_HEADER] !== opts.serviceSecret) return json(401, { error: 'unauthorized' });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const route = routes[req.url ?? ''];
    if (!route) return json(404, { error: 'not_found' });
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > maxBody) { json(413, { error: 'too_large' }); req.destroy(); return; } chunks.push(c as Buffer); }
    try {
      return json(200, await route(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    } catch (error) {
      // The url is CALLER INPUT: as the format string its own `%s`/`%d` would eat
      // the arguments after it and the error would vanish from the line (CodeQL
      // js/tainted-format-string). It travels as an argument, logged verbatim.
      console.error('[sql-shell] %s failed:', req.url, error);
      return json(400, { error: 'bad_request' });
    }
  });
  return {
    // No host → Node binds synchronously and the port is known on return; a hostname bind resolves asynchronously.
    listen: (port, host) => { if (host) server.listen(port, host); else server.listen(port); const a = server.address(); const p = typeof a === 'object' && a ? a.port : port; return { port: p, url: `http://${host ?? '127.0.0.1'}:${p}` }; },
    close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((e) => (e ? reject(e) : resolve())); }),
  };
}

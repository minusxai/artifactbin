/**
 * THE BROWSER SERVICE, from the outside: the contract, an HTTP client, and
 * the server shell over ANY BrowserService. No Playwright here — that is
 * `@artifactbin/browser/local`, loaded only by a composition root.
 *
 * The wire: `POST /render` with a RenderRequest; the answer is the image
 * (Content-Type image/*) or a JSON verdict — the verdict is the contract as
 * much as the bytes are, because retry and 503-vs-500 depend on it.
 * `POST /render-upload` is the same render with the bytes PUT to a signed URL,
 * and `POST /sessions` is the stateful surface: a BrowserSessionRequest against
 * a persistent isolated session, served only when the composition supplied a
 * `sessions` implementation (otherwise 503 `sessions_unavailable`).
 * See docs/mx-sessions.md.
 */
import http from 'node:http';
import type { BrowserService, RenderRequest, RenderUploadRequest, BrowserSessionRequest } from '@artifactbin/contracts';
import { BROWSER_ROUTES, SERVICE_AUTH_HEADER } from '@artifactbin/contracts';
import type { JsonServer } from '@artifactbin/utils';

export type * from '@artifactbin/contracts';
export { BROWSER_ROUTES } from '@artifactbin/contracts';
// `browserClient` lives in @artifactbin/utils; re-exported here so a caller can take the
// client from the same package as the shell it speaks to. That is how this package's own
// contract and internal-assets tests reach it; the app imports utils directly.
export { browserClient } from '@artifactbin/utils';

export function serveBrowser(svc: BrowserService, opts: { maxBody?: number; serviceSecret?: string } = {}): JsonServer {
  const maxBody = opts.maxBody ?? 96 * 1024;
  const server = http.createServer(async (req, res) => {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    // The one GET the shell answers — the liveness/readiness probe for whatever orchestrates the service.
    if (req.method === 'GET' && req.url === '/health') return json(200, { ok: true });
    if (opts.serviceSecret && req.headers[SERVICE_AUTH_HEADER] !== opts.serviceSecret) return json(401, { error: 'unauthorized' });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (req.url !== BROWSER_ROUTES.render && req.url !== BROWSER_ROUTES.renderUpload && req.url !== BROWSER_ROUTES.sessions) return json(404, { error: 'not_found' });
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > maxBody) { json(413, { error: 'too_large' }); req.destroy(); return; } chunks.push(c as Buffer); }
    let input: RenderRequest;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(400, { error: 'bad_request' }); }
    if (req.url === BROWSER_ROUTES.sessions) {
      if (!svc.sessions) return json(503, { error: 'sessions_unavailable' });
      const request = input as unknown as BrowserSessionRequest;
      if (!request || !['script', 'status', 'close'].includes(request.op) || !request.actor || typeof request.actor !== 'object') return json(400, { error: 'bad_request' });
      return json(200, await svc.sessions.request(request));
    }
    if(req.url===BROWSER_ROUTES.renderUpload){
      if(!svc.renderAndUpload)return json(503,{ok:false,reason:"upload_unavailable"});
      return json(200,await svc.renderAndUpload(input as unknown as RenderUploadRequest));
    }
    const r = await svc.render(input);
    if (r.ok) { res.writeHead(200, { 'content-type': r.mime, 'content-length': String(r.bytes.byteLength) }); return res.end(Buffer.from(r.bytes)); }
    return json(200, r);
  });
  return {
    listen: (port, host) => { if (host) server.listen(port, host); else server.listen(port); const a = server.address(); const p = typeof a === 'object' && a ? a.port : port; return { port: p, url: `http://${host ?? '127.0.0.1'}:${p}` }; },
    close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((e) => (e ? reject(e) : resolve())); }),
  };
}

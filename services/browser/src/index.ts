/**
 * THE BROWSER SERVICE, from the outside: the contract, an HTTP client, and
 * the server shell over ANY BrowserService. No Playwright here — that is
 * `@artifactbin/browser/local`, loaded only by a composition root.
 *
 * The wire: `POST /render` with a RenderRequest; the answer is the image
 * (Content-Type image/*) or a JSON verdict — the verdict is the contract as
 * much as the bytes are, because retry and 503-vs-500 depend on it.
 * `POST /render-upload` is the same render with the bytes PUT to a signed URL,
 * `POST /harvest` answers the SVG drawings a loaded page drew, as JSON text,
 * and `POST /sessions` is the stateful surface: a BrowserSessionRequest against
 * a persistent isolated session, served only when the composition supplied a
 * `sessions` implementation (otherwise 503 `sessions_unavailable`).
 * A service without an operation answers 503 `<op>_unavailable`, and the client (utils `browserClient`) maps an
 * older service's 404 to the same verdict, so a mixed-version rollout degrades instead of failing.
 */
import type { BrowserService, RenderRequest, RenderUploadRequest, BrowserSessionRequest, SvgHarvestRequest } from '@artifactbin/contracts';
import { BROWSER_ROUTES } from '@artifactbin/contracts';
import type { JsonServer } from '@artifactbin/utils';
import { postServer } from '@artifactbin/utils';

export type * from '@artifactbin/contracts';
export { BROWSER_ROUTES } from '@artifactbin/contracts';
// `browserClient` lives in @artifactbin/utils; re-exported here so a caller can take the
// client from the same package as the shell it speaks to. That is how this package's own
// contract and internal-assets tests reach it; the app imports utils directly.
export { browserClient } from '@artifactbin/utils';

export function serveBrowser(svc: BrowserService, opts: { maxBody?: number; serviceSecret?: string } = {}): JsonServer {
  return postServer(
    path => Object.values(BROWSER_ROUTES).some(route => route === path),
    async (req, res, raw) => {
      const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      let input: RenderRequest;
      try { input = JSON.parse(raw.toString('utf8')); } catch { return json(400, { error: 'bad_request' }); }
      if (req.url === BROWSER_ROUTES.sessions) {
        if (!svc.sessions) return json(503, { error: 'sessions_unavailable' });
        const request = input as unknown as BrowserSessionRequest;
        if (!request || !['script', 'status', 'close'].includes(request.op) || !request.actor || typeof request.actor !== 'object') return json(400, { error: 'bad_request' });
        return json(200, await svc.sessions.request(request));
      }
      if (req.url === BROWSER_ROUTES.harvest) {
        if (!svc.harvestSvg) return json(503, { ok: false, reason: 'harvest_unavailable' });
        const request = input as unknown as SvgHarvestRequest;
        if (!request || typeof request.url !== 'string' || typeof request.selector !== 'string' || typeof request.collect !== 'string') return json(400, { error: 'bad_request' });
        return json(200, await svc.harvestSvg(request));
      }
      if(req.url===BROWSER_ROUTES.renderUpload){
        if(!svc.renderAndUpload)return json(503,{ok:false,reason:"upload_unavailable"});
        return json(200,await svc.renderAndUpload(input as unknown as RenderUploadRequest));
      }
      const r = await svc.render(input);
      if (r.ok) { res.writeHead(200, { 'content-type': r.mime, 'content-length': String(r.bytes.byteLength) }); return res.end(Buffer.from(r.bytes)); }
      return json(200, r);
  }, { ...opts, maxBody: opts.maxBody ?? 96 * 1024, health: '/health' });
}

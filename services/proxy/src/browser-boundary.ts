import type { Actor } from '@artifactbin/contracts';
import { parseControlsOrigin } from '@artifactbin/utils';
import {platformFramePage,trustedRegionRoute} from '@artifactbin/utils/platform-pages';

/** Deployment-owned route and browser-authority policy. The proxy asks before
 * resolving cookies and before dispatch; no UI component can relax it. */
export interface BrowserBoundary {
  credentialAt(request: Request): 'full' | 'read' | 'none';
  check(request: Request, actor: Actor): Response | null;
  responseHeaders(request: Request, headers: Headers): Record<string, string>;
}
export function createBrowserBoundary(main: string, configured: string): BrowserBoundary {
  const root = new URL(main), controls = new URL(parseControlsOrigin(main, configured));
  if (root.hostname === controls.hostname) throw new Error('Controls require a distinct hostname');
  const read = (request: Request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST') return /^\/a\/[A-Za-z0-9]+\/query$/.test(path);
    if (!['GET', 'HEAD'].includes(request.method)) return false;
    return /^\/a\/[A-Za-z0-9]+(?:\/(?:raw|export|thumbnail|query|assets|events(?:\/frame)?))?$/.test(path)
      // Pretty paths resolve by their last ID-bearing segment, even without
      // a title or with obsolete folder decoration. This is read authority only.
      || /^\/@[^/]+\/(?:[^/]+\/)*[A-Za-z0-9]{6,12}(?:-[^/]*)?\/?$/.test(path);
  };
  const deny = (error: string, status = 403) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
  return {
    credentialAt(request) {
      const host = new URL(request.url).host;
      return host === controls.host ? 'full' : host === root.host && read(request) ? 'read' : 'none';
    },
    check(request, _actor) {
      const { host, pathname } = new URL(request.url);
      if (host !== root.host && host !== controls.host) return deny('unknown_host', 421);
      if (host === root.host) {
        if (pathname === '/oauth/authorize/approve') return deny('trusted_host_required');
        const publicPage = ['GET', 'HEAD'].includes(request.method) && /^\/api\/page\/(?:session|home|profile(?:\/.*)?)$/.test(pathname);
        if ((!publicPage && /^\/api\/(?:auth|my|page|browser|session)(?:\/|$)/.test(pathname))
          || (/^\/a\//.test(pathname) && !['GET', 'HEAD'].includes(request.method) && !read(request))) return deny('trusted_host_required');
        return null;
      }
      const documentApi = /^\/a\/[A-Za-z0-9]+\/(?:query|mutate|events(?:\/frame)?)$/.test(pathname);
      if ((!documentApi && /^\/(?:a(?:\/|$)|@)/.test(pathname)) || /^\/assets\/(?:[a-f0-9]{64}(?:[./]|$)|ref(?:\/|$))/i.test(pathname)) return deny('not_found', 404);
      // Only provider callbacks bypass the browser-fetch header. Better Auth
      // validates their one-time state/PKCE, not an Origin-less blanket carveout.
      const callback = request.method === 'GET' && /^\/api\/auth\/(?:callback|oauth2\/callback)\/[^/]+$/.test(pathname);
      if (pathname === '/oauth/authorize' && request.method === 'GET') return null;
      // A native, unframeable approval form carries a one-time, session-bound
      // token checked by the OAuth route instead of the fetch-only header.
      if (pathname === '/oauth/authorize/approve' && request.method === 'POST') {
        if(request.headers.get('accept')==='application/json' && request.headers.get('x-artifactbin-csrf')!=='1')return deny('browser_origin_required');
        return request.headers.get('origin') === controls.origin ? null : deny('browser_origin_required');
      }
      if (!callback && (/^\/(?:api|oauth)(?:\/|$)/.test(pathname) || documentApi)) {
        const origin = request.headers.get('origin');
        // Native EventSource cannot set a custom header. This narrow read-only
        // route uses browser-controlled Fetch Metadata plus the same ACL as
        // the document API; same-site siblings and opaque frames fail closed.
        const stream = request.method === 'GET' && /^\/a\/[A-Za-z0-9]+\/events$/.test(pathname)
          && request.headers.get('accept') === 'text/event-stream'
          && request.headers.get('sec-fetch-site') === 'same-origin' && (!origin || origin === controls.origin);
        const sameOrigin = origin === controls.origin || (!origin && ['GET', 'HEAD'].includes(request.method)
          && request.headers.get('sec-fetch-site') === 'same-origin');
        if (!stream && (!sameOrigin || request.headers.get('x-artifactbin-csrf') !== '1')) return deny('browser_origin_required');
      }
      return null;
    },
    responseHeaders(request, headers): Record<string, string> {
      if (new URL(request.url).host !== controls.host) return {};
      const url=new URL(request.url);
      const frameable = url.pathname==='/controls/consent' || /^\/controls\/(?:a|folder)\/[A-Za-z0-9]+$/.test(url.pathname) || platformFramePage(url.pathname)!==null || trustedRegionRoute(url.pathname,url.searchParams.get('page'))!==null;
      const policy = (headers.get('content-security-policy') ?? '').split(';')
        .map(p => p.trim()).filter(p => p && !p.startsWith('frame-ancestors '));
      policy.push(`frame-ancestors ${frameable ? root.origin : "'none'"}`);
      return { 'content-security-policy': policy.join('; '), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    },
  };
}

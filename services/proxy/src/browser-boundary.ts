import type { Actor } from '@artifactbin/contracts';

/** Deployment-owned route and browser-authority policy. The proxy asks before
 * resolving cookies and before dispatch; no UI component can relax it. */
export interface BrowserBoundary {
  credentialAt(request: Request): 'full' | 'none';
  check(request: Request, actor: Actor): Response | null;
  responseHeaders(request: Request, headers: Headers): Record<string, string>;
}
export function createBrowserBoundary(main: string): BrowserBoundary {
  const root = new URL(main);
  const machineOAuth=(request:Request)=>/^\/oauth\/(?:token|register)$/.test(new URL(request.url).pathname);
  const deny = (error: string, status = 403) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
  return {
    credentialAt(request) {
      return new URL(request.url).host === root.host && !machineOAuth(request) ? 'full' : 'none';
    },
    check(request, actor) {
      const { host, pathname } = new URL(request.url);
      if (host !== root.host) return deny('unknown_host', 421);
      {
        if(machineOAuth(request))return null; // route-owned PKCE/client proof, never cookies
        // Bearer is an independent authority, including a rejected bearer that
        // must reach the separate operator verifier without cookie fallback.
        if(/^Bearer(?:\s|$)/i.test(request.headers.get('authorization')??''))return null;
        const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
        const foreign=(origin!==null&&origin!==root.origin)||(site!==null&&!['same-origin','none'].includes(site));
        const safe=['GET','HEAD','OPTIONS'].includes(request.method);
        const callback=request.method==='GET'&&/^\/api\/auth\/(?:callback|oauth2\/callback)\/[^/]+$/.test(pathname);
        if(callback)return null; // provider state/PKCE remains the route's proof
        if(pathname==='/oauth/authorize/approve'&&request.method==='POST'){
          return origin===root.origin&&!foreign&&(request.headers.get('accept')!=='application/json'||request.headers.get('x-artifactbin-csrf')==='1')?null:deny('browser_origin_required');
        }
        const cookie=actor.credential==='session'||actor.credential==='agent-cookie'||actor.credential==='read-session';
        const privateApi=/^\/api\/(?:auth|my|page|browser|session)(?:\/|$)/.test(pathname);
        const navigation=request.method==='GET'&&!/^\/(?:api|oauth)(?:\/|$)/.test(pathname)&&origin===null
          &&request.headers.get('sec-fetch-mode')==='navigate'&&request.headers.get('sec-fetch-dest')==='document';
        if(foreign&&!navigation&&(cookie||privateApi))return deny('browser_origin_required');
        const dataRead=/^\/api(?:\/|$)/.test(pathname)||/^\/a\/[A-Za-z0-9]+\/(?:query|events(?:\/frame)?)$/.test(pathname);
        if(safe&&cookie&&dataRead&&origin!==root.origin&&site!=='same-origin')return deny('browser_origin_required');
        if(!safe&&(cookie||request.headers.has('cookie')||/^\/api\/auth(?:\/|$)/.test(pathname))
          &&(origin!==root.origin||request.headers.get('x-artifactbin-csrf')!=='1'||(site!==null&&site!=='same-origin')))return deny('browser_origin_required');
        return null;
      }
    },
    responseHeaders(): Record<string,string> { return {}; },
  };
}

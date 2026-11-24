/**
 * THE APP PAGE: the one Solid entry (web/solid-app.html) for every address the app answers, with what that address
 * will immediately ask for inlined (./document-address `pageBootstrap`), under the app CSP at that address
 * (./app-policy); and the app's own screens, which a configured custom shell (./custom-shell) answers in its place.
 * The app server (./app) routes to these two; a dead end is answered in the language the caller asked in.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runWithRequest, shellFile } from '@/lib/platform';
import type { ArtifactPageAnswer } from '@/lib/document-serving';
import { baseUrl, json, type PagesSite } from '@/lib/http';
import { agentDiscovery, agentDiscoveryHead } from '@/lib/agent-copy';
import { compressDynamic } from './content-encoding';
import { customShellResponse, loadCustomShell, namesDocument } from './custom-shell';
import { APP_SECURITY_HEADERS, appPagePolicyAt } from './app-policy';
import { renderAppPage, type PageParts } from './app-shell';
import { type Admitted, anonymousDocumentHead, pageBootstrap } from './document-address';

/**
 * A guessed machine address is answered in the machine's language. A path
 * under `/api/` nobody serves, `/openapi.json` and `/.well-known/ai-plugin.json`
 * answer the same shape `unauthorized()` does: the error, and the one way on —
 * `/llms.txt`. A page of HTML tells a fetch tool nothing.
 *
 * Mounted AFTER the real routes (an earlier match wins) and BEFORE the SPA
 * fallback, by EXACT path under `/.well-known/` — a prefix mount there would
 * swallow `/.well-known/oauth-protected-resource`, which is the proxy's.
 *
 * Every OTHER miss answers this too when the caller never asked for HTML
 * (`page()` below).
 */
export const apiNotFound = (c: { req: { raw: Request } }) => {
  const guessedQuery = /^\/api\/artifacts\/[^/]+\/query\/?$/.test(new URL(c.req.raw.url).pathname);
  return json({
    error: 'not_found',
    help: guessedQuery ? '/llms/datasets' : '/llms.txt',
    ...(guessedQuery ? { details: ['Read and write a page\'s linked datasets with one SQL statement: POST /api/artifacts/<pageId>/sql {"sql", "params", "revision"}. Use /llms/datasets for tables, discovery and permissions.'] } : {}),
  }, 404, { 'Cache-Control': 'no-store' });
};

// The caller asked for a page: a browser's navigation names `text/html`; curl's `*/*` and a fetch tool's do not.
const wantsHtml = (request: Request): boolean => (request.headers.get('accept') ?? '').includes('text/html');

/** The document page's reader header: which renderer answered. */
const readerHeaders = (reader: ArtifactPageAnswer['reader'] | undefined): Record<string, string> => (reader ? { ['x-mx-reader']: reader.mode } : {});

type PageRequest = { req: { raw: Request; url: string } };

/** The page and screen responses for one app server: its options, its pages site, the build it serves and the listing preloader. */
export function createAppPage(opts: { webDir: string; indexHtml?: (url: string) => Promise<string>; devHmrPort?: number; shellFile?: string | null }, pagesSite: PagesSite, build: string | null, preloadListing: PageParts['preloadListing']) {
  const webDir = opts.webDir;
  /** The policy the app page (`shell`: the custom shell's screen) at this request's address carries (./app-policy). */
  const policyAt = (request: Request, shell = false): string => appPagePolicyAt(new URL(request.url), { site: pagesSite, pageOrigin: baseUrl(request), devHmrPort: opts.devHmrPort, shell });
  // Read at boot: a file that cannot be read stops the boot here, naming the setting.
  const configuredShell = opts.shellFile === undefined ? shellFile() : opts.shellFile;
  const customShell = configuredShell ? loadCustomShell(configuredShell) : null;
  let indexCache: string | null = null;
  /** The app shell: the one Solid entry (web/solid-app.html) for every address the app answers. */
  const index = async (url: string): Promise<string> => {
    if (opts.indexHtml) return opts.indexHtml(url);
    return (indexCache ??= readFileSync(path.join(webDir, 'solid-app.html'), 'utf8'));
  };

  /**
   * The app page. When the address names something the page will immediately
   * ask for — a document, a profile — the server answers that question HERE
   * and inlines the answer, so the SPA's first paint is its final geometry:
   * no fetch round trip, no chrome settling, no address healing a beat later.
   * The endpoints stay the truth; this is the same data, arriving earlier.
   */
  const page = async (c: PageRequest, status?: 200 | 404, canonical?: string, address?: string, admitted?: Admitted) => {
    // A document served at a non-canonical address is rendered AS its canonical address (see admitDocumentAddress).
    const url = address ? new URL(address + new URL(c.req.url).search, c.req.url).href : c.req.url;
    const found = status === 404 ? null : await pageBootstrap(c.req.raw, new URL(url).pathname, admitted, pagesSite);
    const data = found ? { ...found.data, ...(address ? { address } : {}) } : null;
    // A document is the app page's frame (lib/document-serving/document-frame), named in the page's head as the document.
    const frame = found?.frame ?? null;
    // An @-address whose profile resolves to NOTHING is a miss, and a miss is
    // 404 as a STATUS (the rule documents already live by) — the SPA is still
    // the body, so the person sees the app's own 404 page rather than a
    // default. Only derived when the caller did not already decide (the
    // document handlers pass their admission's 404 explicitly).
    const miss = data === null && new URL(url).pathname.split('/').filter(Boolean)[0]?.startsWith('@');
    const code = status ?? (miss ? 404 : 200);
    const html = await index(url);
    // A dead end is answered in the language the caller asked in: a browser
    // gets the app's own 404 page, anything else (curl's `*/*`, a fetch tool)
    // gets the refusal that names the way on.
    if (code === 404 && !wantsHtml(c.req.raw)) return apiNotFound(c);
    const origin = baseUrl(c.req.raw);
    const body = renderAppPage(html, { origin, data, frame, canonical, build, appRow: admitted?.read.row ?? null, preloadListing });
    // Brotli for a client that takes it (server/content-encoding); identity otherwise, as before.
    return compressDynamic(c.req.raw, new Response(body, { status: code, headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...APP_SECURITY_HEADERS,
      'content-security-policy': policyAt(c.req.raw),
      ...readerHeaders(found?.reader),
      // A document's address carries the agent pointer as a header too, for a fetch that reads no body.
      ...(frame ? { Link: `<${agentDiscovery(origin).url}>; rel="help"` } : {}),
    } }));
  };

  /** One of the app's own screens: the custom shell in its place when one is set (./custom-shell), else the app page. */
  const screen = async (c: { req: { raw: Request; url: string; method: string } }): Promise<Response> => {
    if (!customShell) return page(c);
    const url = new URL(c.req.url);
    const help = agentDiscovery(baseUrl(c.req.raw));
    // The head slot carries the agent pointer the app page's head carries, then the document's own head where it names one.
    const head = !customShell.headed ? '' : agentDiscoveryHead(help) + (namesDocument(url) ? await runWithRequest(c.req.raw, () => anonymousDocumentHead(c.req.raw, url.pathname)) : '');
    // The policy the app page at this address carries (a document address admits its trusted embedders), and its agent pointer.
    return customShellResponse(customShell, c.req.method, policyAt(c.req.raw, true),
      { ...APP_SECURITY_HEADERS, Link: `<${help.url}>; rel="help"` }, head);
  };

  return { page, screen, index, customShell };
}

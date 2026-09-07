import { AGENT_HEADER, declaredAgentSlug } from '@artifactbin/contracts';
import { currentHeaders } from './request-context';
import { PUBLIC_BASE_URL, CONTROLS_ORIGIN } from '@/lib/config';

/** Absolute origin as the client sees it — honors reverse-proxy forwarding headers. Accepts a plain Request too (the MCP handler), falling back to its url. */
export function baseUrl(request: Request): string {
  const url = new URL(request.url);
  const proto = (request.headers.get('x-forwarded-proto') || url.protocol.replace(':', ''))
    .split(',')[0]
    .trim();
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host)
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

/**
 * The public origin, read from the incoming request's own headers — for the
 * places that have no Request to hand (Next's `generateMetadata`).
 *
 * Same forwarding rules as `baseUrl`, because it is the same question. Next
 * would otherwise resolve a relative `og:image` against `metadataBase`, which
 * defaults to the origin THIS PROCESS listens on: behind the proxy that is the
 * container's address, and every shared link unfurled with an image pointing
 * at `http://localhost:3000`.
 */
export async function publicOrigin(): Promise<string> {
  const h = await currentHeaders();
  if (h) {
    const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0].trim();
    const host = (h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim();
    if (host) return `${proto}://${host}`;
  }
  // Off-request (a direct handler call in a test, a build): what the deployment declares.
  return PUBLIC_BASE_URL;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * The uniform bearer/browser refusal, with the two recovery addresses an agent needs.
 *
 * `tokens` is the HUMAN's door, and it is SOURCE-TAGGED when the caller declared a harness
 * (`Artifactbin-Agent`), so the person who ends up on `/tokens/new` arrives on a page that knows which
 * agent sent them. The declaration is self-reported and only ever decides copy — never access.
 */
export function unauthorized(request: Request): Response {
  const base = baseUrl(request);
  const source = declaredAgentSlug(request.headers.get(AGENT_HEADER));
  return json(
    {
      error: 'unauthorized',
      docs: `${base}/docs`,
      tokens: `${base}/tokens/new${source ? `?source=${source}` : ''}`,
    },
    401,
    { 'Cache-Control': 'no-store' },
  );
}

/** Parse a JSON body; returns null on malformed/missing JSON (caller answers 400). */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * How every agent-facing doc is served.
 *
 * `text/markdown` is technically right and practically wrong: the web readers
 * agents actually use (ChatGPT browsing, r.jina.ai, plain curl pipelines)
 * reject it or offer it as a download, so the one endpoint the entire
 * onboarding depends on became unreadable to the audience it exists for.
 * Markdown IS plain text; serving it as such reads identically everywhere.
 */
export const MARKDOWN_CONTENT_TYPE = 'text/plain; charset=utf-8';

/**
 * One cookie out of a raw Cookie header. The proxy and route handlers both
 * operate on a plain Request, so cookie parsing is shared here rather than
 * depending on framework request state. Values are not decoded: a signed
 * value is already URL-safe, and decoding one
 * would only invent failure modes.
 */
export function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Is this a cross-site browser request?
 *
 * `Origin` (and `Sec-Fetch-Site`) are set BY THE BROWSER and cannot be forged
 * by page script — unlike a path, which any same-origin script can rewrite.
 * That is the whole reason this is the CSRF signal.
 *
 * Absence is NOT cross-site: an agent curling the API with a bearer token
 * sends no Origin, and the protocol must keep working. This is therefore only
 * ever consulted for requests authorized by a COOKIE — where a browser is by
 * definition the caller, and where a missing Origin means a same-origin
 * navigation-ish request that SameSite=Lax already vouched for.
 */
export function isCrossSiteRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (CONTROLS_ORIGIN) {
    const origin = request.headers.get('origin');
    return origin ? origin !== new URL(PUBLIC_BASE_URL).origin && origin !== CONTROLS_ORIGIN : site !== 'same-origin';
  }
  if (site) return site === 'cross-site';
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== addressedHost(request);
  } catch {
    return true; // an unparseable Origin is not our own
  }
}

/**
 * The host the CLIENT addressed — not the one this process is listening on.
 *
 * Behind a reverse proxy those differ: the browser asks for the public name
 * while `request.url` carries the container's internal address, so comparing
 * an Origin against the latter makes every request look foreign — and a
 * browser that sends no `Sec-Fetch-Site` (older Safari) would then get 403 on
 * every cookie-authenticated mutation. Reading the forwarded host is what
 * keeps those working. `x-forwarded-host` wins where the proxy also rewrites
 * `Host`.
 */
function addressedHost(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0].trim();
  if (forwarded) return forwarded;
  const host = request.headers.get('host')?.trim();
  if (host) return host;
  return new URL(request.url).host;
}

/**
 * ONE byte range, as a reader that seeks asks for it.
 *
 * Three shapes are answered — `bytes=a-b`, `bytes=a-` and `bytes=-n` (the last
 * n bytes, which is where a PDF keeps its cross-reference table, so it is the
 * first thing a viewer asks for) — and everything else is `null`, meaning
 * SERVE THE WHOLE THING. That is deliberate: 200 with the entire body is always
 * a correct answer to a Range request, so a malformed or multi-range header
 * costs a reader nothing, while refusing one would break a viewer over a header
 * we simply chose not to implement.
 *
 * `unsatisfiable` is the one refusal (416): a range that begins past the end is
 * not a request we can answer at all, and answering 200 to it makes a seeking
 * viewer read the same bytes forever.
 *
 * The end is INCLUSIVE, HTTP's own convention, and clamped to the last byte —
 * `bytes=0-999999` on a small file is a normal thing for a viewer to send.
 */
export function parseByteRange(header: string | null, size: number):
  | { start: number; end: number }
  | null
  | 'unsatisfiable' {
  if (!header || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    // A suffix: the last N bytes. More than the file is the whole file.
    const wanted = Number(rawEnd);
    if (wanted <= 0) return 'unsatisfiable';
    return { start: Math.max(0, size - wanted), end: size - 1 };
  }
  const start = Number(rawStart);
  if (start >= size) return 'unsatisfiable';
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
}

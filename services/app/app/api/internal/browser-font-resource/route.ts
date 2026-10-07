import { isBrowserSessionRequest } from '@/lib/accounts';
import { json } from '@/lib/http';
import { fetchBrowserFontResource } from '@/lib/web-ingest/browser-fonts';
import { WebIngestError } from '@/lib/web-ingest/guard';

const NO_STORE = { 'Cache-Control': 'no-store' };
const refusalStatus = (error: WebIngestError): number => {
  if (error.code === 'invalid_url') return 400;
  if (error.code === 'forbidden_host' || error.code === 'forbidden_scheme' || error.code === 'forbidden_address') return 403;
  if (error.code === 'too_large') return 413;
  if (error.code === 'timeout') return 504;
  return 502;
};

/** The public proxy refuses this `/api/internal` path; the app still requires the trusted attached actor and session mark. */
export async function GET(request: Request): Promise<Response> {
  if (!isBrowserSessionRequest(request)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const raw = new URL(request.url).searchParams.get('url') ?? '';
  try {
    const resource = await fetchBrowserFontResource(raw);
    return new Response(new Uint8Array(resource.bytes), { status: 200, headers: {
      ...NO_STORE,
      'Access-Control-Allow-Origin': '*',
      'Content-Type': resource.contentType,
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof WebIngestError) return json({ error: error.code }, refusalStatus(error), NO_STORE);
    return json({ error: 'font_fetch_failed' }, 502, NO_STORE);
  }
}

/** POST cannot turn this read-only relay into an open write proxy. */
export const POST = (): Response => json({ error: 'method_not_allowed' }, 405, { ...NO_STORE, Allow: 'GET' });

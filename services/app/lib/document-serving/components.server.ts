/** `/af/components/<file>` (lib/libraries/components.server): entries revalidate (`no-cache` + ETag), chunks are immutable. */
import { COMPONENT_CHUNK, loadComponentFile } from '@/lib/libraries/components.server';
import { matchingTag, withEncoding } from '@/lib/http/revalidation';
import { NO_CACHE, NO_STORE, PUBLIC_IMMUTABLE } from './cache-control';

export async function componentModuleResponse(request: Request, file: string): Promise<Response> {
  const found = await loadComponentFile(file);
  if (!found) return new Response('Not found', { status: 404, headers: { 'cache-control': NO_STORE } });
  const encoded = /\bbr\b/.test(request.headers.get('accept-encoding') ?? '');
  const etag = encoded ? withEncoding(found.etag, 'br') : found.etag;
  const headers: Record<string, string> = {
    'content-type': 'text/javascript; charset=utf-8', 'cache-control': COMPONENT_CHUNK.test(file) ? PUBLIC_IMMUTABLE : NO_CACHE, etag,
    'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff', vary: 'Accept-Encoding',
  };
  if (matchingTag(request.headers.get('if-none-match'), found.etag)) return new Response(null, { status: 304, headers });
  const body = encoded ? found.br : found.body;
  if (encoded) headers['content-encoding'] = 'br';
  headers['content-length'] = String(body.byteLength);
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { headers });
}

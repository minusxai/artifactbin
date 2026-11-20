/** Shared browser response for admitted PDFs, with opaque-origin sandboxing and streamed byte ranges. */
import { Readable } from 'node:stream';
import { parseByteRange } from '@/lib/http';
import { loadPdfStream, ObjectUnavailable, type PdfMeta } from '@/lib/object-store';

export async function serveInlinePdf(
  request: Request,
  meta: PdfMeta,
  disposition: string,
  options: { cacheControl: string; cors?: boolean; etag?: string },
): Promise<Response> {
  const common: Record<string, string> = {
    'Cache-Control': options.cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(options.cors ? { 'Access-Control-Allow-Origin': '*' } : {}),
  };
  const headers = {
    ...common,
    'Content-Type': meta.contentType,
    // Chromium's viewer works under a sandbox that gives the response an opaque origin.
    'Content-Security-Policy': 'sandbox',
    'Content-Disposition': disposition,
    'Accept-Ranges': 'bytes',
  };
  if (request.method === 'HEAD') {
    return new Response(null, { headers: { ...headers, 'Content-Length': String(meta.bytes) } });
  }
  const ifRange = request.headers.get('if-range');
  const range = parseByteRange(!ifRange || ifRange === options.etag ? request.headers.get('range') : null, meta.bytes);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${meta.bytes}` } });
  }
  try {
    const stream = await loadPdfStream(meta, range ?? undefined);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        'Content-Length': String(range ? range.end - range.start + 1 : meta.bytes),
        ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${meta.bytes}` } : {}),
      },
    });
  } catch (error) {
    if (error instanceof ObjectUnavailable) {
      return new Response('asset unavailable', { status: 503, headers: { ...common, 'Cache-Control': 'no-store' } });
    }
    throw error;
  }
}

import { isPublicAssetRequest, publicAssetResponse } from '@artifactbin/utils';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

// Export transport bounds, independent of the app's configurable ingest limit.
const MAX_BYTES = 64 * 1024 * 1024;

/** Only deployment-owned public byte URLs may reach the internal app. No browser authority crosses this boundary. */
export async function internalAssetResponse(target: string, method: string, assetOrigin: string, internalOrigin: string, signal: AbortSignal): Promise<Response> {
  const asset = new URL(assetOrigin), url = new URL(target), internal = new URL(internalOrigin);
  if (asset.origin !== assetOrigin || !['http:', 'https:'].includes(asset.protocol)
    || asset.username || asset.password || url.username || url.password
    || !['http:', 'https:'].includes(internal.protocol) || internal.username || internal.password
    || !isPublicAssetRequest(new Request(url, { method }), assetOrigin)) {
    throw new Error('asset request refused');
  }
  // Node fetch owns/ignores Host. A fixed Host through node:http selects the
  // identical asset boundary both directly in the app and through a cohost proxy.
  // No browser headers, credentials, redirects or environment proxy are used.
  const response = await new Promise<Response>((resolve, reject) => {
    const request = (internal.protocol === 'https:' ? httpsRequest : httpRequest)(internal.origin + url.pathname + url.search, {
      method, signal, headers: { host: asset.host, 'accept-encoding': 'identity' },
    }, incoming => {
      const headers = new Headers();
      for (const [key,value] of Object.entries(incoming.headers)) if(value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const status = incoming.statusCode ?? 502;
      const noBody = method === 'HEAD' || [204,205,304].includes(status);
      if(noBody) { incoming.resume();resolve(new Response(null,{status,headers}));return; }
      const encoding = headers.get('content-encoding');
      const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null;
      if (encoding && encoding !== 'identity' && !decoder) { incoming.destroy();reject(new Error('asset encoding refused'));return; }
      const source = decoder ? incoming.pipe(decoder) : incoming;
      if (decoder) { incoming.on('error', error => decoder.destroy(error)); decoder.on('close', () => incoming.destroy()); }
      resolve(new Response(Readable.toWeb(source) as ReadableStream<Uint8Array>, {status,headers}));
    });
    request.on('error', reject);request.end();
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (response.status >= 300 && response.status < 400) throw new Error('asset redirect refused');
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) throw new Error('asset too large');
    reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('asset too large');
      chunks.push(value);
    }
    const headers = new Headers(response.headers);
    // Decompress even when an upstream ignores accept-encoding.
    // Fulfill receives decoded bytes, so wire length/encoding must not survive.
    for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) headers.delete(name);
    const body = method === 'HEAD' || [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks, size);
    return publicAssetResponse(new Response(body, { status: response.status, headers }));
  } finally {
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    else await response.body?.cancel().catch(() => {});
  }
}

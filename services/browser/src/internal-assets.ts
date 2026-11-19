import { isPublicAssetRequest, publicAssetResponse } from '@artifactbin/utils';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

/**
 * THE ASSET ORIGIN FOR AN EXPORT RENDER. A page loads through its internal render URL; its requests to the public
 * `assetOrigin` keep that URL in Chromium, but only public byte GET and HEAD routes `isPublicAssetRequest` admits are
 * fetched, here, from the render URL's internal origin, with a fixed `Host` that selects the app's public-byte
 * middleware (public-ref ACLs included). So the browser container can sit on an internal-only network: no public
 * DNS, no TLS to the asset host. Responses keep public serving's CORS, nosniff and sandbox policy with cookie and
 * redirect metadata removed, are bounded (below, and 15 s or the shorter render timeout) and abort when the render
 * closes. Context-wide interception and blocked service workers keep workers and popups from routing around it.
 */
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
  return publicAssetResponse(await fetchInternal(url, method, asset.host, internal, signal));
}

/**
 * A page's own request, for an inspection with `internalOrigin` (contracts PageInspectRequest): a GET or HEAD to
 * `target` fetched from the internal origin with the target's own Host and the PAGE's origin as `Origin` (so the app
 * answers it as that page's request: a draft's on the app host may load only the public files, server/pages-host), no
 * other browser header or credential, no redirect, bounded like an asset; any cookie the app sets is dropped.
 */
export async function internalPageResponse(target: string, method: string, internalOrigin: string, pageOrigin: string, signal: AbortSignal): Promise<Response> {
  const url = new URL(target), internal = new URL(internalOrigin), page = new URL(pageOrigin);
  if (!['GET', 'HEAD'].includes(method) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || !['http:', 'https:'].includes(internal.protocol) || internal.username || internal.password
    || page.origin !== pageOrigin || !['http:', 'https:'].includes(page.protocol)) throw new Error('page request refused');
  const response = await fetchInternal(url, method, url.host, internal, signal, { origin: pageOrigin });
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  return new Response(response.body, { status: response.status, headers });
}

/** GET or HEAD `url`'s path from `internal` with a fixed `Host`; decoded, bounded, never redirected. */
async function fetchInternal(url: URL, method: string, host: string, internal: URL, signal: AbortSignal, extra: { origin?: string } = {}): Promise<Response> {
  // Node fetch owns/ignores Host. A fixed Host through node:http selects the
  // identical asset boundary both directly in the app and through a cohost proxy.
  // No browser headers, credentials, redirects or environment proxy are used.
  const response = await new Promise<Response>((resolve, reject) => {
    const request = (internal.protocol === 'https:' ? httpsRequest : httpRequest)(internal.origin + url.pathname + url.search, {
      method, signal, headers: { host, 'accept-encoding': 'identity', ...extra },
    }, incoming => {
      const headers = new Headers();
      for (const [key,value] of Object.entries(incoming.headers)) if(value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const status = incoming.statusCode ?? 502;
      const noBody = method === 'HEAD' || [204,205,304].includes(status);
      if(noBody) { incoming.resume();resolve(new Response(null,{status,headers}));return; }
      const encoding = headers.get('content-encoding');
      const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null;
      if (encoding && encoding !== 'identity' && !decoder) { incoming.destroy();reject(new Error('encoding refused'));return; }
      const source = decoder ? incoming.pipe(decoder) : incoming;
      if (decoder) { incoming.on('error', error => decoder.destroy(error)); decoder.on('close', () => incoming.destroy()); }
      resolve(new Response(Readable.toWeb(source) as ReadableStream<Uint8Array>, {status,headers}));
    });
    request.on('error', reject);request.end();
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (response.status >= 300 && response.status < 400) throw new Error('redirect refused');
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) throw new Error('response too large');
    reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('response too large');
      chunks.push(value);
    }
    const headers = new Headers(response.headers);
    // Decompress even when an upstream ignores accept-encoding.
    // Fulfill receives decoded bytes, so wire length/encoding must not survive.
    for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) headers.delete(name);
    const body = method === 'HEAD' || [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks, size);
    return new Response(body, { status: response.status, headers });
  } finally {
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    else await response.body?.cancel().catch(() => {});
  }
}

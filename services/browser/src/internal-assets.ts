import { isPublicAssetRequest, publicAssetResponse } from '@artifactbin/utils';

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
  const response = await fetch(internal.origin + url.pathname + url.search, {
    method, redirect: 'manual', credentials: 'omit', signal,
    // Fixed deployment forwarding fields select the app's public-asset middleware,
    // including /assets/ref visibility checks. Node fetch owns Host; never copy
    // browser Cookie, Origin, auth, Host or forwarding headers. The TCP destination
    // remains the internal render origin, with no DNS lookup of the public host.
    headers: { 'x-forwarded-host': asset.host, 'x-forwarded-proto': asset.protocol.slice(0, -1), 'accept-encoding': 'identity' },
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
    // Node fetch decompresses even when an upstream ignores accept-encoding.
    // Fulfill receives decoded bytes, so wire length/encoding must not survive.
    for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) headers.delete(name);
    const body = method === 'HEAD' || [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks, size);
    return publicAssetResponse(new Response(body, { status: response.status, headers }));
  } finally {
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    else await response.body?.cancel().catch(() => {});
  }
}

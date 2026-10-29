/**
 * THE ONE BOUNDED BODY READER. Every request body this codebase reads in memory is read here, counting BYTES
 * while it streams, so a caller that sends (or lies about) a huge body is cut off at the cap instead of being
 * buffered whole. Web `Request`s use `readBody`; Node `IncomingMessage` servers use `collectNodeBody`.
 */

/** Thrown by `readBody` once a body passes its cap. */
export class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super('payload_too_large');
    this.name = 'BodyTooLargeError';
  }
}

type BodyHolder = { headers: Headers; body: ReadableStream<Uint8Array> | null };

// Cancels are not awaited: on a tee()'d body (Request.clone) cancel() settles only when BOTH branches are cancelled.

/** The whole body as bytes, or as UTF-8 text; throws `BodyTooLargeError` past `limit` bytes. */
export async function readBody(request: BodyHolder, options: { limit: number; as: 'text' }): Promise<string>;
export async function readBody(request: BodyHolder, options: { limit: number; as?: 'bytes' }): Promise<Uint8Array<ArrayBuffer>>;
export async function readBody(request: BodyHolder, { limit, as = 'bytes' }: { limit: number; as?: 'bytes' | 'text' }): Promise<Uint8Array<ArrayBuffer> | string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    void request.body?.cancel().catch(() => {});
    throw new BodyTooLargeError(limit);
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { void reader.cancel().catch(() => {}); throw new BodyTooLargeError(limit); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return as === 'text' ? new TextDecoder().decode(bytes) : bytes;
}

/** A Node request's body, or null once it passes `max` bytes. The caller answers 413 and then destroys the request. */
export async function collectNodeBody(req: AsyncIterable<Buffer>, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

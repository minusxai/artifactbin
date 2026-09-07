/** Allowlisted file uploads: bounded bytes, content-addressed storage, inert streaming downloads. */
import { Readable } from 'node:stream';
import { MAX_FILE_BYTES } from '@/lib/config';
import { json } from '@/lib/http';
import { objectKey, objectStore, ObjectUnavailable } from '@/lib/object-store';
import type { StoredContent } from './input';
import { fileContentType, FILE_EXTENSIONS } from './file-types';

export interface FileMeta {
  objectKey: string;
  bytes: number;
  contentType: string;
  filename: string;
}

/** JSON/MCP transport; raw-body uploads avoid base64 overhead for larger files. */
export async function publishFile(input: unknown): Promise<StoredContent | Response> {
  const file = input as { filename?: unknown; contentType?: unknown; base64?: unknown } | null;
  if (!file || typeof file.filename !== 'string' || typeof file.contentType !== 'string' || typeof file.base64 !== 'string') {
    return json({ error: 'invalid_file', details: ['file must be {filename, contentType, base64}'] }, 400);
  }
  if (file.base64.length > 4 * Math.ceil(MAX_FILE_BYTES / 3)) return json({ error: 'file_too_large', maxBytes: MAX_FILE_BYTES }, 413);
  if (file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) {
    return json({ error: 'invalid_file', details: ['base64 must contain valid, padded base64 bytes'] }, 400);
  }
  return storeFileContent(Buffer.from(file.base64, 'base64'), file.contentType, file.filename);
}

export async function readFileUpload(request: Request): Promise<Buffer | Response> {
  const tooLarge = () => json({ error: 'file_too_large', maxBytes: MAX_FILE_BYTES }, 413);
  if (Number(request.headers.get('content-length')) > MAX_FILE_BYTES) return tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) { await reader.cancel(); return tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function storeFileContent(bytes: Buffer, contentType: string, filename: string): Promise<StoredContent | Response> {
  if (bytes.length > MAX_FILE_BYTES) return json({ error: 'file_too_large', maxBytes: MAX_FILE_BYTES }, 413);
  if (!filename || filename.length > 255 || !filename.isWellFormed() || /[\x00-\x1f\x7f/\\]/.test(filename)) {
    return json({ error: 'invalid_filename', details: ['Provide a filename of 1–255 characters without paths or control characters.'] }, 400);
  }
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(contentType)) {
    return json({ error: 'invalid_content_type' }, 400);
  }
  const canonicalType = fileContentType(filename);
  if (!canonicalType) return json({ error: 'unsupported_file_type', allowed: FILE_EXTENSIONS }, 400);
  // The final extension controls the served type, including clients that send
  // application/octet-stream. This is extension validation, not byte sniffing.
  contentType = canonicalType;
  const key = objectKey('file', bytes);
  await objectStore().put(key, bytes, contentType);
  const meta: FileMeta = { objectKey: key, bytes: bytes.length, contentType, filename };
  return { format: 'file', content: '', source: null, meta: { ...meta }, derivedTitle: filename };
}

/** Serves stored file/image/PDF objects without ever interpreting their content. ACL belongs to the caller. */
export async function serveStoredFile(request: Request, row: { id: string; meta: unknown }): Promise<Response> {
  const meta = row.meta as Partial<FileMeta>;
  const common: Record<string, string> = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer',
  };
  if (typeof meta?.objectKey !== 'string' || typeof meta.bytes !== 'number') {
    return new Response('not found', { status: 404, headers: common });
  }
  const filename = typeof meta.filename === 'string' ? meta.filename : row.id;
  const ascii = filename.replace(/[^a-zA-Z0-9._ -]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const headers = {
    ...common, 'Content-Type': meta.contentType ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
  };
  if (request.method === 'HEAD') return new Response(null, { headers });
  try {
    const stream = await objectStore().getStream(meta.objectKey);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers });
  } catch (error) {
    if (error instanceof ObjectUnavailable) return new Response('asset unavailable', { status: 503, headers: common });
    throw error;
  }
}

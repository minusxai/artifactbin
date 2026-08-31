/**
 * Where image BYTES actually live — the exact shape of lib/story/dataset-store.
 *
 * They used to sit in `artifacts.content` as a base64 `data:` URL. That is
 * ~33% larger than the bytes, lives in a TEXT column read on every render, and
 * is capped by the JSON-body limit. So the bytes go to the object store and the
 * row keeps a reference (`meta.objectKey`); `content` stays empty. Both
 * directions live here so no caller has to know where an image's bytes are.
 */
import { objectKey, objectStore } from '@/lib/object-store';

/** The image content types the tier accepts. */
export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'] as const;

/** Where an image's bytes are, plus what to stamp into `meta`. */
export interface ImageLocation {
  objectKey: string;
  bytes: number;
}

/**
 * Persist image bytes. Content-addressed, so re-uploading the same screenshot
 * costs one object rather than one per artifact.
 */
export async function storeImage(buffer: Buffer, contentType: string): Promise<ImageLocation> {
  const key = objectKey('image', buffer);
  await objectStore().put(key, buffer, contentType);
  return { objectKey: key, bytes: buffer.length };
}

/** The bytes and their type, ready to serve. */
export interface StoredImage {
  body: Buffer;
  contentType: string;
}

/**
 * Read image bytes back from wherever they are. Returns null (→ 404) rather
 * than throwing when the object is gone: a missing image is a not-found, not a
 * server error.
 */
export async function loadImage(row: { content?: string; meta: unknown }): Promise<StoredImage | null> {
  const meta = row.meta as { objectKey?: unknown; contentType?: unknown } | null;
  if (typeof meta?.objectKey !== 'string' || !meta.objectKey) {
    // Legacy: image rows written before the object store kept the bytes inline
    // as a base64 data: URL in `content`. Serve those rather than 404 — a
    // broken image is far more visible than an empty chart, and re-publishing
    // every old row is not a precondition for deploying this.
    const m = /^data:([^;]+);base64,(.*)$/.exec(row.content ?? '');
    return m ? { body: Buffer.from(m[2], 'base64'), contentType: m[1] } : null;
  }
const body = await objectStore().get(meta.objectKey);
  return {
    body,
    contentType: typeof meta.contentType === 'string' ? meta.contentType : 'application/octet-stream',
  };

}

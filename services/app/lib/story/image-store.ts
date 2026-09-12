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
import { VARIANT_CONTENT_TYPE } from '@/lib/images/optimise';

/** The image content types the tier accepts. */
export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'] as const;

/** Where an image's bytes are, plus what to stamp into `meta`. */
export interface ImageLocation {
  objectKey: string;
  bytes: number;
}

/**
 * What a stored image row keeps in `meta` — the shape lib/story/data-tiers
 * writes and every reader of one relies on.
 *
 * `sha256` is the hash of the bytes THE CLIENT SENT, taken before the door
 * re-encoded them. Publication preflight matches a local file against it, and
 * it is deliberately NOT `objectKey`'s digest: the stored object is webp and
 * the upload usually is not, so those are hashes of two different byte strings
 * and only one of them is a fact about the file on someone's disk. Optional on
 * the type because rows written before the field existed do not carry it; every
 * row written from here on does.
 */
export interface ImageMeta {
  objectKey: string;
  bytes: number;
  contentType: string;
  sha256?: string;
  smallObjectKey?: string;
  smallWidth?: number;
  width?: number;
  height?: number;
  placeholder?: string;
}

/**
 * Persist image bytes. Content-addressed, so re-uploading the same screenshot
 * costs one object rather than one per artifact.
 */
export async function storeImage(buffer: Buffer, contentType: string, store: Pick<import('@/lib/object-store').ObjectStore, 'put'> = objectStore()): Promise<ImageLocation> {
  const key = objectKey('image', buffer);
  await store.put(key, buffer, contentType);
  return { objectKey: key, bytes: buffer.length };
}

/** The bytes and their type, ready to serve. */
export interface StoredImage {
  body: Buffer;
  contentType: string;
}

/** Which stored copy of the image is wanted: the full one, or a width we stored. */
export interface LoadImageOptions {
  /**
   * The `w=` a `srcset` asked for. It NAMES A WIDTH WE STORED — never a resize
   * anyone may ask for — so the one value that selects the narrow copy is the
   * one publish made, and everything else is the full image. A width is a
   * preference, never a reason to fail a picture.
   */
  width?: string | number | null;
}

/**
 * Read image bytes back from wherever they are. Returns null (→ 404) rather
 * than throwing when the object is gone: a missing image is a not-found, not a
 * server error.
 */
export async function loadImage(row: { content?: string; meta: unknown }, opts: LoadImageOptions = {}): Promise<StoredImage | null> {
  const meta = row.meta as {
    objectKey?: unknown; contentType?: unknown; smallObjectKey?: unknown; smallWidth?: unknown;
  } | null;
  if (typeof meta?.smallObjectKey === 'string' && meta.smallObjectKey
    && opts.width !== null && opts.width !== undefined && Number(opts.width) === meta.smallWidth) {
    return { body: await objectStore().get(meta.smallObjectKey), contentType: VARIANT_CONTENT_TYPE };
  }
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

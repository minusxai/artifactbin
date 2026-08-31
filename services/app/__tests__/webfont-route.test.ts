/**
 * /webfonts/<sha>.woff2 — a PUBLIC asset route, so the only two honest
 * answers are the bytes or 404.
 *
 * The case that shipped broken: the local object store reports a missing file
 * as ObjectNotFound (ENOENT), so every test passed, while the deployed S3 user
 * has GetObject but not s3:ListBucket — which makes S3 answer a missing key
 * with 403 AccessDenied rather than 404 NoSuchKey, and the store rethrows it.
 * Production returned 500 for any well-formed unknown hash, which anyone can
 * request. A public asset route must never turn "I don't have that" into a
 * server error, whatever the backend calls it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ get: null as null | ((key: string) => Promise<Buffer>) }));
vi.mock('@/lib/object-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/object-store')>();
  return { ...actual, objectStore: () => ({ backend: 'local', put: vi.fn(), delete: vi.fn(), get: h.get! }) };
});

import { GET } from '@/app/webfonts/[file]/route';
import { ObjectUnavailable } from '@/lib/object-store';

import { request, useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();

const params = (file: string) => ({ params: Promise.resolve({ file }) });
const HASH = '0123456789abcdef0123456789abcdef';

beforeEach(async () => {
  h.get = async () => Buffer.from('wOF2xx');
  const db = await harness.db();
  await db.query('INSERT INTO webfonts (family, assets) VALUES ($1, $2::jsonb)', ['Test', JSON.stringify([{ family: 'Test', url: `/webfonts/${HASH}.woff2`, weight: 400 }])]);
});

describe('GET /webfonts/<file>', () => {
  it('serves the bytes, immutable and CORS-open', async () => {
    const res = await GET(request('/webfonts/x.woff2'), params(`${HASH}.woff2`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('font/woff2');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('404s a filename that is not the content-addressed shape, without touching the store', async () => {
    h.get = async () => { throw new Error('the store must not be reached'); };
    for (const bad of ['../etc/passwd', 'x.woff2', `${HASH}.ttf`, `${HASH.toUpperCase()}.woff2`, '']) {
      expect((await GET(request('/webfonts/x.woff2'), params(bad))).status, bad).toBe(404);
    }
  });

  it('404s when the backend reports the object missing', async () => {
    h.get = async () => { throw new ObjectUnavailable('webfont/x'); };
    expect((await GET(request('/webfonts/x.woff2'), params(`${HASH}.woff2`))).status).toBe(404);
  });

  it('404s when the backend fails in ITS OWN vocabulary — S3, not the local store', async () => {
    // AccessDenied is what production actually raises for an absent key, since
    // the IAM user cannot list the bucket; the other two are what S3 answers
    // once it can. All three mean "no such font" to a reader.
    for (const err of [
      Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }),
      Object.assign(new Error('Access Denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
      Object.assign(new Error('Not Found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }),
    ]) {
      h.get = async () => { throw err; };
      const res = await GET(request('/webfonts/x.woff2'), params(`${HASH}.woff2`));
      expect(res.status, err.name).toBe(404);
    }
  });
});

/**
 * THE DB IS THE ONLY INDEX. `/webfonts/<file>` is the one read whose key comes
 * from the CALLER, so it must answer 404 from the `webfonts` table BEFORE the
 * object store is asked — a well-formed hash nobody resolved never reaches S3.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();


describe('GET /webfonts/<file>', () => {
  afterEach(async () => { vi.restoreAllMocks(); });

  it('404s an unknown hash without touching the store', async () => {
    const store = await import('@/lib/object-store');
    const get = vi.fn(async () => Buffer.from('woff2'));
    vi.spyOn(store, 'objectStore').mockReturnValue({ backend: 'local', get, put: async () => {}, delete: async () => {}, getStream: async () => { throw new Error('this route reads whole objects'); } });
    const { GET } = await import('@/app/webfonts/[file]/route');
    const res = await GET(new Request('http://localhost:3000/webfonts/' + 'a'.repeat(32) + '.woff2'), { params: Promise.resolve({ file: 'a'.repeat(32) + '.woff2' }) });
    expect(res.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it('serves a hash the table knows, from the store', async () => {
    const db = await harness.db();
    const file = 'b'.repeat(32) + '.woff2';
    await db.query('INSERT INTO webfonts (family, assets) VALUES ($1, $2)', ['Lobster', JSON.stringify([{ family: 'Lobster', url: `/webfonts/${file}`, weight: 400 }])]);
    const store = await import('@/lib/object-store');
    const get = vi.fn(async () => Buffer.from('woff2-bytes'));
    vi.spyOn(store, 'objectStore').mockReturnValue({ backend: 'local', get, put: async () => {}, delete: async () => {}, getStream: async () => { throw new Error('this route reads whole objects'); } });
    const { GET } = await import('@/app/webfonts/[file]/route');
    const res = await GET(new Request('http://localhost:3000/webfonts/' + file), { params: Promise.resolve({ file }) });
    expect(res.status).toBe(200);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

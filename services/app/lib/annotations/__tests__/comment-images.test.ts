import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { ANONYMOUS_ACTOR, identityForUser } from '@/lib/accounts';
import { objectStore } from '@/lib/object-store';
import { getDb } from '@/lib/platform';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { commentImageResponse, createAnnotationFor, expireCommentImagesFor, readCommentImage, stageCommentImage, sweepCommentImages } from '..';

useAppHarness();
const human = { kind: 'human' as const, label: 'Reviewer', transport: 'browser' as const };
async function fixture(visibility = 'private') {
  const token = await mintAccountToken('comment-image-owner');
  const made = await createRoute(request('/api/artifacts', { method: 'POST', token: token.token, json: { html: '<!doctype html><html><head></head><body><p data-af-id="intro">Capture</p></body></html>', visibility } }));
  const doc = await made.json() as { id: string; edit_id: string };
  const image = await sharp({ create: { width: 100, height: 50, channels: 3, background: 'red' } }).png().toBuffer();
  const metadata = { v: 1, capturedEditId: doc.edit_id, capturedAt: new Date().toISOString(), method: 'region', width: 100, height: 50, rect: { x: 0, y: 0, width: 100, height: 50 }, viewport: { width: 1000, height: 800 }, strokes: [] };
  return { token, doc, image, metadata, actor: identityForUser(token.userId!, token.id) as ReturnType<typeof identityForUser> & { tokenId: string } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const stage = (f: Fixture, metadata: unknown = f.metadata, bytes = f.image) => stageCommentImage(f.actor, f.doc.id, bytes, bytes, metadata);
const attach = async (f: Fixture, id: string) => createAnnotationFor(f.actor, f.doc.id, { anchor: { kind: 'html-node', v: 1, nodeId: 'intro', revision: '1', quote: '' }, body: 'See image', attachmentId: id, baseEditId: f.doc.edit_id }, human);
const rows = async () => (await (await getDb()).query<{ id: string; annotation_id: string | null; ready: boolean; expired: boolean }>('SELECT id, annotation_id, ready, expires_at <= now() AS expired FROM comment_images ORDER BY id')).rows;

describe('stageCommentImage', () => {
  it('stages three webp variants privately, unattached until a comment consumes it', async () => {
    const f = await fixture();
    const staged = await stage(f) as { id: string };
    expect(staged.id).toMatch(/^cim_[a-z0-9]+$/);
    expect(await rows()).toEqual([{ id: staged.id, annotation_id: null, ready: true, expired: false }]);
    for (const variant of ['original', 'preview', 'thumbnail']) expect((await sharp(await objectStore().get(`comment-images/${staged.id}/${variant}.webp`)).metadata()).format).toBe('webp');
    expect(await readCommentImage(f.actor, f.doc.id, staged.id, 'original')).toBeNull();
  });

  it('refuses a stranger, bad metadata, a moved head, mismatched or undecodable bytes', async () => {
    const f = await fixture();
    const other = await mintAccountToken('comment-image-stranger');
    expect((await stageCommentImage(identityForUser(other.userId!, other.id) as never, f.doc.id, f.image, f.image, f.metadata) as Response).status).toBe(404);
    for (const metadata of [null, { ...f.metadata, v: 2 }, { ...f.metadata, method: 'paste' }, { ...f.metadata, width: 0 }, { ...f.metadata, rect: { x: 950, y: 0, width: 100, height: 50 } }, { ...f.metadata, strokes: [{ color: 'red', width: 2, points: [[1, 1]] }] }, { ...f.metadata, capturedAt: 'later' }])
      expect((await stage(f, metadata) as Response).status).toBe(400);
    const stale = await stage(f, { ...f.metadata, capturedEditId: 'old-edit' }) as Response;
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'stale', edit_id: f.doc.edit_id });
    expect((await stage(f, { ...f.metadata, width: 99 }) as Response).status).toBe(400);
    expect((await stage(f, f.metadata, Buffer.from('not an image')) as Response).status).toBe(400);
    expect(await rows()).toEqual([]);
  });
});

describe('readCommentImage and commentImageResponse', () => {
  it('serve an attached image privately to readers of the document, per variant', async () => {
    const f = await fixture();
    const staged = await stage(f) as { id: string };
    expect(await attach(f, staged.id)).toMatchObject({ image: { id: staged.id } });
    const read = await readCommentImage(f.actor, f.doc.id, staged.id, 'thumbnail');
    expect((await sharp(read!.buffer).metadata()).format).toBe('webp');
    const response = await commentImageResponse(f.actor, f.doc.id, staged.id, 'preview');
    expect(response.status).toBe(200);
    expect(Object.fromEntries(['content-type', 'cache-control', 'x-content-type-options'].map(name => [name, response.headers.get(name)]))).toEqual({ 'content-type': 'image/webp', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
  });

  it('answer 404 for an unknown variant, another document, a reader without access or a deleted comment', async () => {
    const f = await fixture();
    const staged = await stage(f) as { id: string };
    const thread = await attach(f, staged.id) as { id: string };
    for (const variant of ['huge', '../original', '']) expect((await commentImageResponse(f.actor, f.doc.id, staged.id, variant)).status).toBe(404);
    expect(await readCommentImage(ANONYMOUS_ACTOR, f.doc.id, staged.id, 'original')).toBeNull();
    expect(await readCommentImage(f.actor, 'other-doc', staged.id, 'original')).toBeNull();
    await (await getDb()).query('UPDATE annotations SET deleted_at = now() WHERE id = $1', [thread.id]);
    expect((await commentImageResponse(f.actor, f.doc.id, staged.id, 'original')).status).toBe(404);
  });

  it('let anyone who can read a public document see its comment images', async () => {
    const f = await fixture('public');
    const staged = await stage(f) as { id: string };
    await attach(f, staged.id);
    expect(await readCommentImage(ANONYMOUS_ACTOR, f.doc.id, staged.id, 'original')).not.toBeNull();
  });
});

describe('expireCommentImagesFor and sweepCommentImages', () => {
  it('expire every image of an erased user or their documents, detaching it, and the sweep removes rows and objects', async () => {
    const f = await fixture();
    const attached = await stage(f) as { id: string };
    await attach(f, attached.id);
    const loose = await stage(f) as { id: string };
    await (await getDb()).transaction(tx => expireCommentImagesFor(tx, f.actor.userId!, [f.doc.id]));
    expect((await rows()).map(row => [row.annotation_id, row.ready, row.expired])).toEqual([[null, false, true], [null, false, true]]);
    expect(await readCommentImage(f.actor, f.doc.id, attached.id, 'original')).toBeNull();
    await sweepCommentImages();
    expect(await rows()).toEqual([]);
    await expect(objectStore().get(`comment-images/${loose.id}/original.webp`)).rejects.toThrow();
  });

  it('leaves live stages and attached images alone, and touches nothing of other users', async () => {
    const f = await fixture();
    const staged = await stage(f) as { id: string };
    await (await getDb()).transaction(tx => expireCommentImagesFor(tx, 'usr_someone_else', ['another-doc']));
    await sweepCommentImages();
    expect(await rows()).toEqual([{ id: staged.id, annotation_id: null, ready: true, expired: false }]);
  });
});

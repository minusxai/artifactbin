/**
 * A REFERENCED FILE ON THE PUBLIC ASSETS HOST: identity-addressed, so every request asks again whether a GUEST may read
 * it — a login, a token or a carried grant never widens it — and a typed door (image, font, pdf, script) refuses bytes
 * of another type. The refusal is one shape: 404, open to any origin, never stored.
 */
import { describe, expect, it } from 'vitest';
import { setSession, useAppHarness } from '@/__tests__/harness';
import { createArtifact } from '@/lib/artifacts';
import { createUser } from '@/lib/accounts';
import { storeFileContent } from '@/lib/datasets/file-store';
import { getDb } from '@/lib/platform';
import { publicRefAsset, publicRefAssetResponse } from '@/lib/document-serving';

useAppHarness();

/** The served type follows the file's extension (lib/datasets/file-store), so the extension names it here. */
async function stored(owner: string, extension: string, visibility: 'public' | 'unlisted' | 'private', format: 'file' | 'image' | 'pdf' = 'file', bytes = Buffer.from([1, 2, 3])) {
  const content = await storeFileContent(bytes, 'application/octet-stream', `thing.${extension}`);
  if (content instanceof Response) throw new Error(await content.text());
  return createArtifact(null, owner, { ...content, format, title: 'thing', description: null, visibility });
}
const owner = async () => (await createUser({ email: 'mxmx_test_refs@example.com' })).id;
const REFUSED = { status: 404, 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
const refusal = (response: Response) => ({ status: response.status, 'access-control-allow-origin': response.headers.get('access-control-allow-origin'), 'cache-control': response.headers.get('cache-control') });

describe('publicRefAsset', () => {
  it('admits a public or unlisted stored file, and never a private one, even to its signed-in owner', async () => {
    const me = await owner();
    const [pub, unlisted, secret] = await Promise.all([stored(me, 'glb', 'public'), stored(me, 'glb', 'unlisted'), stored(me, 'glb', 'private')]);
    expect((await publicRefAsset(pub.id))?.id).toBe(pub.id);
    expect((await publicRefAsset(unlisted.id))?.id).toBe(unlisted.id);
    setSession({ user: { id: me } });
    expect(await publicRefAsset(secret.id)).toBeNull();
  });

  it('is nothing for a malformed or unknown id, or a row that is not stored bytes', async () => {
    const me = await owner();
    const page = await createArtifact(null, me, { format: 'html', title: 'p', description: null, source: '<p>x</p>', meta: {}, visibility: 'public' });
    for (const id of ['nope!', '', 'Zz99Zz99', page.id]) expect(await publicRefAsset(id), id).toBeNull();
  });

  it('serves a typed door only bytes of that type', async () => {
    const me = await owner();
    const [png, font, pdf, js, other] = await Promise.all([
      stored(me, 'png', 'public', 'image'), stored(me, 'woff2', 'public'), stored(me, 'pdf', 'public', 'pdf'),
      stored(me, 'js', 'public'), stored(me, 'glb', 'public'),
    ]);
    const admits = { image: [png], font: [font], pdf: [pdf], script: [js] } as const;
    for (const [kind, rows] of Object.entries(admits)) {
      for (const row of [png, font, pdf, js, other]) {
        const expected = (rows as readonly { id: string }[]).some((r) => r.id === row.id);
        expect(!!(await publicRefAsset(row.id, kind as keyof typeof admits)), `${kind} ${row.id}`).toBe(expected);
      }
    }
    for (const row of [png, font, pdf, js, other]) expect((await publicRefAsset(row.id, 'binary'))?.id).toBe(row.id);
  });

  it('re-asks on every request: a file made private or trashed stops being served at once', async () => {
    const me = await owner();
    const row = await stored(me, 'png', 'public', 'image');
    expect(await publicRefAsset(row.id)).not.toBeNull();
    const db = await getDb();
    await db.query("UPDATE artifacts SET visibility = 'private' WHERE id = $1", [row.id]);
    expect(await publicRefAsset(row.id)).toBeNull();
    await db.query("UPDATE artifacts SET visibility = 'public', deleted_at = now() WHERE id = $1", [row.id]);
    expect(await publicRefAsset(row.id)).toBeNull();
  });
});

describe('publicRefAssetResponse', () => {
  it('serves the bytes, never stored by a cache, open to any origin, as a download', async () => {
    const me = await owner();
    const row = await stored(me, 'glb', 'public', 'file', Buffer.from([7, 8, 9]));
    const response = await publicRefAssetResponse(new Request(`https://assets.example.test/assets/ref/${row.id}`, { headers: { cookie: 'session=secret', authorization: 'Bearer ignored' } }), row.id);
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([7, 8, 9]);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'cache-control': 'no-store', 'access-control-allow-origin': '*', 'content-type': expect.stringMatching(/^model\/gltf-binary/), 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; /);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a private, unknown or malformed id with the same 404', async () => {
    const me = await owner();
    const secret = await stored(me, 'png', 'private', 'image');
    for (const id of [secret.id, 'Zz99Zz99', 'nope!']) {
      const response = await publicRefAssetResponse(new Request(`https://assets.example.test/assets/ref/${id}`), id);
      expect(refusal(response), id).toEqual(REFUSED);
      expect(await response.text()).toBe('not found');
    }
  });
});

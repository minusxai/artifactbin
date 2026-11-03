/**
 * meta.webAssets (lib/artifacts web-assets): derived from the stored source at create and publish, so a replace and
 * a revert serve exactly the images of the version they store; the owner host's answer (lib/user-pages
 * servesWebAsset) reads only it, never the page source.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { createUser, identityForUser, type AccessActor } from '@/lib/accounts';
import { createArtifact, replaceArtifactFor, revertArtifactFor, type ArtifactRow } from '@/lib/artifacts';
import { urlHash } from '@/lib/document';
import { htmlAssetLinks } from '@/lib/html-page';
import { getDb } from '@/lib/platform';
import { servesWebAsset, type UserPagesOwner } from '@/lib/user-pages';
import { webAssetHashes, withWebAssets } from '../web-assets';

useAppHarness();

const A = 'https://images.example.test/a.png', B = 'https://images.example.test/b.png';
const page = (body: string) => ({ format: 'html' as const, source: nativeHtml(body), meta: {}, title: 'Assets', visibility: 'public' as const });

async function owner(): Promise<{ actor: AccessActor; host: UserPagesOwner }> {
  const user = await createUser({ email: 'web-assets-owner@example.test' });
  const db = await getDb();
  for (const url of [A, B]) await db.query('INSERT INTO web_assets (url_hash, url, object_key, content_type, bytes) VALUES ($1, $2, $3, $4, 1)', [urlHash(url), url, `webasset/${urlHash(url)}`, 'image/png']);
  return { actor: identityForUser(user.id, null), host: { kind: 'user', id: user.id, handle: 'web_assets_owner' } };
}
const served = async (host: UserPagesOwner) => ({ a: await servesWebAsset(host, urlHash(A)), b: await servesWebAsset(host, urlHash(B)) });

describe('meta.webAssets', () => {
  it("is exactly the owner host's former match: the hashed image URLs of htmlAssetLinks, nothing wider", () => {
    const source = nativeHtml(`<img src="${A}"><picture><source src="https://images.example.test/c.webp"></picture>
      <video poster="https://images.example.test/d.jpg"></video><a href="https://images.example.test/e.png">link</a>
      <link rel="stylesheet" href="https://fonts.example.test/f.css"><img src="ref:Image1"><img src="${A}">`);
    expect(webAssetHashes(source)).toEqual([...new Set(htmlAssetLinks(source).imageUrls.map(urlHash))].sort());
    expect(webAssetHashes(source)).toHaveLength(3);
    expect(webAssetHashes(null)).toEqual([]);
  });

  it('follows the stored source through create, replace and revert', async () => {
    const { actor, host } = await owner();
    const v1 = await createArtifact(null, actor.userId, page(`<img src="${A}">`));
    expect(v1.meta.webAssets).toEqual([urlHash(A)]);
    expect(await served(host)).toEqual({ a: true, b: false });

    const v2 = await replaceArtifactFor(actor, v1.id, page(`<img src="${B}">`), { expectedVersion: v1.version }) as ArtifactRow;
    expect(v2.meta.webAssets).toEqual([urlHash(B)]);
    expect(await served(host)).toEqual({ a: false, b: true });

    const reverted = await revertArtifactFor(actor, v1.id, v1.version) as ArtifactRow;
    expect(reverted.meta.webAssets).toEqual([urlHash(A)]);
    expect(await served(host)).toEqual({ a: true, b: false });

    await (await getDb()).query("UPDATE artifacts SET visibility = 'private' WHERE id = $1", [v1.id]);
    expect(await served(host)).toEqual({ a: false, b: false });
  });

  it('is not carried by a non-HTML document, whatever its caller-supplied meta says', () => {
    expect(withWebAssets('markup', `![a](${A})`, { theme: 'x', webAssets: [urlHash(A)] })).toEqual({ theme: 'x' });
    expect(withWebAssets('html', `<img src="${B}">`, { webAssets: [urlHash(A)] })).toEqual({ webAssets: [urlHash(B)] });
  });
});

describe('a page without meta.webAssets', () => {
  it('serves no web image, whatever its source names: a missing stored set is a plain not-found', async () => {
    const { host } = await owner();
    await (await getDb()).query(`INSERT INTO artifacts (id, user_id, creator_user_id, format, visibility, source, meta, edit_id)
      VALUES ('Legacy01', $1, $1, 'html', 'public', $2, '{"htmlIdentity":{}}'::jsonb, 'edit_Legacy01')`, [host.id, nativeHtml(`<img src="${A}">`)]);
    expect(await served(host)).toEqual({ a: false, b: false });
  });
});

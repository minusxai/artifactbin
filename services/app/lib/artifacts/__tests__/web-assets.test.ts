/**
 * meta.webAssets (lib/artifacts web-assets): derived from the stored source at create and publish, so a replace and
 * a revert serve exactly the images of the version they store; the owner host's answer (lib/user-pages
 * servesWebAsset) reads it, and still matches a page written before the key by its source until the backfill
 * (backfillWebAssets) fills it.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { createUser, identityForUser, type AccessActor } from '@/lib/accounts';
import { createArtifact, getArtifactById, replaceArtifactFor, revertArtifactFor, type ArtifactRow } from '@/lib/artifacts';
import { urlHash } from '@/lib/document';
import { htmlAssetLinks } from '@/lib/html-page';
import { getDb } from '@/lib/platform';
import { servesWebAsset, type UserPagesOwner } from '@/lib/user-pages';
import { backfillWebAssets, webAssetHashes, withWebAssets } from '../web-assets';

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

describe('a page written before meta.webAssets', () => {
  async function legacy(host: UserPagesOwner, id: string, body: string) {
    const db = await getDb();
    await db.query(`INSERT INTO artifacts (id, user_id, creator_user_id, format, visibility, source, meta, edit_id)
      VALUES ($1, $2, $2, 'html', 'public', $3, '{"htmlIdentity":{}}'::jsonb, $4)`, [id, host.id, nativeHtml(body), `edit_${id}`]);
  }

  it('is still served by its source, then by the key the backfill writes; a rerun writes nothing', async () => {
    const { host } = await owner();
    await legacy(host, 'Legacy01', `<img src="${A}">`);
    await legacy(host, 'Legacy02', '<p>no images</p>');
    expect(await served(host)).toEqual({ a: true, b: false });

    const lines: string[] = [];
    const dry = await backfillWebAssets(await getDb(), { apply: false, chunk: 1, onChunk: (line) => lines.push(line) });
    expect(dry).toEqual({ mode: 'dry-run', scanned: 2, written: 2, withAssets: 1, changed: [], remaining: 2 });
    expect((await getArtifactById('Legacy01'))!.meta).not.toHaveProperty('webAssets');

    const applied = await backfillWebAssets(await getDb(), { apply: true, chunk: 1, onChunk: (line) => lines.push(line) });
    expect(applied).toEqual({ mode: 'apply', scanned: 2, written: 2, withAssets: 1, changed: [], remaining: 0 });
    expect((await getArtifactById('Legacy01'))!.meta).toEqual({ htmlIdentity: {}, webAssets: [urlHash(A)] });
    expect((await getArtifactById('Legacy02'))!.meta).toEqual({ htmlIdentity: {}, webAssets: [] });
    expect(await served(host)).toEqual({ a: true, b: false });
    // Ids and counts only.
    expect(lines).toEqual([
      'chunk 1: Legacy01..Legacy01 scanned=1 planned=1 with_assets=1', 'chunk 2: Legacy02..Legacy02 scanned=1 planned=1 with_assets=0',
      'chunk 1: Legacy01..Legacy01 scanned=1 written=1 with_assets=1', 'chunk 2: Legacy02..Legacy02 scanned=1 written=1 with_assets=0',
    ]);

    expect(await backfillWebAssets(await getDb(), { apply: true })).toEqual({ mode: 'apply', scanned: 0, written: 0, withAssets: 0, changed: [], remaining: 0 });
  });

  it('leaves a page republished between the read and the write for the next run, and resumes after a limit', async () => {
    const { host } = await owner();
    await legacy(host, 'Legacy01', `<img src="${A}">`);
    await legacy(host, 'Legacy02', `<img src="${B}">`);
    const db = await getDb();
    // A writer without the key (an old replica during the rollout) bumps the version after the chunk was read.
    const racing = { query: async <T,>(text: string, params?: unknown[]) => {
      if (/^\s*UPDATE artifacts a SET meta/.test(text)) await db.query("UPDATE artifacts SET version = version + 1, source = $1 WHERE id = 'Legacy02'", [nativeHtml('<p>gone</p>')]);
      return db.query<T>(text, params);
    } };
    expect(await backfillWebAssets(racing, { apply: true, limit: 2 })).toEqual({ mode: 'apply', scanned: 2, written: 1, withAssets: 1, changed: ['Legacy02'], remaining: 1 });
    expect(await backfillWebAssets(db, { apply: true })).toEqual({ mode: 'apply', scanned: 1, written: 1, withAssets: 0, changed: [], remaining: 0 });
    expect((await getArtifactById('Legacy02'))!.meta.webAssets).toEqual([]);
    expect(await served(host)).toEqual({ a: true, b: false });
  });
});

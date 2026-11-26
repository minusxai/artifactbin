/**
 * A DOCUMENT'S IMAGES, as served (native-html-assets.server): an image in a rich-native-v1 region resolves like any
 * other `<img>` of the page (an admitted `ref:` to its versioned raw address, a cached external copy to `/assets/<hash>`),
 * and an external one nothing has cached yet goes through the page's first-view door, `/a/<id>/assets?u=`, never to
 * its own host from the reader's browser, as does an upload the text names that publish did not admit (written into the
 * live text since). An `<img>` outside the document's text keeps today's serving.
 */
import { expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { createUser } from '@/lib/accounts/testing';
import { urlHash } from '@/lib/document';
import { getDb } from '@/lib/platform';
import { nativeHtmlAssets } from '@/lib/document-serving/native-html-assets.server';
import { seedArtifacts } from '@/__tests__/rows';

useAppHarness();

const srcs = (html: string) => [...html.matchAll(/<img[^>]* src="([^"]+)"/g)].map(match => match[1]!.replaceAll('&amp;', '&'));

it('resolves uploads and cached copies, and sends uncached external images through the first-view door', async () => {
  const db = await getDb();
  const user = await createUser({ email: 'mxmx_test_region_images@example.com' });
  await seedArtifacts(db, { id: 'regimg001', user_id: user.id, format: 'image', title: 'Chart', meta: '{}', version: 3, visibility: 'public' });
  await db.query('INSERT INTO web_assets(url_hash,url,object_key,content_type,bytes) VALUES($1,$2,$3,$4,1)', [urlHash('https://cached.example/a.png'), 'https://cached.example/a.png', 'webasset/a', 'image/png']);
  const region = '<p data-af-id="p1"><img data-af-id="i1" src="ref:regimg001" alt="up"> <img data-af-id="i2" src="https://cached.example/a.png" alt="cached"> <img data-af-id="i3" src="https://fresh.example/b.png?x=1&amp;y=2" alt="fresh"></p>';
  const source = `<!doctype html><html><body><article data-af-id="doc" data-af-editable="rich-native-v1">${region}</article><img src="https://outside.example/c.png"></body></html>`;
  const row = { id: 'regpage01', version: 2, source, meta: { refs: [{ id: 'regimg001', kind: 'image' }] } };
  expect(srcs(await nativeHtmlAssets(row))).toEqual([
    '/a/regimg001/raw?v=3', `/assets/${urlHash('https://cached.example/a.png')}`,
    `/a/regpage01/assets?u=${encodeURIComponent('https://fresh.example/b.png?x=1&y=2')}`, 'https://outside.example/c.png',
  ]);
  // An export capture's key rides along, as on the page's other own-door addresses.
  expect(srcs(await nativeHtmlAssets(row, 'capture-key'))[2]).toBe(`/a/regpage01/assets?u=${encodeURIComponent('https://fresh.example/b.png?x=1&y=2')}&key=capture-key`);
});

it('an upload the document\'s text names that publish did not admit goes through the first-view door; one outside the text does not', async () => {
  const source = '<!doctype html><html><body><article data-af-id="doc" data-af-editable="rich-native-v1"><p data-af-id="p1"><img data-af-id="i1" src="ref:regimg002" alt="new"></p></article><img src="ref:regimg003"></body></html>';
  const row = { id: 'regpage02', version: 4, source, meta: { refs: [] } };
  expect(srcs(await nativeHtmlAssets(row))).toEqual([`/a/regpage02/assets?u=${encodeURIComponent('ref:regimg002')}`, 'ref:regimg003']);
});

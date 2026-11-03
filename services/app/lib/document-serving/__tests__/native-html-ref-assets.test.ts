/**
 * A PAGE'S `ref:` FILES, resolved for serving (native-html-assets.server): every admitted reference to a live image,
 * file or PDF becomes its versioned raw address, in ONE header read however many the page names — never a whole row
 * per reference. A reference the page was not admitted to, a trashed one and one that is not a file stay as written.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { createUser } from '@/lib/accounts';
import { getDb, measureQueries } from '@/lib/platform';
import { nativeHtmlAssets } from '@/lib/document-serving/native-html-assets.server';

useAppHarness();

const imageId = (i: number) => `refimg${String(i).padStart(3, '0')}`;
const IMAGES = 30;

async function seed() {
  const db = await getDb();
  const user = await createUser({ email: 'mxmx_test_ref_assets@example.com' });
  await db.query(
    `INSERT INTO artifacts (id, user_id, format, title, meta, version, visibility)
     SELECT 'refimg' || lpad(i::text, 3, '0'), $1, 'image', 'Image ' || i, '{}', i % 4 + 1, 'public' FROM generate_series(1, $2::int) i`,
    [user.id, IMAGES],
  );
  await db.query(`INSERT INTO artifacts (id, user_id, format, title, meta, version, visibility) VALUES
    ('refpdf001', $1, 'pdf', 'Paper', '{}', 7, 'public'),
    ('refgone01', $1, 'image', 'Trashed', '{}', 1, 'public'),
    ('refpage01', $1, 'html', 'A page', '{}', 1, 'public'),
    ('refloose1', $1, 'image', 'Not admitted', '{}', 1, 'public')`, [user.id]);
  await db.query("UPDATE artifacts SET deleted_at = now() WHERE id = 'refgone01'");
  const named = [...Array.from({ length: IMAGES }, (_, k) => imageId(k + 1)), 'refpdf001', 'refgone01', 'refpage01', 'refloose1'];
  const source = `<!doctype html><html><body>${named.map((id) => `<img src="ref:${id}">`).join('')}</body></html>`;
  const refs = named.filter((id) => id !== 'refloose1').map((id) => ({ id, kind: 'image' }));
  return { id: 'refhost01', version: 1, source, meta: { refs } };
}

const srcs = (html: string) => [...html.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]!.replaceAll('&amp;', '&'));

describe('a page that names thirty ref: images', () => {
  it('resolves every admitted live file reference in one statement, to its versioned raw address', async () => {
    const row = await seed();
    const { value, stats } = await measureQueries(() => nativeHtmlAssets(row));
    console.info('[budget] nativeHtmlAssets, %d ref: images: statements=%d', IMAGES, stats.count);
    expect(stats.count).toBe(1);
    const served = srcs(value);
    expect(served).toHaveLength(IMAGES + 4);
    for (let i = 1; i <= IMAGES; i++) expect(served[i - 1]).toMatch(new RegExp(`^/a/${imageId(i)}/raw\\?v=${i % 4 + 1}(&|$)`));
    expect(served[IMAGES]).toMatch(/^\/a\/refpdf001\/raw\?v=7(&|$)/);
    // Trashed, not a file, not admitted: left exactly as the author wrote them.
    expect(served.slice(IMAGES + 1)).toEqual(['ref:refgone01', 'ref:refpage01', 'ref:refloose1']);
  });

  it('asks nothing for a page that names no admitted reference', async () => {
    const { value, stats } = await measureQueries(() => nativeHtmlAssets({ id: 'refnone01', version: 1, source: '<p>No images</p>', meta: {} }));
    expect(stats.count).toBe(0);
    expect(value).toContain('No images');
  });
});

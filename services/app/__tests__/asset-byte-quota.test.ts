/**
 * SPIKE S5 — BYTES PER TOKEN, charged at IMPORT.
 *
 * Today's quota counts artifact ROWS (`artifactQuotaExceeded`: COUNT(*) per
 * token). Nothing anywhere counts bytes, so one token can hold a thousand
 * 5 MB images and be inside its quota. Under the new design the expensive
 * thing is BYTES — an imported URL, a PDF, an uploaded image — so the cap has
 * to be a byte cap, charged once, by the importer.
 *
 * The rule this pins: a token whose stored bytes are already at or over
 * ASSETS__MAX_BYTES_PER_TOKEN gets `quota_exceeded` on its NEXT import, and
 * REFERENCING an already-cached URL is free (the global cache means the first
 * importer paid; a second document naming the same URL fetches nothing and
 * stores nothing, so charging it again would charge for one object twice).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { mintToken } from '@/lib/tokens';
import { getDb } from '@/lib/db';
import { assetBytesForToken, assetByteQuotaExceeded, setAssetByteQuotaForTests } from '@/lib/asset-quota';

useAppHarness();

const seedWebAsset = async (tokenId: string, url: string, bytes: number) => {
  const db = await getDb();
  await db.query(
    `insert into web_assets (url_hash, url, object_key, content_type, bytes, fetched_by_token_id)
     values ($1,$2,$3,$4,$5,$6) on conflict (url_hash) do nothing`,
    [`h${url}`.padEnd(64, '0').slice(0, 64), url, 'webasset/x', 'image/webp', bytes, tokenId],
  );
};

describe('asset byte quota', () => {
  beforeEach(() => setAssetByteQuotaForTests(null));

  it('sums the bytes a token has imported', async () => {
    const { id } = await mintToken('t');
    expect(await assetBytesForToken(id)).toBe(0);
    await seedWebAsset(id, 'https://a.example/1.png', 1_000_000);
    await seedWebAsset(id, 'https://a.example/2.png', 2_500_000);
    expect(await assetBytesForToken(id)).toBe(3_500_000);
  });

  it('a token over the cap is refused its NEXT import', async () => {
    const { id } = await mintToken('t');
    setAssetByteQuotaForTests(3_000_000);
    expect(await assetByteQuotaExceeded(id)).toBe(false);
    await seedWebAsset(id, 'https://a.example/big.png', 3_000_000);
    expect(await assetByteQuotaExceeded(id)).toBe(true);
  });

  it('another token is unaffected — the charge is per importer', async () => {
    const a = await mintToken('a');
    const b = await mintToken('b');
    setAssetByteQuotaForTests(1_000_000);
    await seedWebAsset(a.id, 'https://a.example/paid.png', 2_000_000);
    expect(await assetByteQuotaExceeded(a.id)).toBe(true);
    expect(await assetByteQuotaExceeded(b.id)).toBe(false);
  });
});

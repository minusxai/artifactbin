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
import { createUser } from '@/lib/users';
import { assetBytesForToken, assetByteQuotaExceeded, setAssetByteQuotaForTests } from '@/lib/asset-quota';
import { POST as bearerCreate } from '@/app/api/artifacts/route';
import { request } from '@/__tests__/harness';

useAppHarness();

const seedWebAsset = async (tokenId: string, url: string, bytes: number, userId: string | null = null) => {
  const db = await getDb();
  await db.query(
    `insert into web_assets (url_hash, url, object_key, content_type, bytes, fetched_by_token_id, fetched_by_user_id)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict (url_hash) do nothing`,
    [`h${url}`.padEnd(64, '0').slice(0, 64), url, 'webasset/x', 'image/webp', bytes, tokenId, userId],
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

/**
 * R9 — a per-TOKEN cap is bypassed by minting a second token, because a claimed
 * token already acts account-wide everywhere else. So the cap follows the
 * ACCOUNT when there is one, and the token only when there is not (an anonymous
 * token has no account to key on).
 */
describe('who the cap belongs to', () => {
  beforeEach(() => setAssetByteQuotaForTests(null));

  it('two tokens of one account share one cap', async () => {
    const user = await createUser({ email: 'mxmx_test_quota@example.com' });
    const first = await mintToken('a', user.id);
    const second = await mintToken('b', user.id);
    setAssetByteQuotaForTests(1_000_000);

    await seedWebAsset(first.id, 'https://a.example/acct.png', 2_000_000, user.id);
    expect(await assetBytesForToken(first.id)).toBe(2_000_000);
    // The second token never imported anything, and is refused all the same.
    expect(await assetBytesForToken(second.id)).toBe(2_000_000);
    expect(await assetByteQuotaExceeded(second.id)).toBe(true);
  });

  it('an anonymous token is keyed on itself, and is unaffected by an account over its cap', async () => {
    const user = await createUser({ email: 'mxmx_test_quota2@example.com' });
    const owned = await mintToken('owned', user.id);
    const anon = await mintToken('anon');
    setAssetByteQuotaForTests(1_000_000);
    await seedWebAsset(owned.id, 'https://a.example/theirs.png', 2_000_000, user.id);
    expect(await assetByteQuotaExceeded(owned.id)).toBe(true);
    expect(await assetByteQuotaExceeded(anon.id)).toBe(false);
  });
});


/**
 * …AND THE DOORS ACTUALLY ASK IT (R9).
 *
 * M1 built the cap and charged web imports with it. An UPLOAD records its bytes
 * the same way and nothing asked the question, so the one tier a person can
 * point at a five-gigabyte folder was the one tier with no byte cap — on both
 * of its shapes, the JSON `image:` body and the raw `Content-Type: image/*`
 * one, which do not share a code path.
 */
describe('the image doors ask the byte quota', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  it('refuses a JSON image body from a token over its cap', async () => {
    const t = await mintToken('t');
    await seedWebAsset(t.id, 'https://a.example/already.png', 4_000_000);
    setAssetByteQuotaForTests(1_000_000);
    const res = await bearerCreate(request('/api/artifacts', {
      method: 'POST', token: t.token, json: { image: `data:image/png;base64,${PNG.toString('base64')}` },
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('quota_exceeded');
  });

  it('refuses a raw-body upload from a token over its cap', async () => {
    const t = await mintToken('t');
    await seedWebAsset(t.id, 'https://a.example/already2.png', 4_000_000);
    setAssetByteQuotaForTests(1_000_000);
    const res = await bearerCreate(new Request('http://localhost:3000/api/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${t.token}` },
      body: new Uint8Array(PNG),
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('quota_exceeded');
  });

  it('lets a token under its cap publish', async () => {
    const t = await mintToken('t');
    setAssetByteQuotaForTests(1_000_000);
    const res = await bearerCreate(request('/api/artifacts', {
      method: 'POST', token: t.token, json: { image: `data:image/png;base64,${PNG.toString('base64')}` },
    }));
    expect(res.status).toBe(201);
  });
});

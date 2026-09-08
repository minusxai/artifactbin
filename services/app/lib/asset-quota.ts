/**
 * THE BYTE QUOTA — charged at IMPORT, to the importer, once.
 *
 * `artifactQuotaExceeded` counts artifact ROWS, which bounds nothing
 * expensive: a thousand rows can be five gigabytes or five kilobytes. The
 * asset tiers (uploaded images, URL-kept copies) make BYTES the thing worth
 * capping, so this is a second, additive quota — deliberately a separate
 * question from "how many documents", asked at the same doors an import
 * already passes.
 *
 * WHO IS CHARGED: the first importer, once. The url cache is GLOBAL, so a
 * second document naming an already-cached URL fetches nothing and stores
 * nothing; charging it would bill one object twice and make a popular URL
 * progressively more expensive for everyone. References are free.
 *
 * WHOSE CAP IT IS (R9): the ACCOUNT, whenever the token has one. A cap keyed
 * on the token alone is bypassed by minting a second token — and a claimed
 * token already acts account-wide everywhere else in this app (lib/artifacts
 * `ownerScope`), so keying the cap on the token would have been the one place
 * the account did not exist. An ANONYMOUS token has no account, so it is keyed
 * on itself; that is the only case where the token is the subject.
 *
 * The two sources of stored bytes, both already recorded:
 *   artifacts.meta->>'bytes'  — every image/PDF stored through storeImageContent
 *   web_assets.bytes          — every URL this importer was the first to fetch
 *
 * A DELETED asset is charged exactly like a live one, and neither sum names
 * the trash gate. Nothing in this product is ever erased: the bytes of a
 * deleted image are still in the object store, permanently, so not charging
 * for them would price storage at zero for anyone willing to press delete —
 * and the cap would be bypassed by delete-and-reimport. Stated in the docs
 * beside the row cap, which counts the same way for the same reason.
 */
import { getDb } from '@/lib/db';
import { ASSETS_MAX_BYTES_PER_TOKEN } from '@/lib/config';

let override: number | null | undefined;
/** Test hook, mirroring setArtifactQuotaForTests — config freezes at import. */
export function setAssetByteQuotaForTests(cap: number | null): void { override = cap; }

/** The account a token belongs to, or null when it is anonymous. */
async function accountFor(tokenId: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.query<{ user_id: string | null }>('SELECT user_id FROM tokens WHERE id = $1', [tokenId]);
  return r.rows[0]?.user_id ?? null;
}

/**
 * Bytes this token's OWNER has caused to be stored — the account's, when there
 * is one, and the token's own when there is not.
 */
export async function assetBytesForToken(tokenId: string): Promise<number> {
  const db = await getDb();
  const userId = await accountFor(tokenId);
  const r = userId
    ? await db.query<{ n: number }>(
      `SELECT
         (SELECT COALESCE(SUM((meta->>'bytes')::bigint), 0) FROM artifacts
           WHERE user_id = $1 AND meta ? 'bytes')
       + (SELECT COALESCE(SUM(bytes), 0) FROM web_assets WHERE fetched_by_user_id = $1)
         AS n`,
      [userId],
    )
    : await db.query<{ n: number }>(
      `SELECT
         (SELECT COALESCE(SUM((meta->>'bytes')::bigint), 0) FROM artifacts
           WHERE token_id = $1 AND user_id IS NULL AND meta ? 'bytes')
       + (SELECT COALESCE(SUM(bytes), 0) FROM web_assets
           WHERE fetched_by_token_id = $1 AND fetched_by_user_id IS NULL)
         AS n`,
      [tokenId],
    );
  return Number(r.rows[0]?.n ?? 0);
}

/** True when the next import must be refused with `quota_exceeded`. */
export async function assetByteQuotaExceeded(tokenId: string): Promise<boolean> {
  const cap = override !== undefined ? override : ASSETS_MAX_BYTES_PER_TOKEN;
  if (!cap) return false;
  return (await assetBytesForToken(tokenId)) >= cap;
}

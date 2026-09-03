/**
 * THE GLOBAL URL → OBJECT CACHE: our copy of an asset a document names by URL.
 *
 * An agent writes `<img src="https://…">` and the URL STAYS in the stored
 * markup — it is what the author wrote and what they read back. This module is
 * what makes serving it honest: the bytes are fetched ONCE, at publish, through
 * the guard and caps every other open-web fetch in this app already goes
 * through (lib/web-ingest), made fit to read by the same optimiser every upload
 * runs (lib/images/optimise), stored content-addressed, and recorded in one row
 * per canonical URL. `lib/story/asset-url` then points the SERVED document at
 * `/assets/<url_hash>`, so a reader loads our copy, the document's
 * `img-src 'self'` is satisfied, and opening a document tells the upstream host
 * nothing.
 *
 * The cache is GLOBAL and the FIRST importer wins: the same URL is the same
 * bytes for everyone, so a second document naming it fetches nothing, stores
 * nothing and is charged nothing (lib/asset-quota). Staleness is the price, and
 * `refreshWebAsset` is what pays it — re-fetch and REPOINT the row, keeping the
 * address (see the note there about what a cached reader still sees).
 *
 * The row is the INDEX — the db is the only index — so `/assets/<hash>` asks a
 * row before it asks the store, and a store that will not give the bytes for a
 * row we hold is corruption, not "empty".
 */
import { getDb } from '@/lib/db';
import { objectKey, objectStore } from '@/lib/object-store';
import { optimiseImage } from '@/lib/images/optimise';
import { MAX_IMAGE_BYTES } from '@/lib/config';
import { fetchWebResource } from '@/lib/web-ingest/fetch';
import { WebIngestError } from '@/lib/web-ingest/guard';
import { sniffImageType, sniffFontType } from '@/lib/web-ingest/sniff';
import { canonicalAssetUrl, urlHash } from '@/lib/story/asset-url';
import { collectExternalAssetUrls } from '@/lib/story/external-images';
import { assetByteQuotaExceeded } from '@/lib/asset-quota';
import { webIngestRateLimited } from '@/lib/auth';

/** What kind of asset a caller expects the URL to hold — the sniff and the optimiser follow it. */
export type WebAssetKind = 'image' | 'font';

/** Who pays for an import: a token, and the account behind it when there is one. */
export interface WebAssetImporter {
  tokenId: string | null;
  userId: string | null;
}

export interface WebAssetRow {
  url_hash: string;
  url: string;
  object_key: string;
  content_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  placeholder: string | null;
  /** The narrow copy (lib/images/optimise), for the `srcset` the mapping writes. */
  small_object_key: string | null;
  small_width: number | null;
  fetched_by_token_id: string | null;
  fetched_by_user_id: string | null;
}

/** A refusal with a NAME — the publish door turns it into a warning that names the URL and the fix. */
export class WebAssetRefused extends Error {
  constructor(public readonly code: string, message: string, public readonly url: string) {
    super(message);
    this.name = 'WebAssetRefused';
  }
}

/** Fonts are not re-encoded, so the cap is the face's own — the one lib/webfonts uses. */
const MAX_FONT_BYTES = 2_000_000;

/** The rows for a set of urls, keyed by the url the caller asked about. */
export async function lookupWebAssets(urls: readonly string[]): Promise<Map<string, WebAssetRow>> {
  const out = new Map<string, WebAssetRow>();
  if (urls.length === 0) return out;
  const db = await getDb();
  const byHash = new Map(urls.map((u) => [urlHash(u), u]));
  const r = await db.query<WebAssetRow>(
    'select * from web_assets where url_hash = any($1::text[])',
    [[...byHash.keys()]],
  );
  for (const row of r.rows) {
    const asked = byHash.get(row.url_hash);
    if (asked) out.set(asked, row);
  }
  return out;
}

/** One row by its address. A malformed hash is not a lookup — it is a 404 before any read. */
export async function webAssetByHash(hash: string): Promise<WebAssetRow | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const db = await getDb();
  const r = await db.query<WebAssetRow>('select * from web_assets where url_hash = $1', [hash]);
  return r.rows[0] ?? null;
}

/** Fetch, sniff and optimise — everything between the network and the row. */
async function fetchAsset(url: string, kind: WebAssetKind): Promise<Omit<WebAssetRow, 'url_hash' | 'url' | 'fetched_by_token_id' | 'fetched_by_user_id'>> {
  let bytes: Buffer;
  try {
    ({ bytes } = await fetchWebResource(url, {
      maxBytes: kind === 'font' ? MAX_FONT_BYTES : MAX_IMAGE_BYTES,
      accept: kind === 'font' ? 'font/woff2,font/woff,*/*' : 'image/*',
    }));
  } catch (error) {
    if (error instanceof WebIngestError) throw new WebAssetRefused(error.code, error.message, url);
    throw error;
  }

  // The type comes from the BYTES: a remote Content-Type is attacker-controlled
  // and a dead image link serves html. `nosniff` on the way out then holds the
  // browser to what we decided here.
  if (kind === 'font') {
    const type = sniffFontType(bytes);
    if (!type) throw new WebAssetRefused('unsupported_type', 'the response is not a font file', url);
    const key = objectKey('webasset', bytes);
    await objectStore().put(key, bytes, type);
    return {
      object_key: key, content_type: type, bytes: bytes.length,
      width: null, height: null, placeholder: null, small_object_key: null, small_width: null,
    };
  }

  const sniffed = sniffImageType(bytes);
  if (!sniffed) throw new WebAssetRefused('unsupported_type', 'the response is not an image', url);
  // The SAME door every upload comes through: WebP, MAX_IMAGE_EDGE, the box and
  // the ~100-byte blur — and SVG/animated GIF left exactly as they arrived.
  const optimised = await optimiseImage(bytes, sniffed);
  const key = objectKey('webasset', optimised.buffer);
  await objectStore().put(key, optimised.buffer, optimised.contentType);
  /*
   * The narrow copy is stored HERE, beside the full one, and its bytes are
   * charged WITH it: one import, one row, one number for the quota to sum. A
   * second copy billed separately would look like a second import of a URL
   * nobody named, and a second copy billed to nobody would be a way to store
   * bytes off the books.
   */
  const variant = optimised.variant;
  const smallKey = variant ? objectKey('webasset', variant.buffer) : null;
  if (variant && smallKey) await objectStore().put(smallKey, variant.buffer, variant.contentType);
  return {
    object_key: key,
    content_type: optimised.contentType,
    bytes: optimised.buffer.length + (variant?.buffer.length ?? 0),
    width: optimised.width,
    height: optimised.height,
    placeholder: optimised.placeholder,
    small_object_key: smallKey,
    small_width: variant?.width ?? null,
  };
}

/**
 * Import one URL, or hand back the row we already hold.
 *
 * The quota is checked HERE and only here — at the one door that turns a URL
 * into stored bytes, and only once we know we are about to store some: a URL
 * already in the cache is returned above the check, because charging for an
 * object that already exists would bill it twice and make a popular URL
 * progressively more expensive for everyone who names it.
 */
export async function importWebAsset(url: string, by: WebAssetImporter, kind: WebAssetKind = 'image'): Promise<WebAssetRow> {
  const hash = urlHash(url);
  const existing = await webAssetByHash(hash);
  if (existing) return existing;

  if (by.tokenId && await assetByteQuotaExceeded(by.tokenId)) {
    throw new WebAssetRefused('quota_exceeded', 'this account is over its stored-byte quota — delete assets you no longer need', url);
  }

  const stored = await fetchAsset(url, kind);
  const db = await getDb();
  await db.query(
    `insert into web_assets (url_hash, url, object_key, content_type, bytes, width, height, placeholder,
       small_object_key, small_width, fetched_by_token_id, fetched_by_user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (url_hash) do nothing`,
    [hash, canonicalAssetUrl(url), stored.object_key, stored.content_type, stored.bytes,
      stored.width, stored.height, stored.placeholder, stored.small_object_key, stored.small_width,
      by.tokenId, by.userId],
  );
  // Re-read rather than return what we built: a concurrent importer may have
  // won the insert, and the row that EXISTS is the one every reader will serve.
  return (await webAssetByHash(hash))!;
}

/**
 * Re-fetch a URL and repoint its row — the answer to "the source image
 * changed" (R13). The ADDRESS never moves (`/assets/<url_hash>` is derived from
 * the url, not the bytes), which is what lets a stored document keep working
 * without a rewrite — and is also the honest limit of this: the address is
 * served `immutable`, so a reader whose browser already cached it keeps the old
 * picture until that entry expires. Everyone who has not is served the new one.
 *
 * A URL nobody holds yet is simply imported, so a caller need not ask first.
 *
 * WHO PAYS, and WHAT BECOMES OF THE OLD OBJECT
 *
 * This is a door that turns a URL into STORED BYTES, so it asks the byte quota
 * exactly as `importWebAsset` does — a refresher already over their cap is
 * refused before anything is fetched. Without that, the cap this milestone
 * exists to add was bypassable through the route this milestone added: repoint,
 * repoint, repoint, and every new object is invisible to a sum over the rows.
 *
 * When the object MOVES, the row's payer moves with it: the row's `bytes` are
 * now the bytes the REFRESHER caused, so they are the refresher's to answer
 * for, and the original importer stops carrying a number that no longer
 * describes anything they own. When the key is unchanged — the source really is
 * the same bytes — nothing was stored and nobody is charged.
 *
 * The SUPERSEDED object STAYS in the store. It is content-addressed, so it may
 * be the very same object another URL resolves to, and this store has never
 * deleted anything (`ObjectUnavailable` is the whole of its error vocabulary —
 * there is no reference count to consult and a delete would be a guess). It is
 * not free, either: every object in the store was charged to whoever caused it
 * to be stored, at the moment it was stored — the importer for the first copy,
 * the refresher for each one after. What a refresh does NOT do is keep charging
 * the original importer for a copy nobody serves any more.
 */
export async function refreshWebAsset(url: string, by: WebAssetImporter, kind: WebAssetKind = 'image'): Promise<WebAssetRow> {
  const hash = urlHash(url);
  const existing = await webAssetByHash(hash);
  if (!existing) return importWebAsset(url, by, kind);

  if (by.tokenId && await assetByteQuotaExceeded(by.tokenId)) {
    throw new WebAssetRefused('quota_exceeded', 'this account is over its stored-byte quota — delete assets you no longer need', url);
  }

  const stored = await fetchAsset(url, kind);
  if (stored.object_key === existing.object_key) return existing; // same bytes: nothing stored, nobody charged
  const db = await getDb();
  await db.query(
    `update web_assets set object_key = $2, content_type = $3, bytes = $4, width = $5, height = $6,
       placeholder = $7, small_object_key = $8, small_width = $9,
       fetched_at = now(), fetched_by_token_id = $10, fetched_by_user_id = $11
     where url_hash = $1`,
    [hash, stored.object_key, stored.content_type, stored.bytes, stored.width, stored.height, stored.placeholder,
      stored.small_object_key, stored.small_width, by.tokenId, by.userId],
  );
  return (await webAssetByHash(hash))!;
}

/**
 * The rows behind every external URL one document names — the ONE call every
 * serving path makes before it renders (the page, the live frame, a capture).
 * Empty for a document that names none, which is nearly all of them, and the
 * mapping then costs nothing.
 */
export async function webAssetsForSource(source: string | null | undefined): Promise<Map<string, WebAssetRow>> {
  if (!source) return new Map();
  return lookupWebAssets(collectExternalAssetUrls(source).all);
}

/** A refusal an agent can act on: the code, the URL it was about, and what to do. */
export interface AssetWarning {
  code: string;
  url: string;
  fix: string;
}

/** What each refusal means in the one sentence its reader needs. */
const FIXES: Readonly<Record<string, string>> = {
  bad_status: 'the URL did not answer with the file — check it is public and still there',
  fetch_failed: 'the host could not be reached — check the URL',
  dns_failed: 'the host name does not resolve — check the URL',
  timeout: 'the host took too long — try a URL that answers quickly',
  too_large: 'the file is over the import cap — link a smaller copy',
  too_many_redirects: 'too many redirects — link the file itself',
  unsupported_type: 'that URL does not serve the file itself — link the image or font, not a page about it',
  invalid_url: 'only a plain public http(s) URL can be imported',
  forbidden_scheme: 'only a public https URL can be imported',
  forbidden_host: 'that host cannot be imported from',
  forbidden_address: 'that address is not on the public internet',
  quota_exceeded: 'this account is over its stored-byte quota — delete assets you no longer need',
  rate_limited: 'too many web imports this hour — try again later',
};

/**
 * A refusal, as the publish reply carries it. A dead, refused or oversized URL
 * is a WARNING and never a 400: the rest of the document is fine, the author
 * can see what happened, and the served `<img>` draws its alt text where the
 * picture would have been. Refusing the publish instead would throw away a
 * whole document over one link.
 */
export const assetWarningFor = (error: WebAssetRefused): AssetWarning =>
  ({ code: error.code, url: error.url, fix: FIXES[error.code] ?? error.message });

/** What a refresh moved, what it left alone, and what it could not do. */
export interface AssetRefreshResult {
  refreshed: string[];
  unchanged: string[];
  failed: AssetWarning[];
}

/** A URL's kind, read back from what we stored for it. */
export const kindOfRow = (row: WebAssetRow): WebAssetKind => (row.content_type.startsWith('font/') ? 'font' : 'image');

/**
 * Re-fetch a set of URLs we already hold and report what moved.
 *
 * UNCHANGED is not a failure and not a refresh: the object is content-addressed,
 * so identical bytes land on the identical key, and saying so is what lets a
 * caller tell "the source really did change" from "we looked". A URL we do NOT
 * hold is reported rather than imported — importing is what publishing a
 * document that names it does, and a refresh door that also imported would be a
 * fetch primitive wearing a refresh's name.
 */
export async function refreshWebAssets(urls: readonly string[], by: WebAssetImporter): Promise<AssetRefreshResult> {
  const out: AssetRefreshResult = { refreshed: [], unchanged: [], failed: [] };
  for (const url of urls) {
    /*
     * PER URL, like the publish door (lib/artifacts assetImporterFor) and on
     * the same bucket. The allowance counts fetch ATTEMPTS because probing is
     * the abuse shape — so a refresh of N urls is N attempts, and a single call
     * cannot buy N outbound fetches for one slot at a host of the caller's
     * choosing.
     */
    if (by.tokenId && webIngestRateLimited(`ingest:${by.tokenId}`)) {
      out.failed.push({ code: 'rate_limited', url, fix: 'too many web imports this hour — try again later' });
      continue;
    }
    const held = await webAssetByHash(urlHash(url));
    if (!held) {
      out.failed.push({ code: 'not_cached', url, fix: 'nothing is stored for that URL — publish a document that names it and it is imported' });
      continue;
    }
    try {
      const after = await refreshWebAsset(url, by, kindOfRow(held));
      (after.object_key === held.object_key ? out.unchanged : out.refreshed).push(url);
    } catch (error) {
      if (error instanceof WebAssetRefused) out.failed.push(assetWarningFor(error));
      else throw error;
    }
  }
  return out;
}

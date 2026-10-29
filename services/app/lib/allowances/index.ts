/**
 * THE APP'S HOURLY ALLOWANCES: in-memory attempt buckets for work that makes THIS SERVER fetch a URL. Quotas
 * a proxy cannot see (they are counted per URL inside one request, or per document), not rate limits.
 *
 * Every allowance takes its clock as `now` (milliseconds; default `Date.now()`), so a caller or a test decides
 * what time it is. One bucket map serves all three, bounded by a sweep.
 */
import { forwardedFor } from '../accounts';
import { TRUSTED_PROXY_HOPS, WEB_INGEST_MAX_PER_HOUR } from '../platform';

// ── Web-ingest allowance ─────────────────────────────────────────────────────
// Importing an asset makes THIS SERVER fetch a URL, so an identity gets a
// bounded number of fetch ATTEMPTS per hour — attempts, not successes, because
// the abuse shape is probing, and probes fail. A QUOTA, not a rate limit: it is
// counted per URL INSIDE one publish request, which a proxy cannot see.
const WEB_INGEST_WINDOW_MS = 60 * 60 * 1000;
const webIngestTimes = new Map<string, number[]>();

export function webIngestRateLimited(key: string, now = Date.now()): boolean {
  return hourlyAttemptsExhausted(key, WEB_INGEST_MAX_PER_HOUR, now);
}

/** The most buckets held at once; past it the least recently created are dropped, so the map cannot grow without bound. */
const WEB_INGEST_MAX_KEYS = 50_000;
/** Buckets whose attempts have all aged out are swept this often, not only when their own key is touched again. */
const WEB_INGEST_SWEEP_MS = 60 * 1000;
let nextSweepAt = 0;

function sweepExpiredBuckets(now: number): void {
  if (now < nextSweepAt && webIngestTimes.size <= WEB_INGEST_MAX_KEYS) return;
  nextSweepAt = now + WEB_INGEST_SWEEP_MS;
  for (const [key, times] of webIngestTimes) {
    if (!times.length || now - times[times.length - 1]! >= WEB_INGEST_WINDOW_MS) webIngestTimes.delete(key);
  }
  for (const key of webIngestTimes.keys()) {
    if (webIngestTimes.size <= WEB_INGEST_MAX_KEYS) break;
    webIngestTimes.delete(key);
  }
}

/** Number of live buckets — a test seam for the sweep. */
export function webIngestBucketCount(): number { return webIngestTimes.size; }

/** One hourly ATTEMPT bucket, shared by every allowance in this file. */
function hourlyAttemptsExhausted(key: string, max: number, now: number): boolean {
  sweepExpiredBuckets(now);
  const times = (webIngestTimes.get(key) ?? []).filter((t) => now - t < WEB_INGEST_WINDOW_MS);
  if (times.length >= max) {
    if (times.length) webIngestTimes.set(key, times); else webIngestTimes.delete(key);
    return true;
  }
  times.push(now);
  webIngestTimes.set(key, times);
  return false;
}

/**
 * A DOCUMENT's own hourly ceiling on first-view asset imports
 * (app/a/[id]/assets).
 *
 * Keyed on the document rather than on a caller, because the caller is
 * whichever stranger happens to be reading and the thing being protected is
 * this server's outbound fetching. It is an APP quota and not a proxy policy for
 * the proxy's verdicts are per client IP and it
 * cannot see which document an address names, so "this document has done
 * enough importing for one hour" is a question only the app can ask.
 *
 * Smaller than the per-identity web-ingest allowance by an order of magnitude:
 * a publish imports a document's whole finite set of URLs at once, while this
 * is the tail of what only a reader can compute, and a document that genuinely
 * needs hundreds of distinct images an hour is not the shape this exists for.
 */
const DOC_ASSET_IMPORTS_PER_HOUR = 30;
let docAssetCap: number | null = null;
/** Test hook, mirroring setAssetByteQuotaForTests — the ceiling is a constant. */
export function setDocAssetImportCapForTests(cap: number | null): void { docAssetCap = cap; }

export function docAssetImportRateLimited(id: string, now = Date.now()): boolean {
  return hourlyAttemptsExhausted(`doc-assets:${id}`, docAssetCap ?? DOC_ASSET_IMPORTS_PER_HOUR, now);
}

/**
 * A document's script reaching a declared host through us (app/a/[id]/fetch): per document AND reader,
 * because the thing protected is this server's outbound fetching on that document's behalf, and one
 * reader's busy dashboard must not exhaust another's.
 */
const DOC_FETCHES_PER_HOUR = 600;
let docFetchCap: number | null = null;
/**
 * Who a document's fetch quota is charged to: the account or token, else the anonymous reader's client IP
 * (the address our trusted proxy saw), so one busy stranger cannot spend every other stranger's allowance.
 */
export function documentFetchReader(actor: { userId?: string | null; tokenId?: string | null }, request: Request): string {
  if (actor.userId ?? actor.tokenId) return (actor.userId ?? actor.tokenId)!;
  const ip = forwardedFor(request.headers, TRUSTED_PROXY_HOPS);
  return ip ? `guest:${ip}` : 'guest';
}

/** Test hook for the per-document fetch ceiling. */
export function setDocumentFetchCapForTests(cap: number | null): void { docFetchCap = cap; }
export function documentFetchRateLimited(id: string, reader: string, now = Date.now()): boolean {
  return hourlyAttemptsExhausted(`doc-fetch:${id}:${reader}`, docFetchCap ?? DOC_FETCHES_PER_HOUR, now);
}

/** Test hook: empties every bucket. */
export function resetAllowances(): void {
  webIngestTimes.clear();
  nextSweepAt = 0;
}

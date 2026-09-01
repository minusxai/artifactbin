/**
 * The guarded fetcher for a caller-supplied URL: images at the publish door,
 * Google Fonts, and CSV-by-URL all go through here, so the SSRF posture for
 * open-web fetches is audited once. (The Sheets path in lib/data-ingest/sheets
 * is pinned to docs.google.com instead.)
 *
 * Built on node:http(s).request with a custom `lookup` rather than fetch():
 * the lookup callback feeds the socket connection directly, so the address the
 * guard approves is the address the socket dials — DNS rebinding between a
 * check and a connect has nowhere to happen. Redirects are followed by hand
 * (≤3) so every hop re-runs the full URL + address guard; the classic
 * public-host-redirects-to-metadata-IP escape dies on the second hop's guard.
 *
 * The body is STREAMED against maxBytes and the request destroyed at the cap —
 * a hostile 50 GB response costs the cap, not the heap. One deadline covers
 * the whole chain, headers and body alike.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { WEB_INGEST_ALLOW_PRIVATE, WEB_INGEST_TIMEOUT_MS } from '@/lib/config';
import { isForbiddenIp, parseWebUrl, WebIngestError, type WebIngestPolicy } from './guard';

export interface WebResource {
  bytes: Buffer;
  /** The remote Content-Type header, media type only — advisory; callers SNIFF. */
  contentType: string;
  /** Where the bytes actually came from, after redirects. */
  finalUrl: string;
}

export interface FetchWebResourceOpts {
  /** Hard cap; the stream is destroyed the moment it is crossed. */
  maxBytes: number;
  /** Accept header, when the caller knows what it wants. */
  accept?: string;
  /** Override the User-Agent — css2 answers woff2 only to a browser UA. */
  userAgent?: string;
  /** Narrow the reachable hosts (e.g. the Google Fonts pair). Checked per hop. */
  allowHosts?: (hostname: string) => boolean;
  timeoutMs?: number;
}

const MAX_REDIRECTS = 3;

// The dev switch (WEB_INGEST_ALLOW_PRIVATE / IS_DEV) admits loopback/RFC1918 —
// a dev checkout's interesting URLs are its own; link-local never softens.
let policyOverride: WebIngestPolicy | null = null;
/** Test seam — mirrors setArtifactQuotaForTests: config freezes at import. */
export function setWebIngestPolicyForTests(policy: WebIngestPolicy | null): void {
  policyOverride = policy;
}
const activePolicy = (): WebIngestPolicy =>
  policyOverride ?? { allowPrivate: WEB_INGEST_ALLOW_PRIVATE, allowHttp: WEB_INGEST_ALLOW_PRIVATE };

/**
 * A lookup that vets EVERY resolved address before any socket dials it.
 *
 * The callback shape MUST follow what the caller asked for: Node's
 * `autoSelectFamily` (on by default since 20) calls lookup with `all: true`
 * and expects the ARRAY back — answering with a single address there fails the
 * connection with "Invalid IP address: undefined". A literal-IP host skips
 * lookup entirely, which is why only a NAMED host exercises this path.
 */
const guardedLookup = (policy: WebIngestPolicy): LookupFunction =>
  ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err || !Array.isArray(addresses) || addresses.length === 0) {
        callback(new WebIngestError('dns_failed', `"${hostname}" does not resolve`));
        return;
      }
      // ANY forbidden address fails the whole name: a round-robin that is
      // sometimes private is an oracle, not a host.
      if (addresses.some((a) => isForbiddenIp(a.address, policy))) {
        callback(new WebIngestError('forbidden_address', `"${hostname}" resolves to a non-fetchable address`));
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  }) as unknown as LookupFunction;

const oneHop = (
  url: URL,
  opts: FetchWebResourceOpts,
  policy: WebIngestPolicy,
  deadline: number,
): Promise<{ redirect: string } | WebResource> =>
  new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { reject(new WebIngestError('timeout', 'the fetch deadline passed')); return; }
    if (opts.allowHosts && !opts.allowHosts(url.hostname)) {
      reject(new WebIngestError('forbidden_host', `"${url.hostname}" is not an allowed source for this import`));
      return;
    }
    const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = doRequest(url, {
      method: 'GET',
      lookup: guardedLookup(policy),
      headers: {
        Accept: opts.accept ?? '*/*',
        'User-Agent': opts.userAgent ?? 'artifactbin-ingest/1 (+https://artifactbin.dev)',
        'Accept-Encoding': 'identity',
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume(); // drain; the hop is over
        resolve({ redirect: new URL(location, url).toString() });
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new WebIngestError('bad_status', `"${url}" answered ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > opts.maxBytes) {
          req.destroy(new WebIngestError('too_large', `"${url}" exceeds the ${opts.maxBytes}-byte import cap`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const contentType = (res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        resolve({ bytes: Buffer.concat(chunks), contentType, finalUrl: url.toString() });
      });
      res.on('error', (e) => reject(e instanceof WebIngestError ? e : new WebIngestError('fetch_failed', String(e))));
    });
    const timer = setTimeout(() => req.destroy(new WebIngestError('timeout', `"${url}" took too long`)), remaining);
    req.on('close', () => clearTimeout(timer));
    req.on('error', (e) => reject(e instanceof WebIngestError ? e : new WebIngestError('fetch_failed', `could not reach "${url.hostname}": ${(e as Error).message}`)));
    req.end();
  });

/** Fetch a caller-supplied URL under the full guard. Throws WebIngestError. */
export async function fetchWebResource(raw: string, opts: FetchWebResourceOpts): Promise<WebResource> {
  const policy = activePolicy();
  const deadline = Date.now() + (opts.timeoutMs ?? WEB_INGEST_TIMEOUT_MS);
  let url = parseWebUrl(raw, policy);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const got = await oneHop(url, opts, policy, deadline);
    if (!('redirect' in got)) return got;
    url = parseWebUrl(got.redirect, policy); // full re-vet, scheme and address included
  }
  throw new WebIngestError('too_many_redirects', `"${raw}" redirects more than ${MAX_REDIRECTS} times`);
}

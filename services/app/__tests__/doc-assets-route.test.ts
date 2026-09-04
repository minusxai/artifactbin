/**
 * `GET /a/<id>/assets?u=<url>` — the per-document FIRST-REQUEST import.
 *
 * Publish imports the finite set of URLs it can see. A URL that only exists
 * once a reader has picked something is imported here, on the first view that
 * needs it, and cached globally like any other.
 *
 * The whole design question is why this is not an open image proxy, so every
 * bound is exercised:
 *   1. the document must EXIST and be READABLE by the caller — a uniform 404,
 *      answered BEFORE anything is fetched;
 *   2. the SSRF guard, with its own lookup re-run per redirect;
 *   3. image-only, decided by the BYTES;
 *   4. the byte cap, streamed and destroyed at it;
 *   5. a per-document hourly ATTEMPT allowance.
 * And it never returns the upstream body: the answer is a redirect to
 * `/assets/<hash>`, so only sniffer-approved bytes are ever served.
 *
 * WHO PAYS (R10): the DOCUMENT'S OWNER. They named the source; a reader who
 * merely opens a page — possibly an anonymous stranger — spends no storage.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useAppHarness, request, agentCookie } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@/__tests__/net';
import { GET as docAssets } from '@/app/a/[id]/assets/route';
import { POST as createArtifact, GET as listArtifacts } from '@/app/api/artifacts/route';
import { PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { setDocAssetImportCapForTests } from '@/lib/auth';
import { assetUrlFor, urlHash } from '@/lib/story/asset-url';
import { getDb } from '@/lib/db';
import { mintExportKey } from '@/lib/export-key';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
useAppHarness();

let server: RunningServer;
let web: string;
const hits: string[] = [];

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    hits.push(req.url ?? '');
    if (req.url === '/page.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>not an image</html>'); return; }
    if (req.url === '/huge.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.concat([PNG, Buffer.alloc(6_000_000, 7)]));
      return;
    }
    if (req.url?.endsWith('.png')) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
    res.writeHead(404); res.end();
  });
  web = server.base;
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  await server.close();
});

afterEach(() => { setDocAssetImportCapForTests(null); });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** `GET /a/<id>/assets?u=<url>` as whoever the options say (nobody, by default). */
const ask = (id: string, url: string, opts: Parameters<typeof request>[1] = {}) =>
  docAssets(request(`/a/${id}/assets?u=${encodeURIComponent(url)}`, opts), params(id));

const MARKUP = '<Helmet><Value name="pick" type="string" /></Helmet><div><img src="$pick" alt="a" /></div>';

/** An anonymous token's document is born PUBLIC. */
async function publicDoc() {
  const t = await mintToken('anon');
  const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: MARKUP } }));
  expect(res.status).toBe(201);
  return { token: t, id: (await res.json()).id as string };
}

/** A claimed token's document is born PRIVATE, and its owner is an account. */
async function privateDoc() {
  const user = await createUser({ email: `mxmx_test_owner_${Math.random().toString(36).slice(2, 8)}@example.com` });
  const t = await mintToken('owner', user.id);
  const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: MARKUP } }));
  expect(res.status).toBe(201);
  return { token: t, user, id: (await res.json()).id as string };
}

const rows = async () => (await (await getDb()).query<{ url: string; fetched_by_token_id: string | null; fetched_by_user_id: string | null }>(
  'select url, fetched_by_token_id, fetched_by_user_id from web_assets',
)).rows;

describe('the document gate — 404 BEFORE anything is fetched', () => {
  it('answers an unknown document 404 and asks nobody for the URL', async () => {
    hits.length = 0;
    const res = await ask('zzzzzz', `${web}/a.png`);
    expect(res.status).toBe(404);
    expect(hits).toEqual([]);
  });

  it('answers a stranger on a PRIVATE document 404 and asks nobody for the URL', async () => {
    const doc = await privateDoc();
    hits.length = 0;
    const res = await ask(doc.id, `${web}/b.png`);
    expect(res.status).toBe(404);
    expect(hits).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it('answers a missing url with a 400 that names it', async () => {
    const doc = await publicDoc();
    const res = await docAssets(request(`/a/${doc.id}/assets`), params(doc.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_url');
  });
});

describe('the happy path', () => {
  it('imports once and redirects to the content-addressed copy — never the upstream body', async () => {
    const doc = await publicDoc();
    const url = `${web}/first.png`;
    hits.length = 0;
    const res = await ask(doc.id, url);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(assetUrlFor(url));
    expect(res.headers.get('location')).toBe(`/assets/${urlHash(url)}`);
    expect(await res.text()).toBe('');
    expect(hits).toEqual(['/first.png']);
  });

  it('is a CACHE HIT the second time: same redirect, zero fetches', async () => {
    const doc = await publicDoc();
    const url = `${web}/second.png`;
    await ask(doc.id, url);
    hits.length = 0;
    const again = await ask(doc.id, url);
    expect(again.status).toBe(302);
    expect(again.headers.get('location')).toBe(assetUrlFor(url));
    expect(hits).toEqual([]);
  });

  it('serves a stranger reading a PUBLIC document', async () => {
    const doc = await publicDoc();
    const res = await ask(doc.id, `${web}/stranger.png`);
    expect(res.status).toBe(302);
  });
});

describe('who pays (R10): the document owner, never the reader', () => {
  it('charges the OWNER for a URL a stranger caused us to fetch', async () => {
    const owner = await createUser({ email: `mxmx_test_payer_${Math.random().toString(36).slice(2, 8)}@example.com` });
    const t = await mintToken('payer', owner.id);
    const created = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: MARKUP } }));
    const id = (await created.json()).id as string;
    // Public, so a stranger may read it — and the stranger is who asks.
    await putArtifact(request(`/api/artifacts/${id}`, { method: 'PUT', token: t.token, json: { markup: MARKUP, visibility: 'public' } }), params(id));

    const reader = await mintToken('a passer-by');
    const res = await ask(id, `${web}/paid.png`, { token: reader.token });
    expect(res.status).toBe(302);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0].fetched_by_user_id).toBe(owner.id);
    expect(stored[0].fetched_by_token_id).toBe(t.id);
    // …and the reader was charged nothing at all.
    expect(stored.filter((r) => r.fetched_by_token_id === reader.id)).toEqual([]);
  });

  it('imports nothing a second document already caused to be stored — one object, one charge', async () => {
    const a = await publicDoc();
    const b = await publicDoc();
    const url = `${web}/shared.png`;
    await ask(a.id, url);
    hits.length = 0;
    expect((await ask(b.id, url)).status).toBe(302);
    expect(hits).toEqual([]);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0].fetched_by_token_id).toBe(a.token.id);
  });
});

describe('the bounds, each by name', () => {
  it('refuses an address that is not on the public internet', async () => {
    const doc = await publicDoc();
    const res = await ask(doc.id, 'http://169.254.169.254/latest/meta-data/iam.png');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('asset_fetch_failed');
    expect(body.code).toBe('forbidden_address');
  });

  it('refuses a response that is not an image, decided by the bytes', async () => {
    const doc = await publicDoc();
    const res = await ask(doc.id, `${web}/page.html`);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('unsupported_type');
    expect(await rows()).toEqual([]);
  });

  it('refuses a body over the cap', async () => {
    const doc = await publicDoc();
    const res = await ask(doc.id, `${web}/huge.png`);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('too_large');
    expect(await rows()).toEqual([]);
  });

  it('refuses a dead URL by name', async () => {
    const doc = await publicDoc();
    const res = await ask(doc.id, `${web}/gone.jpg`);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('bad_status');
  });

  it('stops at the document\'s hourly allowance — on the attempt AFTER the cap', async () => {
    setDocAssetImportCapForTests(2);
    const doc = await publicDoc();
    expect((await ask(doc.id, `${web}/q1.png`)).status).toBe(302);
    expect((await ask(doc.id, `${web}/q2.png`)).status).toBe(302);
    hits.length = 0;
    const third = await ask(doc.id, `${web}/q3.png`);
    expect(third.status).toBe(429);
    expect((await third.json()).error).toBe('rate_limited');
    // Nothing was asked of the web once the allowance was gone.
    expect(hits).toEqual([]);
  });

  it('a cache HIT costs no allowance — the ceiling bounds fetching, not reading', async () => {
    setDocAssetImportCapForTests(1);
    const doc = await publicDoc();
    const url = `${web}/cheap.png`;
    expect((await ask(doc.id, url)).status).toBe(302);
    expect((await ask(doc.id, url)).status).toBe(302);
    expect((await ask(doc.id, url)).status).toBe(302);
  });
});

describe('nothing else was created', () => {
  it('imports an asset without inventing an artifact for it', async () => {
    const doc = await publicDoc();
    await ask(doc.id, `${web}/tidy.png`);
    const list = await listArtifacts(request('/api/artifacts', { token: doc.token.token }));
    expect((await list.json()).artifacts).toHaveLength(1);
  });
});

/**
 * THE JSON ANSWER — for the one caller that is not an `<img>`.
 *
 * A framed document cannot load this endpoint itself: it is opaque-origin, so
 * its `<img>` carries no cookie, and on a private document the ACL then answers
 * the uniform 404 — for a shared reader, for the exporter, and for the OWNER's
 * own framed copy, which is the default case since a signed-in user's document
 * is born private. So the page asks on the frame's behalf and needs the ADDRESS
 * rather than a redirect it would silently follow.
 *
 * Selected by `Accept: application/json`, which an `<img>` can never send (it
 * asks for `image/*`), so the two answers can never be confused for each other.
 */
const asJson = (id: string, url: string, opts: Parameters<typeof request>[1] = {}) =>
  docAssets(request(`/a/${id}/assets?u=${encodeURIComponent(url)}`, { ...opts, headers: { ...(opts.headers ?? {}), accept: 'application/json' } }), params(id));

describe('the JSON answer', () => {
  it('answers 200 with the address instead of a redirect', async () => {
    const doc = await publicDoc();
    const url = `${web}/json1.png`;
    const res = await asJson(doc.id, url);
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.json()).toEqual({ url: assetUrlFor(url) });
  });

  it('keeps a refusal exactly as the redirect path reports it', async () => {
    const doc = await publicDoc();
    const res = await asJson(doc.id, 'http://169.254.169.254/x.png');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('forbidden_address');
  });

  it('is still the uniform 404 for a stranger on a private document', async () => {
    const doc = await privateDoc();
    hits.length = 0;
    expect((await asJson(doc.id, `${web}/json2.png`)).status).toBe(404);
    expect(hits).toEqual([]);
  });

  it('admits the OWNER through their browser credential, and charges them', async () => {
    const doc = await privateDoc();
    const res = await asJson(doc.id, `${web}/json3.png`, { cookie: await agentCookie([doc.token.id]) });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe(assetUrlFor(`${web}/json3.png`));
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0].fetched_by_user_id).toBe(doc.user.id);
  });
});

/**
 * THE EXPORTER'S KEY. `/a/<id>/export` renders the page in a headless browser
 * with no session at all, so a private document's capture reaches this endpoint
 * through the page carrying the same signed, seconds-long key `raw` honours —
 * without it the export photographs alt text where the picture should be.
 */
describe('the export key', () => {
  it('admits a caller holding a valid key for THIS document', async () => {
    const doc = await privateDoc();
    const key = mintExportKey(doc.id);
    const res = await docAssets(request(`/a/${doc.id}/assets?u=${encodeURIComponent(`${web}/key1.png`)}&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } }), params(doc.id));
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe(assetUrlFor(`${web}/key1.png`));
  });

  it('refuses a key minted for a DIFFERENT document, and an expired one', async () => {
    const doc = await privateDoc();
    const other = await privateDoc();
    hits.length = 0;
    const wrong = await docAssets(request(`/a/${doc.id}/assets?u=${encodeURIComponent(`${web}/key2.png`)}&key=${encodeURIComponent(mintExportKey(other.id))}`), params(doc.id));
    expect(wrong.status).toBe(404);
    const dead = await docAssets(request(`/a/${doc.id}/assets?u=${encodeURIComponent(`${web}/key3.png`)}&key=${encodeURIComponent(mintExportKey(doc.id, -1000))}`), params(doc.id));
    expect(dead.status).toBe(404);
    expect(hits).toEqual([]);
  });
});

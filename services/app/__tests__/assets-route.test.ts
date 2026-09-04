/**
 * GET /assets/<hash> — our copy of a URL a document names.
 *
 * The address is derived from the URL, not from the bytes, so `immutable` is
 * what the cache header says and `refresh_asset` is how a changed source is
 * taken up. Everything else here is R15, the hole the spike measured: a stored
 * SVG is a DOCUMENT the moment someone navigates to it, and served plainly it
 * ran with this app's origin — reachable storage, reachable cookies. Three
 * headers close it (`Content-Security-Policy: sandbox`, `Content-Disposition:
 * attachment`, `X-Content-Type-Options: nosniff`) and none of them stops an
 * `<img>`, a `<link>` or an `@font-face` from using the same bytes — which is
 * what the browser gate proves and this file pins on the wire.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET } from '@/app/assets/[hash]/route';
import { getDb } from '@/lib/db';
import { objectKey, objectStore } from '@/lib/object-store';
import { urlHash } from '@/lib/story/asset-url';

useAppHarness();

const BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const URL_A = 'https://example.test/logo.svg';

const seed = async (contentType = 'image/svg+xml', bytes: Buffer = BYTES, url: string = URL_A) => {
  const key = objectKey('webasset', bytes);
  await objectStore().put(key, bytes, contentType);
  const db = await getDb();
  await db.query(
    `insert into web_assets (url_hash, url, object_key, content_type, bytes) values ($1,$2,$3,$4,$5)`,
    [urlHash(url), url, key, contentType, bytes.length],
  );
  return urlHash(url);
};

const asset = (hash: string) => GET(request(`/assets/${hash}`), { params: Promise.resolve({ hash }) });

describe('GET /assets/<hash>', () => {
  it('serves the stored bytes with all five headers', async () => {
    const hash = await seed();
    const res = await asset(hash);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
    expect(res.headers.get('Content-Disposition')).toBe('attachment');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // The document has an OPAQUE origin, so its own-origin font fetch is a CORS
    // request — /webfonts carries this for the same reason.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('404s an unknown hash, and a malformed one before it reads anything', async () => {
    expect((await asset('a'.repeat(64))).status).toBe(404);
    expect((await asset('not-a-hash')).status).toBe(404);
    expect((await asset('../../etc/passwd')).status).toBe(404);
    expect((await asset('A'.repeat(64))).status).toBe(404); // hex is lowercase; a near miss is still a miss
  });

  it('404s a row whose object the store will not give', async () => {
    const hash = await seed();
    const db = await getDb();
    await db.query('update web_assets set object_key = $1 where url_hash = $2', ['webasset/gone', hash]);
    expect((await asset(hash)).status).toBe(404);
  });
});

/*
 * THE ONE EXCEPTION TO `attachment`, and it is not a widening.
 *
 * `attachment` exists here because a stored SVG is markup (R15). A PDF is not:
 * it cannot script, `nosniff` holds the browser to the type we sniffed from the
 * bytes, and `Content-Security-Policy: sandbox` — which stays — was measured
 * putting the response at an OPAQUE origin where storage and cookies throw.
 * What `attachment` DOES cost here is the whole feature: opened from inside a
 * document's sandbox it was measured producing neither a popup nor a download
 * (spike S4), so a <File> card linking an imported PDF would simply do nothing.
 */
describe('a PDF among the assets', () => {
  it('is served inline, named after its source URL, with the sandbox and nosniff kept', async () => {
    const pdf = Buffer.from('%PDF-1.4\nnot really, but typed from these bytes at import\n');
    const hash = await seed('application/pdf', pdf, 'https://example.test/papers/q3%20report.pdf');
    const res = await asset(hash);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="q3 report.pdf"');
    expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('serves one whose source URL has a % in its filename, instead of 500ing', async () => {
    // The bytes imported perfectly; only the disposition's NAME is derived from
    // the URL, and `decodeURIComponent('a%ff.pdf')` throws. A malformed escape
    // is kept as text: a filename is decoration, and throwing here takes down
    // an address every reader of the document loads.
    const pdf = Buffer.from('%PDF-1.4\nfine bytes\n');
    const hash = await seed('application/pdf', pdf, 'https://example.test/papers/a%ff.pdf');
    const res = await asset(hash);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="a%ff.pdf"');
  });

  it('leaves every other type as an attachment — the SVG hole stays closed', async () => {
    const hash = await seed();
    expect((await asset(hash)).headers.get('Content-Disposition')).toBe('attachment');
  });
});

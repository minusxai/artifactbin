/**
 * THE PDF TIER at its door — `pdf` (a base64 data: URL) and `pdfUrl` (a public
 * URL imported through web-ingest), the two shapes an agent has.
 *
 * The tier is the image tier's shape with three deliberate differences, each
 * pinned here: the bytes are never re-encoded (a PDF is a document, not a
 * picture we may improve), the cap is its own and much larger, and the byte
 * QUOTA is charged at this door rather than only at the URL cache — a 25 MB
 * upload is the biggest single thing this app stores, and it is the one an
 * account can repeat until the disk is full.
 *
 * What is NOT here: serving. That is __tests__/pdf-serving.test.ts and, for
 * the parts only a socket can answer, server/__tests__/pdf-range.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { samplePdf, samplePdfDataUrl } from '../../../scripts/lib/sample-pdf.mjs';
import { POST as bearerCreate } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import { setAssetByteQuotaForTests } from '@/lib/asset-quota';
import { objectStore } from '@/lib/object-store';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { withHttpServer, type RunningServer } from '@/__tests__/net';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

let web: RunningServer;
let base: string;

beforeAll(async () => {
  web = await withHttpServer((req, res) => {
    switch (req.url) {
      case '/paper.pdf':
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end(samplePdf(3));
        return;
      case '/lying.pdf':
        // A dead link's html error page behind a .pdf address: the bytes win.
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end('<!doctype html><h1>404</h1>');
        return;
      case '/huge.pdf':
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end(Buffer.concat([samplePdf(1), Buffer.alloc(60_000, 0x20)]));
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  base = web.base;
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  await web.close();
});

beforeEach(() => setAssetByteQuotaForTests(null));

const create = (token: string, body: Record<string, unknown>) =>
  bearerCreate(request('/api/artifacts', { method: 'POST', token, json: body }));

describe('a PDF as a data: URL', () => {
  it('is stored as its own format, with the object key, the bytes and the page count in meta', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { title: 'The paper', pdf: samplePdfDataUrl(3) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.format).toBe('pdf');

    const row = (await getArtifactById(body.id))!;
    expect(row.format).toBe('pdf');
    // `content` stays empty: the bytes live in the object store, like every
    // other tier that is measured in megabytes.
    expect(row.content).toBe('');
    const meta = row.meta as { objectKey: string; bytes: number; pages?: number; contentType: string };
    expect(meta.contentType).toBe('application/pdf');
    expect(meta.bytes).toBe(samplePdf(3).byteLength);
    expect(meta.pages).toBe(3);
    expect(Buffer.compare(await objectStore().get(meta.objectKey), samplePdf(3))).toBe(0);
  });

  it('is content-addressed: the same paper twice costs one object', async () => {
    const t = await mintToken('t');
    const one = await (await create(t.token, { pdf: samplePdfDataUrl(2) })).json();
    const two = await (await create(t.token, { pdf: samplePdfDataUrl(2) })).json();
    const keyOf = async (id: string) => ((await getArtifactById(id))!.meta as { objectKey: string }).objectKey;
    expect(await keyOf(one.id)).toBe(await keyOf(two.id));
  });

  it('is born UNLISTED for an account, like an image and a dataset', async () => {
    // A born-private asset bakes a 404 into every document that links it, and a
    // PDF is exactly such an asset: the document names it, the reader opens it.
    const user = await createUser({ email: 'pdf-owner@example.com' });
    const t = await mintToken('t', user.id);
    const { id } = await (await create(t.token, { pdf: samplePdfDataUrl(1) })).json();
    expect((await getArtifactById(id))!.visibility).toBe('unlisted');
  });

  it('omits the page count when the file does not say it in the clear, rather than guessing', async () => {
    // Most modern PDFs keep their page objects inside a compressed object
    // stream, where a cheap scan finds nothing. "Cheap or absent" is the rule;
    // a made-up number would be worse than no number.
    const t = await mintToken('t');
    const opaque = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('binary object stream, nothing literal here')]);
    const { id } = await (await create(t.token, { pdf: `data:application/pdf;base64,${opaque.toString('base64')}` })).json();
    const meta = (await getArtifactById(id))!.meta as { pages?: number };
    expect(meta.pages).toBeUndefined();
  });

  it('refuses bytes that are not a PDF, whatever the data: URL claims', async () => {
    const t = await mintToken('t');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await create(t.token, { pdf: `data:application/pdf;base64,${png.toString('base64')}` });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_pdf');
  });

  it('refuses a data: URL of the wrong shape by name', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { pdf: 'https://example.com/a.pdf' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_pdf');
  });

  it('refuses a file over the cap with the cap named', async () => {
    const t = await mintToken('t');
    // PDF__MAX_BYTES is 20000 in the suite (vitest.config.ts), the way
    // IMAGES__MAX_BYTES is 5000: the mechanism is the same at any threshold.
    const big = Buffer.concat([samplePdf(1), Buffer.alloc(30_000, 0x20)]);
    const res = await create(t.token, { pdf: `data:application/pdf;base64,${big.toString('base64')}` });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'pdf_too_large', maxBytes: 20_000 });
  });

  it('refuses an account already over its stored-byte quota', async () => {
    const t = await mintToken('t');
    setAssetByteQuotaForTests(1);
    const first = await create(t.token, { pdf: samplePdfDataUrl(1) });
    // The cap is a PRE-check, not a reservation (the same rule importWebAsset
    // ships): an account under the cap stores its file and is refused the NEXT
    // one. So the first upload lands and the second is the one that pays.
    expect(first.status).toBe(201);
    const second = await create(t.token, { pdf: samplePdfDataUrl(1) });
    expect(second.status).toBe(403);
    expect((await second.json()).error).toBe('quota_exceeded');
  });
});

describe('a PDF by URL', () => {
  it('is fetched through the web-ingest guard and stored as our own copy', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { pdfUrl: `${base}/paper.pdf` });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const row = (await getArtifactById(id))!;
    const meta = row.meta as { bytes: number; pages?: number; sourceUrl?: string };
    expect(meta.bytes).toBe(samplePdf(3).byteLength);
    expect(meta.pages).toBe(3);
    // Provenance: an import is a snapshot, and where it came from stays answerable.
    expect(meta.sourceUrl).toBe(`${base}/paper.pdf`);
    // A serviceable default title from the file name, as the image importer does.
    expect(row.title).toBe('paper');
  });

  it('refuses a URL that answers with something else — a dead link often serves html', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { pdfUrl: `${base}/lying.pdf` });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'pdf_fetch_failed', code: 'unsupported_type' });
  });

  it('refuses a URL over the cap without reading it whole', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { pdfUrl: `${base}/huge.pdf` });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('pdf_fetch_failed');
  });

  it('refuses a URL that is not on the public internet, like every other import', async () => {
    setWebIngestPolicyForTests(null);
    try {
      const t = await mintToken('t');
      const res = await create(t.token, { pdfUrl: 'http://127.0.0.1:1/secret.pdf' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('pdf_fetch_failed');
    } finally {
      setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
    }
  });
});

describe('the one-of rule', () => {
  it('a pdf beside a markup is refused, like every other pair', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: '<div><p>x</p></div>', pdf: samplePdfDataUrl(1) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/one_of/);
  });
});

/**
 * `<File>` — the one position in a document that names a PDF.
 *
 * A CARD, not an embed: the title, the size and the page count under a link
 * that opens the file in a new tab. That shape is what the spike measured
 * working (S4) — with the served document's own sandbox flags
 * (`allow-popups allow-popups-to-escape-sandbox`) and a REAL click, the popup
 * opened at the PDF and the browser's own viewer rendered it — and it needs no
 * CSP change at all, because a link is navigation rather than a subresource.
 *
 * The position has to be taught to FOUR tables that each know where an asset
 * can appear, and forgetting one is invisible until a reader opens a document:
 * refs.ts (what a `ref:` there must resolve to), external-images.ts (what a
 * publish imports), asset-url.ts (what a reader is served) and ref-data.ts
 * (what the card is told). One assertion each, so a table left behind is red.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { samplePdf, samplePdfDataUrl } from '../../../scripts/lib/sample-pdf.mjs';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { assetUrlFor } from '@/lib/story/asset-url';
import { collectExternalAssetUrls } from '@/lib/story/external-images';
import { mintToken } from '@/lib/tokens';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { request, useAppHarness } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@/__tests__/net';

useAppHarness();

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);

let server: RunningServer;
let web: string;

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    switch (req.url) {
      case '/report.pdf': res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(samplePdf(2)); return;
      case '/gone.pdf': res.writeHead(404); res.end(); return;
      default: res.writeHead(500); res.end();
    }
  });
  web = server.base;
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  await server.close();
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const create = (token: string, body: Record<string, unknown>) =>
  createArtifact(request('/api/artifacts', { method: 'POST', token, json: body }));

/** Publish a PDF and a document that links it; answer both ids and the served html. */
async function withFileCard(markupFor: (pdfId: string) => string) {
  const t = await mintToken('t');
  const pdf = await (await create(t.token, { title: 'Q3 results', pdf: samplePdfDataUrl(3) })).json();
  const doc = await create(t.token, { title: 'The memo', markup: markupFor(pdf.id), visibility: 'public' });
  return { t, pdf, doc };
}

describe('a ref: to a PDF', () => {
  it('renders a card carrying the name, the size, the page count and a new-tab link to the file', async () => {
    const { pdf, doc } = await withFileCard((id) => `<div data-design="tw" className="p-8"><File src="ref:${id}" /></div>`);
    expect(doc.status).toBe(201);
    const { id } = await doc.json();

    const html = await (await rawRoute(request(`/a/${id}/raw`), params(id))).text();
    expect(html).toContain('Q3 results');
    expect(html).toContain('3 pages');
    // The size the store recorded, as a person reads it.
    expect(html).toMatch(/1\.1 kB|1,116|1116/);
    // The link is the FILE, at its versioned address, opening in a new tab —
    // the document's sandbox allows the popup, and a real click is what the
    // spike measured opening the viewer.
    expect(html).toContain(`href="/a/${pdf.id}/raw?v=1"`);
    expect(html).toContain('target="_blank"');
  });

  it('lets the author name the file themselves', async () => {
    const { doc } = await withFileCard((id) => `<div data-design="tw"><File src="ref:${id}" title="Download the report" /></div>`);
    const { id } = await doc.json();
    const html = await (await rawRoute(request(`/a/${id}/raw`), params(id))).text();
    expect(html).toContain('Download the report');
  });

  it('refuses a ref of the wrong kind in that position, by name', async () => {
    const t = await mintToken('t');
    const image = await (await create(t.token, { image: `data:image/png;base64,${PNG.toString('base64')}` })).json();
    const res = await create(t.token, { markup: `<div data-design="tw"><File src="ref:${image.id}" /></div>` });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_refs');
    expect(body.details.join(' ')).toContain('this position needs a pdf');
  });

  it('refuses a <File> with no src, rather than publishing a card that resolves to nothing', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: '<div data-design="tw"><File title="A report" /></div>' });
    expect(res.status).toBe(400);
    // The jsx door's details are spans, not strings (lib/jsx ValidationError).
    expect(JSON.stringify((await res.json()).details)).toContain('src=\\"ref:<pdf id>\\"');
  });

  it('degrades to a card with no link when the file is deleted after publishing', async () => {
    // The ref string is never handed to the DOM as a URL. An unresolvable ref
    // is refused at publish, so this path is only reachable afterwards — and
    // then the card must say the file is gone rather than link to a 404.
    const { pdf, doc } = await withFileCard((fileId) => `<div data-design="tw"><File src="ref:${fileId}" /></div>`);
    const { id } = await doc.json();
    const db = await getDb();
    await db.query('delete from artifacts where id = $1', [pdf.id]);

    const html = await (await rawRoute(request(`/a/${id}/raw`), params(id))).text();
    expect(html).toContain('file unavailable');
    expect(html).not.toContain(`href="/a/${pdf.id}/raw`);
    // The island still carries the author's `ref:` string — that is the source
    // of truth every write-back round-trips. What must never happen is that
    // string reaching the DOM as a URL, which is the assertion above.
  });
});

describe('a web URL in the same position', () => {
  it('is collected, imported at publish, kept verbatim in storage and served from our origin', async () => {
    const t = await mintToken('t');
    const url = `${web}/report.pdf`;
    const source = `<div data-design="tw" className="p-8"><File src="${url}" title="The report" /></div>`;

    // 1. the pure collector sees it (lib/story/external-images)
    expect(collectExternalAssetUrls(source).pdfs).toEqual([url]);

    const res = await create(t.token, { markup: source, visibility: 'public' });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    // 2. one row in the global cache, typed from the bytes
    const db = await getDb();
    const rows = await db.query<{ content_type: string; bytes: number }>('select content_type, bytes from web_assets where url = $1', [url]);
    expect(rows.rows[0]?.content_type).toBe('application/pdf');
    expect(rows.rows[0]?.bytes).toBe(samplePdf(2).byteLength);

    // 3. the URL the author wrote is what the author reads back
    expect((await getArtifactById(id))!.source).toContain(url);

    // 4. …and the reader is served OUR copy (lib/story/asset-url)
    const html = await (await rawRoute(request(`/a/${id}/raw`), params(id))).text();
    expect(html).toContain(`href="${assetUrlFor(url)}"`);
    expect(html).not.toContain(url);
  });

  it('reports a URL it cannot fetch as a warning and publishes anyway', async () => {
    const t = await mintToken('t');
    const url = `${web}/gone.pdf`;
    const res = await create(t.token, { markup: `<div data-design="tw"><File src="${url}" /></div>`, visibility: 'public' });
    expect(res.status).toBe(201);
    const body = await res.json();
    // Losing a whole document over one dead link is the worse answer — the
    // milestone-1 rule, and the same warning shape.
    const warnings = (body.asset_warnings ?? body.warnings) as Array<{ code: string; url: string; fix: string }>;
    expect(warnings.map((w) => w.url)).toContain(url);
    expect(warnings.find((w) => w.url === url)!.code).toBe('bad_status');
  });
});

/**
 * SERVING A PDF from `/a/<id>/raw` — the shape the spike measured and the only
 * one it recommends (S4): `application/pdf`, `Content-Disposition: inline`,
 * `Content-Security-Policy: sandbox`, `nosniff`, immutable by version.
 *
 * What each header is for, since four of the five look like decoration:
 *  - `inline` is what makes the browser's own viewer RENDER it. `attachment`
 *    was measured doing nothing at all when opened from inside a document's
 *    sandbox — neither a popup nor a download — so it is the one shape a file
 *    card must not use.
 *  - `sandbox` is what makes that render cost the app origin nothing: measured
 *    headful, the response context is opaque (`window.origin === "null"`) and
 *    both localStorage and document.cookie throw. It does NOT stop the viewer.
 *  - `nosniff` holds the browser to the type we sniffed from the bytes.
 *  - the read ACL is every other artifact's, with the same uniform 404.
 *
 * Headless Chromium ships no PDF viewer and downloads every shape identically,
 * so the fact that it RENDERS is a headful, by-hand check — stated as such in
 * scripts/gate-pdf.mjs and in the report. What a test can hold is everything
 * else, and that is this file.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { samplePdf, samplePdfDataUrl } from '../../../scripts/lib/sample-pdf.mjs';
import { GET as serveRaw, HEAD as headRaw } from '@/app/a/[id]/raw/route';
import { POST as bearerCreate } from '@/app/api/artifacts/route';
import { pdfFilename } from '@/lib/story/pdf-store';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { agentCookie, request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });

// A token per call: the harness wipes every table between tests, so one minted
// in a beforeAll would be a 401 by the time a test used it.
const create = async (body: Record<string, unknown>, token?: string): Promise<string> => {
  const bearer = token ?? (await mintToken('t')).token;
  const res = await bearerCreate(request('/api/artifacts', { method: 'POST', token: bearer, json: body }));
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
};

const bytesOf = async (res: Response): Promise<Buffer> => Buffer.from(await res.arrayBuffer());

describe('the five headers', () => {
  it('serves the bytes as an inline, sandboxed, nosniff PDF named after the document', async () => {
    const id = await create({ title: 'Q3 results', pdf: samplePdfDataUrl(3) });
    const res = await serveRaw(request(`/a/${id}/raw`), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="Q3 results.pdf"');
    expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(Buffer.compare(await bytesOf(res), samplePdf(3))).toBe(0);
  });

  it('caches immutably only at a versioned address', async () => {
    const id = await create({ title: 'Paper', pdf: samplePdfDataUrl(1) });
    // A bare URL might be replaced under the same id, so it gets a short window;
    // `?v=<version>` changes when the bytes do, so it is genuinely immutable.
    // The same rule the image tier serves under.
    const bare = await serveRaw(request(`/a/${id}/raw`), params(id));
    expect(bare.headers.get('Cache-Control')).toBe('public, max-age=300');
    const versioned = await serveRaw(request(`/a/${id}/raw?v=1`), params(id));
    expect(versioned.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('builds the filename fresh, and never lets a title break the header', () => {
    // A title is author input and this header is quoted: a quote or a newline
    // in it would end the value early. The id is the floor.
    expect(pdfFilename('Q3 results', 'aB3xK9')).toBe('Q3 results.pdf');
    expect(pdfFilename('say "hi"\r\nX-Evil: 1', 'aB3xK9')).toBe('say hi X-Evil: 1.pdf');
    expect(pdfFilename('', 'aB3xK9')).toBe('aB3xK9.pdf');
    expect(pdfFilename('  ', 'aB3xK9')).toBe('aB3xK9.pdf');
    expect(pdfFilename('Q3 résultats', 'aB3xK9')).toBe('Q3 r sultats.pdf');
  });
});

describe('the read ACL', () => {
  it('answers the uniform 404 to a stranger, and the bytes to the owner', async () => {
    const user = await createUser({ email: 'pdf-acl@example.com' });
    const owner = await mintToken('own', user.id);
    const id = await create({ title: 'Private paper', pdf: samplePdfDataUrl(1), visibility: 'private' }, owner.token);

    const stranger = await serveRaw(request(`/a/${id}/raw`), params(id));
    expect(stranger.status).toBe(404);
    expect(stranger.headers.get('Content-Type')).toBe('text/html; charset=utf-8');

    // The serving routes decide who is reading with sessionActor — a session or
    // the agent cookie, never a bearer header (lib/viewer), so the owner reads
    // their own file the way their browser would.
    const asOwner = await serveRaw(request(`/a/${id}/raw`, { cookie: await agentCookie([owner.id]) }), params(id));
    expect(asOwner.status).toBe(200);
    expect(Buffer.compare(await bytesOf(asOwner), samplePdf(1))).toBe(0);
  });
});

describe('HEAD', () => {
  it('answers the same headers with no body — what a viewer asks before it seeks', async () => {
    const id = await create({ title: 'Long paper', pdf: samplePdfDataUrl(3) });
    const head = await headRaw(request(`/a/${id}/raw`, { method: 'HEAD' }), params(id));
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toBe('application/pdf');
    expect(head.headers.get('Content-Length')).toBe(String(samplePdf(3).byteLength));
    expect(head.headers.get('Accept-Ranges')).toBe('bytes');
    expect(head.body).toBeNull();
  });

  it('is refused for a document the reader may not see, like GET', async () => {
    const user = await createUser({ email: 'pdf-head@example.com' });
    const owner = await mintToken('own', user.id);
    const id = await create({ pdf: samplePdfDataUrl(1), visibility: 'private' }, owner.token);
    expect((await headRaw(request(`/a/${id}/raw`, { method: 'HEAD' }), params(id))).status).toBe(404);
  });
});

describe('Range', () => {
  let pdfId: string;
  beforeEach(async () => { pdfId = await create({ title: 'Ranged', pdf: samplePdfDataUrl(2) }); });

  const ranged = (range: string) =>
    serveRaw(request(`/a/${pdfId}/raw`, { headers: { range } }), params(pdfId));

  it('answers 206 with exactly the bytes asked for', async () => {
    const whole = samplePdf(2);
    const res = await ranged('bytes=10-19');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 10-19/${whole.byteLength}`);
    expect(res.headers.get('Content-Length')).toBe('10');
    expect(Buffer.compare(await bytesOf(res), whole.subarray(10, 20))).toBe(0);
  });

  it('takes an open-ended range to the last byte', async () => {
    const whole = samplePdf(2);
    const res = await ranged(`bytes=${whole.byteLength - 5}-`);
    expect(res.status).toBe(206);
    expect(Buffer.compare(await bytesOf(res), whole.subarray(whole.byteLength - 5))).toBe(0);
  });

  it('takes a suffix range — the last N bytes, where a PDF keeps its xref table', async () => {
    const whole = samplePdf(2);
    const res = await ranged('bytes=-20');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes ${whole.byteLength - 20}-${whole.byteLength - 1}/${whole.byteLength}`);
    expect(Buffer.compare(await bytesOf(res), whole.subarray(whole.byteLength - 20))).toBe(0);
  });

  it('clamps a range that runs past the end rather than refusing it', async () => {
    const whole = samplePdf(2);
    const res = await ranged('bytes=0-999999');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-${whole.byteLength - 1}/${whole.byteLength}`);
  });

  it('answers 416 when the range starts past the end, naming the size', async () => {
    const whole = samplePdf(2);
    const res = await ranged('bytes=999999-1000000');
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe(`bytes */${whole.byteLength}`);
  });

  it('ignores a header it does not understand and serves the whole file', async () => {
    // A malformed or multi-range header is not an error: 200 with everything is
    // always a correct answer to a Range request, and a viewer handles it.
    for (const header of ['bytes=abc', 'items=0-10', 'bytes=0-10,20-30', 'bytes=']) {
      const res = await ranged(header);
      expect(res.status, header).toBe(200);
      expect((await bytesOf(res)).byteLength, header).toBe(samplePdf(2).byteLength);
    }
  });
});

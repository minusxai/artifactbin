/**
 * Gate: a PDF a document links is reachable, from a real browser, by a stranger.
 *
 * WHAT A HEADLESS BROWSER CANNOT ANSWER, stated plainly because it is the most
 * useful thing this gate knows (spike S4, R12): headless Chromium ships NO PDF
 * viewer. It downloads every `application/pdf` response identically, whatever
 * the headers say, so `inline` and `attachment` look the same here and nothing
 * in this file proves a PDF RENDERS. That check is headful and by hand; the
 * report says so and says what was seen.
 *
 * What only a browser CAN answer, and this gate does:
 *  1. the card is in the document a STRANGER is served — not the owner's shell,
 *     the reader's own top-level document, which is where a File card lives or
 *     dies,
 *  2. a REAL click on it opens a popup at the file's own address. A programmatic
 *     click opens nothing (measured), so the click has to be a click: this is
 *     the whole reason the card is a link and not a button.
 *  3. the popup's response carries the five headers, and the download filename
 *     comes from `Content-Disposition` rather than from the URL — which IS
 *     assertable headlessly and is proof the header was honoured,
 *  4. a Range request over the same socket answers 206 with the right bytes,
 *     which is what a viewer does before it renders page one of a long file.
 *
 *   usage: node scripts/gate-pdf.mjs [base]
 */
import { chromium } from 'playwright';
import { samplePdf } from './lib/sample-pdf.mjs';
import { startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

const PDF = samplePdf(3);

const owner = await startDocument(B);
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` };

// 1. the file itself
const fileRes = await fetch(`${B}/api/artifacts`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ title: 'Quarterly review', pdf: `data:application/pdf;base64,${PDF.toString('base64')}`, visibility: 'public' }),
});
const file = await fileRes.json();
if (fileRes.status !== 201) {
  console.error(`could not publish the pdf (${fileRes.status} ${JSON.stringify(file)})`);
  process.exit(2);
}
ok(file.format === 'pdf', `the file is stored as a pdf (${file.format})`);
ok(file.pages === 3, `the page count was read from the file (${file.pages})`);

// 2. the document that links it, published PUBLIC so a stranger may read it
const markup = '<div data-design="tw" className="@container p-10">'
  + '<h1 className="text-3xl font-bold">The review</h1>'
  + `<File src="ref:${file.id}" />`
  + '</div>';
const put = await fetch(`${B}/api/artifacts/${owner.id}`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ title: 'The review', markup, visibility: 'public' }),
});
const wrote = await put.json();
if (put.status !== 200) {
  console.error(`could not publish the document (${put.status} ${JSON.stringify(wrote)})`);
  process.exit(2);
}

const browser = await chromium.launch();
// A STRANGER: a fresh context with no session, which is served the document
// itself at /a/<id> rather than the owner's shell.
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
await page.goto(`${B}/a/${owner.id}`, { waitUntil: 'networkidle' });

const card = await page.evaluate(() => {
  const el = document.querySelector('[data-slot="file"]');
  const link = document.querySelector('[data-slot="file-link"]');
  return {
    text: el ? (el.textContent ?? '') : null,
    href: link ? link.getAttribute('href') : null,
    target: link ? link.getAttribute('target') : null,
  };
});
ok(card.text !== null, 'the reader is served a file card');
ok((card.text ?? '').includes('Quarterly review'), `the card names the file (${JSON.stringify(card.text)})`);
ok((card.text ?? '').includes('3 pages'), 'the card says how long the file is');
ok(/kB|bytes|MB/.test(card.text ?? ''), 'the card says how big the file is');
ok(card.href === `/a/${file.id}/raw?v=1`, `the card links the file itself (${card.href})`);
ok(card.target === '_blank', 'the link opens in a new tab');

/*
 * A REAL CLICK. The document is sandboxed with allow-popups and
 * allow-popups-to-escape-sandbox, and the spike measured that a popup opens
 * only with genuine user activation — a programmatic .click() opened nothing.
 * So this is a mouse click on the element's own box, and what it produces is
 * either a popup page or a download; headless Chromium always chooses the
 * download for application/pdf, which is why both are accepted here.
 */
// Every request the whole context makes, so the address the click reached is
// readable even when the popup becomes a download (headless always downloads a
// PDF, and a download that began in a sandboxed context reports no url).
const asked = [];
context.on('request', (r) => asked.push(r.url()));
const [popup, download] = await Promise.all([
  page.waitForEvent('popup', { timeout: 8_000 }).catch(() => null),
  page.waitForEvent('download', { timeout: 8_000 }).catch(() => null),
  page.click('[data-slot="file-link"]'),
]);
ok(popup !== null || download !== null, 'a real click opened the file');
ok(asked.some((u) => u.endsWith(`/a/${file.id}/raw?v=1`)),
  `…at the file's own address (${JSON.stringify(asked.slice(-3))})`);
if (download) {
  // The name the browser would save it under: `Quarterly review.pdf` comes from
  // Content-Disposition, `raw.pdf` or `raw` would be the URL's own last
  // segment. This is the one thing headless CAN say about that header.
  ok(download.suggestedFilename() === 'Quarterly review.pdf',
    `the download is named by Content-Disposition, not by the URL (${download.suggestedFilename()})`);
} else {
  ok(true, 'the popup rendered rather than downloading — a viewer is present (headful)');
}

/*
 * The headers as the wire carries them — through the CONTEXT's own request
 * client, not `fetch` inside the page. The reader's page IS the sandboxed
 * document, whose CSP is `default-src 'none'` with a connect-src naming only
 * its own three endpoints, so a fetch from in there is refused. (Which is
 * itself the design working, and cost this gate one rewrite.)
 */
const res = await context.request.get(`${B}/a/${file.id}/raw?v=1`);
const headers = {
  status: res.status(),
  type: res.headers()['content-type'],
  disposition: res.headers()['content-disposition'],
  csp: res.headers()['content-security-policy'],
  nosniff: res.headers()['x-content-type-options'],
  ranges: res.headers()['accept-ranges'],
  cache: res.headers()['cache-control'],
  length: (await res.body()).byteLength,
};
ok(headers.type === 'application/pdf', `served as application/pdf (${headers.type})`);
ok(headers.disposition === 'inline; filename="Quarterly review.pdf"', `inline, named after the document (${headers.disposition})`);
ok(headers.csp === 'sandbox', `sandboxed, so the response context is opaque (${headers.csp})`);
ok(headers.nosniff === 'nosniff', 'nosniff holds the browser to the type we sniffed');
ok(headers.ranges === 'bytes', 'ranges are served, so a viewer can seek');
ok((headers.cache ?? '').includes('immutable'), `the versioned address is immutable (${headers.cache})`);
ok(headers.length === PDF.byteLength, `the whole file arrived (${headers.length} of ${PDF.byteLength})`);

// A SEEK: the last 32 bytes, which is where a viewer starts (the xref table).
const seekRes = await context.request.get(`${B}/a/${file.id}/raw?v=1`, { headers: { Range: 'bytes=-32' } });
const seek = {
  status: seekRes.status(),
  range: seekRes.headers()['content-range'],
  bytes: (await seekRes.body()).toString('latin1'),
};
ok(seek.status === 206, `a range request is answered 206 (${seek.status})`);
ok(seek.range === `bytes ${PDF.byteLength - 32}-${PDF.byteLength - 1}/${PDF.byteLength}`, `…with the right range (${seek.range})`);
ok(seek.bytes === PDF.subarray(PDF.byteLength - 32).toString('latin1'), 'the bytes are the file\'s own last 32');

// The document's CSP is UNCHANGED by any of this: a link is navigation, and
// nothing here asked for a new connect-src, frame-src or object-src.
const docCsp = (await context.request.get(`${B}/a/${owner.id}`)).headers()['content-security-policy'];
ok(!/object-src|frame-src/.test(docCsp ?? ''), 'the document needed no new CSP allowance for the card');

await context.close();
await browser.close();

const failed = out.filter((l) => l.startsWith('FAIL'));
console.log(failed.length ? `\n${failed.length} failed` : '\nall ok');
console.log('NOTE: headless Chromium has no PDF viewer, so nothing above proves the file RENDERS — that check is headful and by hand.');
process.exit(failed.length ? 1 : 0);

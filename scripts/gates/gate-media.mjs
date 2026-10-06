/**
 * Gate: MEDIA — files, images and web URLs in a document, from the author's hand to a stranger's browser, as one
 * walk over the three ways media gets in: a stored file, a web URL as written, and a picture a person adds.
 *
 *   1. A FILE (was gate-pdf): a stored PDF linked by `<File src="ref:…">` is a card in the document a STRANGER is
 *      served; a REAL click opens the file's own address and the download is named by Content-Disposition; the
 *      bytes are sandboxed and nosniff; the card widens no part of the document's policy.
 *   2. WEB URLS (was gate-web-assets): publish copies nothing and serves the URLs as written; a held copy made by
 *      the view-time door is no page in our origin (attachment, sandbox, nosniff); a refresh moves it to the new
 *      bytes; the editor's insert-by-URL door; a URL BOUND to a reader's choice imports once, paints from /assets,
 *      refuses the metadata address and a `data:` value, and a private document's door is the uniform 404 to a
 *      stranger while its owner and an invited viewer see the picture.
 *   3. A PICTURE A PERSON ADDS (was gate-image-upload): the file picker, a drop, a paste and a REAL keystroke paste
 *      (the system clipboard, so this gate is in the clipboard serial group) all insert an image that PAINTS and
 *      persists; a ref: image shows its blur while the bytes travel; dropping or pasting onto an image replaces it
 *      and keeps the node.
 *
 * What left, and where it lives now:
 *   - the PDF's type, Content-Disposition, Accept-Ranges, immutable cache, length and 206 range answers (pdf
 *     152–153, 156–158, 160–169) → services/app/__tests__/pdf-serving.test.ts ("the five headers") and
 *     services/app/server/__tests__/pdf-range.test.ts; the sandbox and nosniff headers stay here verbatim;
 *   - the export PNG of a document with an uploaded image (image-upload 199–203) → the exports journey gate, which
 *     holds one PNG set for the suite.
 *
 *   usage: node scripts/gates/gate-media.mjs [base]
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { launchChromium, PAGES_HOST } from './lib/browser.mjs';
import { documentFrame, documentFrame as framedDocument, INLINE_STORY } from './lib/page-facts.mjs';
import { checkWebImport } from './lib/web-import-cases.mjs';
import { samplePdf } from '../lib/sample-pdf.mjs';
import { becomeOwner, publishAs, startDocument } from '../lib/start-doc.mjs';
import { loginViaEmail, startMailSink } from '../lib/mail-login.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('media');
/** One leg's failure is reported and the walk goes on, so a run names every broken leg at once. */
const section = async (name, run) => {
  console.log(`█ ${name}`);
  try { await run(); } catch (error) { check(false, `${name}: the leg threw (${String(error?.message ?? error).split('\n')[0].slice(0, 300)})`); }
};

const browser = await launchChromium();

// ── 1. a stored PDF, read by a stranger (was gate-pdf) ──
await section('file', async () => {
  const B = BASE;
  const PDF = samplePdf(3);

  const owner = await startDocument(B);
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` };
  const plainRes = await fetch(`${B}/api/artifacts`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ title: 'Plain CSP control', markup: '<p>Plain document</p>', visibility: 'public' }),
  });
  if (plainRes.status !== 201) throw new Error(`plain control publish failed: ${plainRes.status}`);
  const plain = await plainRes.json();
  /** A document's own origin, where its page and its policy are served (lib/serving/pages-origin): `<hex id>.lvh.me`. */
  const documentOrigin = (id) => `http://${Buffer.from(id, 'utf8').toString('hex')}.${PAGES_HOST}:${new URL(B).port}`;
  const plainCsp = (await fetch(`${documentOrigin(plain.id)}/`)).headers.get('content-security-policy');

  // 1. the file itself
  const fileRes = await fetch(`${B}/api/artifacts`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: 'Quarterly review', pdf: `data:application/pdf;base64,${PDF.toString('base64')}`, visibility: 'public' }),
  });
  const file = await fileRes.json();
  if (fileRes.status !== 201) {
    console.error(`could not publish the pdf (${fileRes.status} ${JSON.stringify(file)})`);
    throw new Error('the pdf fixture could not be published');
  }
  check(file.format === 'pdf', `the file is stored as a pdf (${file.format})`);
  check(file.pages === 3, `the page count was read from the file (${file.pages})`);

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
    throw new Error('the pdf fixture could not be published');
  }

  // A STRANGER: a fresh context with no session. The app page frames the
  // document on its own origin; the card is in that frame.
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(`${B}/a/${owner.id}`, { waitUntil: 'networkidle' });
  const doc = await documentFrame(page);
  await doc.waitForSelector('[data-slot="file"]', { timeout: 20_000 }).catch(() => {}); // a missing card fails below

  const card = await doc.evaluate(() => {
    const el = document.querySelector('[data-slot="file"]');
    const link = document.querySelector('[data-slot="file-link"]');
    return {
      text: el ? (el.textContent ?? '') : null,
      href: link ? link.getAttribute('href') : null,
      target: link ? link.getAttribute('target') : null,
    };
  });
  check(card.text !== null, 'the reader is served a file card');
  check((card.text ?? '').includes('Quarterly review'), `the card names the file (${JSON.stringify(card.text)})`);
  check((card.text ?? '').includes('3 pages'), 'the card says how long the file is');
  check(/kB|bytes|MB/.test(card.text ?? ''), 'the card says how big the file is');
  check(card.href === `/a/${file.id}/raw?v=1`, `the card links the file itself (${card.href})`);
  check(card.target === '_blank', 'the link opens in a new tab');

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
    doc.click('[data-slot="file-link"]'),
  ]);
  check(popup !== null || download !== null, 'a real click opened the file');
  check(asked.some((u) => u.endsWith(`/a/${file.id}/raw?v=1`)),
    `…at the file's own address (${JSON.stringify(asked.slice(-3))})`);
  if (download) {
    // The name the browser would save it under: `Quarterly review.pdf` comes from
    // Content-Disposition, `raw.pdf` or `raw` would be the URL's own last
    // segment. This is the one thing headless CAN say about that header.
    check(download.suggestedFilename() === 'Quarterly review.pdf',
      `the download is named by Content-Disposition, not by the URL (${download.suggestedFilename()})`);
  } else {
    check(true, 'the popup rendered rather than downloading — a viewer is present (headful)');
  }

  /*
   * The headers as the wire carries them — through the CONTEXT's own request
   * client, not `fetch` inside the page. The document's CSP is `default-src
   * 'none'` with a connect-src naming only its own doors, so a fetch from in
   * there is refused. (Which is itself the design working, and cost this gate
   * one rewrite.)
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
  // The type, Content-Disposition, ranges, cache and length are pdf-serving.test.ts' and pdf-range.test.ts'.
  check(headers.csp === 'sandbox', `sandboxed, so the response context is opaque (${headers.csp})`);
  check(headers.nosniff === 'nosniff', 'nosniff holds the browser to the type we sniffed');

  // The document's CSP is UNCHANGED by any of this: a link is navigation, and
  // nothing here asked for a new connect-src, frame-src or object-src.
  // Compared on the documents' own origins, where their policy is served (the app page's is the app's).
  const docCsp = (await context.request.get(`${documentOrigin(owner.id)}/`)).headers()['content-security-policy'];
  // A File card must not widen that policy or enable a PDF/object embed.
  check(Boolean(plainCsp) && docCsp === plainCsp.replaceAll(`/a/${plain.id}/`, `/a/${owner.id}/`).replaceAll(documentOrigin(plain.id), documentOrigin(owner.id)),
    `the document needed no new CSP allowance for the card${docCsp === plainCsp ? '' : ` (${docCsp})`}`);

  await context.close();
  console.log('NOTE: headless Chromium has no PDF viewer, so nothing above proves the file RENDERS — that check is headful and by hand.');
});

// ── 2. web URLs as written, held copies, and URLs bound to a reader's choice (was gate-web-assets) ──
await section('web urls', async () => {
  const B = BASE;
  /** The document's frame on the app page (its own origin), once its story is on screen. */
  async function storyFrame(page) {
    const frame = await documentFrame(page);
    await frame.waitForSelector(INLINE_STORY, { state: 'visible', timeout: 30_000 });
    return frame;
  }

  /* ── the "public web" this gate imports from ─────────────────────────────────
   * Its own port so the count of requests to it is unambiguous: publish must ask
   * it for nothing. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8dMpruoH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1weeF8xbShDdKgAAAABJRU5ErkJggg==',
    'base64',
  );
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c33"/></svg>');
  /* A WIDE photograph — the only shape that earns a second, narrower copy
   * (lib/images/optimise: wider than 960px). Its colour is what a refresh
   * CHANGES, so "the reader got the new bytes" is a pixel, not a header. */
  const wide = (colour) => sharp({ create: { width: 1600, height: 1200, channels: 3, background: colour } })
    .jpeg({ quality: 80 }).toBuffer();
  let wideColour = '#1d6fa5';
  let hits = [];
  const web = createServer((req, res) => {
    hits.push((req.url ?? '').split('?')[0]);
    const path = (req.url ?? '').split('?')[0];
    if (path === '/photo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
    if (path === '/logo.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end(SVG); return; }
    if (path === '/wide.jpg') {
      wide(wideColour).then((b) => { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(b); });
      return;
    }
    // The BOUND leg's pictures (section 6) — the same 48×32 PNG, so "it painted"
    // is a naturalWidth there too.
    if (/^\/pic\d\.png$/.test(path)) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
    res.writeHead(404); res.end();
  });
  // An ephemeral fixture port avoids collisions with other local services.
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
  const WEB = `http://127.0.0.1:${web.address().port}`;
  /*
   * A per-run nonce on every URL. The cache is GLOBAL and keyed by the url, so a
   * second run of this gate against the same database would import nothing and
   * "the source host was asked once" would read zero — the feature working,
   * scored as a failure. Fresh urls make the count mean what it says.
   */
  const RUN = `?run=${Date.now()}`;

  const owner = await startDocument(B);
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` };

  /* ── 1. publish copies nothing ───────────────────────────────────────────── */
  const PHOTO = `${WEB}/photo.png${RUN}`;
  const FACE = `${WEB}/face.woff2${RUN}`;
  const PDF = `${WEB}/report.pdf${RUN}`;
  const HTTPS_IMAGE = `https://images.example.com/chart.png${RUN}`;
  const markup = `<Helmet><style>{\`@font-face{font-family:Probe;src:url(${FACE}) format('woff2')}#typed{font-family:Probe,serif}\`}</style></Helmet>`
    + '<div data-design="tw" className="p-10">'
    + `<img src="${PHOTO}" alt="probe" />`
    + `<img src="${HTTPS_IMAGE}" alt="remote" />`
    + `<File src="${PDF}" title="The report" />`
    + '<p id="typed">hello</p>'
    + '</div>';

  hits = [];
  const put = await fetch(`${B}/api/artifacts/${owner.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ title: 'web assets', markup }) });
  const wrote = await put.json();
  if (put.status !== 200) {
    console.error(`could not publish (${put.status} ${JSON.stringify(wrote)})`);
    throw new Error('the web-assets fixture could not be published');
  }
  check(!('asset_warnings' in wrote), `the push reply carries no asset_warnings (${JSON.stringify(wrote.asset_warnings ?? null)})`);
  check(hits.length === 0, `publish asked the source host for nothing (${hits.join(' ') || 'no requests'})`);

  const stored = await (await fetch(`${B}/api/artifacts/${owner.id}`, { headers: auth })).json();
  for (const url of [PHOTO, HTTPS_IMAGE, PDF, FACE]) check(stored.markup.includes(url), `the stored markup keeps ${url}`);

  /* No row: `/assets/<sha256 of the canonical url>` is the address a held copy
   * would have, and it answers 404 when the row does not exist. */
  const assetPath = (url) => `/assets/${createHash('sha256').update(new URL(url).href).digest('hex')}`;
  for (const url of [PHOTO, HTTPS_IMAGE, PDF, FACE]) {
    const res = await fetch(`${B}${assetPath(url)}`);
    check(res.status === 404, `no stored copy exists for ${url} (${res.status})`);
  }

  const raw = await (await fetch(`${B}/a/${owner.id}/raw`, { headers: { Authorization: `Bearer ${owner.token}` } })).text();
  check(raw.includes(`src="${HTTPS_IMAGE}"`), 'the served document carries the original https image URL');
  check(raw.includes(`src="${PHOTO}"`), 'the served document carries the original image URL');
  check(raw.includes(`href="${PDF}"`), 'the served <File> card links the original URL');
  check(raw.includes(FACE), 'the served stylesheet keeps the original @font-face url');
  check(!/\/assets\/[0-9a-f]{64}/.test(raw), 'the served document names no /assets copy');

  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await becomeOwner(page, B, owner.token);
  await page.goto(`${B}/a/${owner.id}`, { waitUntil: 'networkidle' });
  const frame = await storyFrame(page);
  const probe = await frame.evaluate(async () => {
    const deadline = Date.now() + 8000;
    const shot = () => ({
      src: document.querySelector('img[alt="probe"]')?.getAttribute('src') ?? null,
      remote: document.querySelector('img[alt="remote"]')?.getAttribute('src') ?? null,
      file: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => (h ?? '').includes('/report.pdf')) ?? null,
    });
    while (Date.now() < deadline) {
      const s = shot();
      if (s.src && s.remote && s.file) return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    return shot();
  });
  check(probe.src === PHOTO, `the framed <img> keeps the author's URL (${probe.src})`);
  check(probe.remote === HTTPS_IMAGE, `the framed https <img> keeps the author's URL (${probe.remote})`);
  check(probe.file === PDF, `the framed <File> card links the author's URL (${probe.file})`);
  await page.close();

  /* ── 2. a held copy, made by the view-time door, is not a page in our origin ─ */
  const importForReader = async (url) => {
    const res = await fetch(`${B}/a/${owner.id}/assets?u=${encodeURIComponent(url)}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${owner.token}` } });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, url: body.url ? new URL(body.url, B).href : null };
  };
  const SVG_URL = `${WEB}/logo.svg${RUN}`;
  const svgHeld = await importForReader(SVG_URL);
  check(svgHeld.status === 200 && /\/assets\/[0-9a-f]{64}/.test(svgHeld.url ?? ''), `the view-time door holds the SVG at /assets (${svgHeld.status} ${svgHeld.url})`);
  const svgUrl = svgHeld.url ?? `${B}${assetPath(SVG_URL)}`;
  const bare = await browser.newPage();
  let verdict = 'unknown';
  bare.on('download', () => { verdict = 'download'; });
  try {
    await bare.goto(svgUrl, { waitUntil: 'load', timeout: 10_000 });
    const origin = await bare.evaluate(() => {
      let storage = 'reachable';
      try { window.localStorage.getItem('x'); } catch { storage = 'threw'; }
      return { origin: window.origin, storage };
    });
    verdict = origin.origin === 'null' ? `opaque (storage ${origin.storage})` : `OUR ORIGIN (${origin.origin})`;
  } catch (error) {
    // A download aborts the navigation — the strongest form of the pass.
    verdict = verdict === 'download' ? 'download' : `aborted (${String(error).split('\n')[0]})`;
  }
  check(!verdict.startsWith('OUR ORIGIN'), `a top-level navigation to the stored SVG does not run in this origin: ${verdict}`);
  await bare.close();

  const headers = (await fetch(svgUrl)).headers;
  check(headers.get('content-security-policy') === 'sandbox', 'the asset carries CSP: sandbox');
  check(headers.get('content-disposition') === 'attachment', 'the asset carries Content-Disposition: attachment');
  check(headers.get('x-content-type-options') === 'nosniff', 'the asset carries nosniff');
  check((headers.get('cache-control') ?? '').includes('immutable'), 'the asset is immutable');

  /* ── 3. a refresh repoints a held copy at the source's new bytes ──────────── */
  const WIDE_URL = `${WEB}/wide.jpg${RUN}`;
  const wideHeld = await importForReader(WIDE_URL);
  check(wideHeld.status === 200 && !!wideHeld.url, `the view-time door holds the wide image (${wideHeld.status} ${wideHeld.url})`);
  const bytesAt = async (url) => Buffer.from(await (await fetch(url)).arrayBuffer());
  const wideBefore = wideHeld.url ? await bytesAt(wideHeld.url) : Buffer.alloc(0);
  wideColour = '#b4381f';
  const refreshed = await fetch(`${B}/api/artifacts/assets/refresh`, {
    method: 'POST', headers: auth, body: JSON.stringify({ url: WIDE_URL }),
  });
  const refreshBody = await refreshed.json();
  check(refreshed.status === 200 && (refreshBody.refreshed ?? []).includes(WIDE_URL),
    `refresh re-fetched the changed source (${refreshed.status} ${JSON.stringify(refreshBody).slice(0, 160)})`);
  const wideAfter = wideHeld.url ? await bytesAt(wideHeld.url) : Buffer.alloc(0);
  check(wideBefore.length > 0 && wideAfter.length > 0 && !wideBefore.equals(wideAfter),
    `the held address now serves the refreshed bytes (${wideBefore.length} → ${wideAfter.length} bytes, ${wideBefore.equals(wideAfter) ? 'unchanged' : 'changed'})`);

  await checkWebImport(B, browser, WEB, check);

  /* ── 6. THE OTHER BINDING TIME: a URL that only exists in the READER'S browser ─
   *
   * Everything above is import-at-PUBLISH: the author wrote the URL, so publish
   * could see it. `<img src="$pick">` names one publish cannot — the picture is
   * chosen while somebody is reading, so the document's own endpoint imports it
   * on demand. Same feature, same guarantees, the other end of the clock:
   *
   *  a. publish fetches nothing and the stored markup keeps the BINDING
   *  b. the first pick imports once and paints from `/assets/<hash>`
   *  c. coming back to a URL costs neither the endpoint nor the source host
   *  d. a refused URL (the cloud metadata address; a `data:` value) is MARKED
   *     and carries no src, so the browser draws the author's alt text
   *  e. a PRIVATE document's endpoint is a uniform 404 for a stranger — the
   *     bound that keeps this from being an open image proxy — while its owner
   *     and an invited viewer both see the picture through the page relay
   */
  {
    const RUN_ID = Date.now();
    const ONE = `${WEB}/pic1.png?run=${RUN_ID}`;
    const TWO = `${WEB}/pic2.png?run=${RUN_ID}`;
    /* The cloud metadata address: forbidden by lib/web-ingest's guard even under
     * the development switch that admits loopback, which is why it is the
     * refusal this gate picks rather than a merely dead URL. */
    const BAD = 'http://169.254.169.254/latest/meta-data/x.png';
    /* A `data:` image, which the served document's own `img-src 'self' data:
     * blob:` would happily RENDER, and which used to. The mapping refuses it
     * now: a bound `src` is set by the runtime directly and so goes round the
     * interpreter's dangerous-scheme filter, so what a binding may become is
     * decided by the mapping rather than by whichever policy happens to catch it. */
    const DATA_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjYzMzIi8+PC9zdmc+';

    const bound = await startDocument(B);
    const boundAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${bound.token}` };
    const boundMarkup = `<Helmet><Value name="pick" type="string" default="${ONE}" /></Helmet>`
      + '<div data-design="tw" className="p-10">'
      + '<img src="$pick" alt="the pick" />'
      + '<select value="$pick" aria-label="pick">'
      + `<option value="${ONE}">one</option><option value="${TWO}">two</option>`
      + `<option value="${BAD}">bad</option><option value="${DATA_URL}">data</option>`
      + '</select></div>';

    const boundHitsBefore = hits.length;
    const boundPut = await fetch(`${B}/api/artifacts/${bound.id}`, {
      method: 'PUT', headers: boundAuth, body: JSON.stringify({ title: 'bound assets', markup: boundMarkup }),
    });
    const boundWrote = await boundPut.json();
    if (boundPut.status !== 200) {
      console.error(`could not publish the bound document (${boundPut.status} ${JSON.stringify(boundWrote)})`);
      throw new Error('the bound fixture could not be published');
    }
    check((boundWrote.warnings ?? []).length === 0,
      `bound: publish fetched nothing and warned about nothing (${JSON.stringify(boundWrote.warnings ?? [])})`);
    check(hits.length === boundHitsBefore,
      `bound: the source host was not asked at publish — publish cannot see a bound URL (${hits.length - boundHitsBefore} requests)`);
    const boundStored = await (await fetch(`${B}/api/artifacts/${bound.id}`, { headers: boundAuth })).json();
    check(boundStored.markup.includes('src="$pick"'), 'bound: the stored markup keeps the binding the author wrote');

    // A STRANGER: no session, no adopted token. The app page frames the public
    // document on its own origin, read as nobody: the path a shared link gives someone.
    const reading = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const boundOutbound = [];
    const endpointCalls = [];
    reading.on('request', (r) => {
      if (r.url().startsWith(WEB)) boundOutbound.push(r.url());
      if (r.url().includes(`/a/${bound.id}/assets`)) endpointCalls.push(r.url());
    });
    const waitForImport = (url) => reading.waitForResponse((r) => {
      const address = new URL(r.url());
      return address.pathname === `/a/${bound.id}/assets` && address.searchParams.get('u') === url && r.status() === 200;
    }).then((r) => r.json());
    const firstImport = waitForImport(ONE);
    await reading.goto(`${B}/a/${bound.id}`, { waitUntil: 'networkidle' });
    const readingDoc = await storyFrame(reading);

    /**
     * The `<img>` once it has SETTLED on the URL we are asking about — polled by
     * the address in its src, never by a timer: an `<img>` keeps the pixels of
     * its previous source until the new one decodes, so "has it painted" asked
     * too early is the old picture answering for the new one.
     */
    const shotOf = (expect) => readingDoc.evaluate(async (want) => {
      const deadline = Date.now() + 8000;
      const read = () => {
        const img = document.querySelector('img[alt="the pick"]');
        return {
          src: img?.getAttribute('src') ?? null,
          mark: img?.getAttribute('data-mx-asset') ?? null,
          natural: img ? [img.naturalWidth, img.naturalHeight] : [-1, -1],
          complete: img ? img.complete : false,
        };
      };
      while (Date.now() < deadline) {
        const s = read();
        if (s.src !== null && s.src.includes(want) && s.complete && s.natural[0] > 0) return s;
        await new Promise((r) => setTimeout(r, 100));
      }
      return read();
    }, expect);

    const firstAnswer = await firstImport;
    const firstShot = await shotOf(firstAnswer.url);
    check(/^\/assets\/[0-9a-f]{64}$/.test(firstShot.src ?? '') && firstShot.src === firstAnswer.url,
      `bound: the first import renders the scoped endpoint's cached content address (${firstShot.src})`);
    check(firstShot.natural[0] === 48 && firstShot.natural[1] === 32,
      `bound: it paints at the source's size (${firstShot.natural.join('×')})`);
    check(hits.filter((h) => h === '/pic1.png').length === 1,
      `bound: the source host was asked ONCE for the first picture (${hits.filter((h) => h === '/pic1.png').length})`);

    const secondImport = waitForImport(TWO);
    await readingDoc.selectOption('select[aria-label="pick"]', TWO);
    const secondAnswer = await secondImport;
    const secondShot = await shotOf(secondAnswer.url);
    check(/^\/assets\/[0-9a-f]{64}$/.test(secondShot.src ?? '') && secondShot.src === secondAnswer.url
      && secondShot.src !== firstShot.src,
    `bound: picking another URL renders that import's distinct cached address (${secondShot.src})`);
    check(hits.filter((h) => h === '/pic2.png').length === 1, 'bound: the source host was asked once for the second');

    const beforeReturn = { web: hits.length, endpoint: endpointCalls.length };
    await readingDoc.selectOption('select[aria-label="pick"]', ONE);
    const back = await shotOf('/assets/');
    check(/^\/assets\/[0-9a-f]{64}$/.test(back.src ?? '') && back.natural[0] === 48,
      `bound: coming back renders our copy directly, and it still paints (${back.src})`);
    check(hits.length === beforeReturn.web && endpointCalls.length === beforeReturn.endpoint,
      `bound: neither the source host nor the endpoint was asked again (${hits.length - beforeReturn.web} / ${endpointCalls.length - beforeReturn.endpoint})`);

    const untilRefused = () => readingDoc.evaluate(async () => {
      const deadline = Date.now() + 8000;
      const read = () => {
        const img = document.querySelector('img[alt="the pick"]');
        return {
          src: img?.getAttribute('src') ?? null,
          mark: img?.getAttribute('data-mx-asset') ?? null,
          alt: img?.getAttribute('alt') ?? null,
          natural: img ? img.naturalWidth : -1,
        };
      };
      while (Date.now() < deadline) {
        const s = read();
        if (s.mark === 'refused') return s;
        await new Promise((r) => setTimeout(r, 100));
      }
      return read();
    });
    await readingDoc.selectOption('select[aria-label="pick"]', BAD);
    const refused = await untilRefused();
    check(refused.mark === 'refused' && refused.src === null,
      `bound: a refused URL is marked and carries no src (data-mx-asset=${refused.mark})`);
    check(refused.alt === 'the pick', "bound: the alt text is still the author's, so the browser draws it");
    await readingDoc.selectOption('select[aria-label="pick"]', DATA_URL);
    const dataShot = await untilRefused();
    check(dataShot.mark === 'refused' && dataShot.src === null && dataShot.natural !== 40,
      `bound: a data: value is refused by the MAPPING, not left to the policy (${JSON.stringify(dataShot)})`);

    check(boundOutbound.length === 0, `bound: zero requests from the page to the source host (${boundOutbound.length})`);

    /*
     * THE DEFAULT CASE: a signed-in user's document is born private, so its first
     * reader is its owner, looking at it on the app page. The frame is on the
     * document's own origin and calls its own asset door with the pages session
     * the app page minted for that reader, so the door's read ACL sees the owner
     * and hands back the public address of our copy.
     */
    const sink = await startMailSink();
    const PRIV = `${WEB}/pic3.png?run=${RUN_ID}`;
    const holder = await browser.newPage();
    await loginViaEmail(holder, B, sink, `mxmx_test_boundassets_${RUN_ID}@example.com`);
    // Publication may start a thumbnail render before the reader navigates. Count the
    // one source fetch across publication AND navigation, not after that race starts.
    const beforePriv = hits.filter((h) => h === '/pic3.png').length;
    const mine = await publishAs(holder, {
      title: 'private bound',
      markup: `<Helmet><Value name="pick" type="string" default="${PRIV}" /></Helmet><div><img src="$pick" alt="a" /></div>`,
    });
    const readBack = await holder.evaluate(async (id) => (await fetch(`/api/my/artifacts/${id}`)).json(), mine.id);
    check(readBack.visibility === 'private', `bound: a signed-in user's document is born private (${readBack.visibility})`);

    const paints = (frameOrPage) => frameOrPage.evaluate(async () => {
      const deadline = Date.now() + 15_000;
      const read = () => {
        const img = document.querySelector('img[alt="a"]');
        return {
          src: img?.getAttribute('src') ?? null,
          mark: img?.getAttribute('data-mx-asset') ?? null,
          natural: img ? [img.naturalWidth, img.naturalHeight] : [-1, -1],
        };
      };
      while (Date.now() < deadline) {
        const s = read();
        if (s.natural[0] > 0 || s.mark) return s;
        await new Promise((r) => setTimeout(r, 100));
      }
      return read();
    });

    await holder.goto(`${B}/a/${mine.id}`, { waitUntil: 'networkidle' });
    const owned = await paints(await storyFrame(holder));
    check(owned.natural[0] === 48 && owned.natural[1] === 32,
      `bound: a private document's OWNER sees the picture, imported through its own door (${JSON.stringify(owned)})`);
    check(/^\/assets\/[0-9a-f]{64}$/.test(owned.src ?? ''),
      `bound: and its src is the public content address the door handed back (${owned.src})`);
    check(hits.filter((h) => h === '/pic3.png').length === beforePriv + 1,
      `bound: the source host was asked exactly once for it (before=${beforePriv}, after=${hits.filter(h=>h==='/pic3.png').length})`);
    const listed = await holder.evaluate(async () => (await fetch('/api/my/artifacts')).json());
    check(Array.isArray(listed.artifacts) && listed.artifacts.some((a) => a.id === mine.id),
      'bound: the import created no artifact of its own — the document is still the only one');

    const asStranger = await fetch(`${B}/a/${mine.id}/assets?u=${encodeURIComponent(ONE)}`, { redirect: 'manual' });
    const asStrangerJson = await fetch(`${B}/a/${mine.id}/assets?u=${encodeURIComponent(ONE)}`, { headers: { Accept: 'application/json' } });
    check(asStranger.status === 404 && asStrangerJson.status === 404,
      `bound: a stranger's call to a private document's asset endpoint is the uniform 404, page and JSON alike (${asStranger.status}/${asStrangerJson.status})`);

    const guestEmail = `mxmx_test_boundguest_${RUN_ID}@example.com`;
    const shared = await holder.evaluate(async ([id, email]) => (await fetch(`/api/my/artifacts/${id}/sharing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shares: [{ email, role: 'viewer' }] }),
    })).status, [mine.id, guestEmail]);
    check(shared === 200, `bound: the owner invited a viewer (${shared})`);
    const guest = await browser.newPage();
    await loginViaEmail(guest, B, sink, guestEmail);
    const beforeGuest = hits.filter((h) => h === '/pic3.png').length;
    await guest.goto(`${B}/a/${mine.id}`, { waitUntil: 'networkidle' });
    const seenByGuest = await paints(await storyFrame(guest));
    check(seenByGuest.natural[0] === 48,
      `bound: an INVITED VIEWER of the private document sees the picture too, in the app page's frame (${JSON.stringify(seenByGuest)})`);
    check(hits.filter((h) => h === '/pic3.png').length === beforeGuest,
      'bound: and cost the source host nothing — it was already ours');
    sink.close();
  }
  web.close();
});

// ── 3. a picture a person adds, every way, and replaces (was gate-image-upload) ──
await section('pictures', async () => {
  const B = BASE;
  // A 2×2 red PNG (non-zero dimensions so a real paint is measurable).
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8Dwn4EIwDiqkL4KAcT9GO0U4BxjAAAAAElFTkSuQmCC';
  const PNG_BUF = Buffer.from(PNG_B64, 'base64');

  /** A VALID 48×32 png (the 2×2 above is malformed for sharp; see section 6). */
  const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8dMpruoH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1weeF8xbShDdKgAAAABJRU5ErkJggg==';

  const MARKUP = '<div data-design="tw" className="p-10">'
    + '<h1 className="text-4xl font-bold">Image gate</h1>'
    + '<p className="mt-4 text-lg">Body copy.</p></div>';

  async function mint() {
    const st = await startDocument(B);
    if (!st.id || !st.token) {
      console.error(`cannot start a document (${JSON.stringify(st)}).`
        + '\nThe start_doc door is rate limited per IP, in memory: restart the server to clear it.');
      throw new Error('cannot start a document');
    }
    await fetch(`${B}/api/artifacts/${st.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
      body: JSON.stringify({ title: 'image gate', markup: MARKUP, theme: 'modernist' }),
    });
    return st;
  }

  /**
   * Count <img> that have actually decoded to non-zero pixels.
   *
   * The document — read or edited — is the app page's frame on its own origin,
   * reachable only through the frame API.
   */
  async function paintedImages(page) {
    const countIn = (ctx) => ctx.evaluate(async () => {
      const deadline = Date.now() + 8000;
      const count = () => {
        const own = Array.from(document.querySelectorAll('[data-mx-inline-story] img'));
        // ONLY artifact images: counting any image once made this check pass
        // while a freshly inserted image rendered its literal `ref:<id>` — which
        // is exactly the bug that hid here until gate-web-assets measured properly.
        return own
          .filter((i) => /\/a\/[A-Za-z0-9]+\/raw/.test(i.getAttribute('src') ?? ''))
          .filter((i) => i.complete && i.naturalWidth > 0).length;
      };
      let n = 0;
      while (Date.now() < deadline) { n = count(); if (n > 0) break; await new Promise((r) => setTimeout(r, 100)); }
      return n;
    });

    return countIn(await documentFrame(page));
  }

  async function openEditor(page, st) {
    // A browser's credential is the httpOnly session cookie now, not a
  // localStorage token — and the shell it unlocks belongs to the owner.
  await becomeOwner(page, B, st.token);
    await page.goto(`${B}/a/${st.id}#edit`, { waitUntil: 'load' });
    await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
    await page.waitForTimeout(2500); // canvas mounts after the bar
  }

  /**
   * Dispatch a paste OR drop carrying a File, inside the DOCUMENT's own realm.
   *
   * This has to run in the frame, not the page: editing happens in the served
   * document, on its own origin, so the parent cannot reach `contentDocument` and
   * a page-level dispatch would prove nothing. That unreachability is also why
   * this leg silently asserted nothing for a while — and the feature it covers had
   * in fact been lost. Playwright can evaluate inside a cross-origin frame even
   * though script cannot, which is what makes a real end-to-end assertion possible
   * here.
   */
  async function documentFrame(page) {
    const frame = await framedDocument(page);
    await frame.waitForSelector(INLINE_STORY, { state: 'visible', timeout: 30_000 });
    return frame;
  }

  async function dispatchFileEvent(page, kind, b64) {
    const frame = await documentFrame(page);
    if (!frame) return 'no-frame';
    return frame.evaluate(({ kind, b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'p.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = kind === 'paste'
        ? new ClipboardEvent('paste', { bubbles: true, cancelable: true })
        : new DragEvent('drop', { bubbles: true, cancelable: true });
      // Both are read-only on the constructor in Chromium; define them.
      Object.defineProperty(ev, kind === 'paste' ? 'clipboardData' : 'dataTransfer', { value: dt });
      document.querySelector('[data-mx-inline-story]').dispatchEvent(ev);
      return 'dispatched';
    }, { kind, b64 });
  }

  /*
   * A browser whose clipboard the gate can write. `navigator.clipboard` exists only in a secure context: the app was
   * `localhost` (secure by definition) and is now `app.lvh.me` over http, with the document framed on its own origin
   * (`<hex id>.lvh.me`), so both are named secure for this browser — exactly what `localhost` was — and both are
   * granted the clipboard. Real Chrome where it is installed — the clipboard is what these sections are about, and it
   * is the browser people actually paste in; a machine without it gets Playwright's own full Chromium.
   */
  async function clipboardBrowser(docId) {
    const app = new URL(B);
    const origins = [app.origin, `${app.protocol}//${Buffer.from(docId, 'utf8').toString('hex')}.${PAGES_HOST}${app.port ? `:${app.port}` : ''}`];
    const args = [`--unsafely-treat-insecure-origin-as-secure=${origins.join(',')}`];
    // The full browser, never the headless shell: the shell ignores the secure-origin switch.
    const chrome = await launchChromium({ channel: 'chrome', headless: true, args })
      .catch(() => launchChromium({ channel: 'chromium', headless: true, args }));
    const context = await chrome.newContext({ viewport: { width: 1280, height: 900 } });
    for (const origin of origins) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    return { chrome, context };
  }

  /** Write the clipboard from the app page, focused first: a click into the document's frame left the focus there. */
  async function writeClipboard(page, fn) {
    await page.evaluate(() => window.focus());
    await page.evaluate(fn);
  }

  // ── 1. the file picker: the guaranteed path ────────────────────────────────
  {
    const st = await mint();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openEditor(page, st);
    // The selection panel's Image button opens the dialog; Insert places the uploaded preview.
    await page.getByRole('button', { name: 'Insert image', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Insert image' });
    await dialog.locator('[aria-label="Image file"]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG_BUF });
    const insert = dialog.getByRole('button', { name: 'Insert', exact: true });
    await insert.waitFor();
    for (let i = 0; i < 80 && !(await insert.isEnabled()); i++) await page.waitForTimeout(250);
    await insert.click();
    check((await paintedImages(page)) >= 1, 'file picker: the uploaded image paints in the canvas');

    // ── 2. it persists across `done` + reload — the whole point ──────────────
    await page.click('[aria-label="Exit edit mode"]');
    // POLL, don't sleep. A fixed wait raced the drain: the read landed before the
    // save on a loaded machine and the gate failed on a document that was about
    // to be correct — while the very next check (a fresh read) passed, which is
    // what a flake looks like from the outside.
    const read = async () => (await (await fetch(`${B}/api/artifacts/${st.id}`, {
      headers: { Authorization: `Bearer ${st.token}` },
    })).json()).markup ?? '';
    let got = '';
    for (let i = 0; i < 20 && !/<img[^>]*src="ref:/.test(got); i++) {
      if (i) await page.waitForTimeout(500);
      got = await read();
    }
    check(/<img[^>]*src="ref:/.test(got), 'the image ref is in the persisted source');
    const view = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await view.goto(`${B}/a/${st.id}`, { waitUntil: 'networkidle' });
    // A fresh page with NO token is exactly the sessionless reader the exporter
    // is — so a paint here proves an unlisted image is reachable without auth,
    // which is why born-unlisted is load-bearing (a private image would 404 here
    // and bake a hole into the export).
    check((await paintedImages(view)) >= 1, 'and it still paints on a fresh, tokenless read (the exporter is one too)');
    await view.close();

    // (The export PNG of this document is the exports journey gate's.)
    await page.close();
  }

  // ── 3. drop, inside the iframe realm ───────────────────────────────────────
  {
    const st = await mint();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openEditor(page, st);
    const sent = await dispatchFileEvent(page, 'drop', PNG_B64);
    check(sent === 'dispatched', 'drag-drop: the event reached the document realm');
    check(await paintedImages(page) > 0, 'drag-drop inserts an image that actually PAINTS');
    await page.close();
  }

  // ── 4. paste, inside the iframe realm ──────────────────────────────────────
  {
    const st = await mint();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openEditor(page, st);
    const sent = await dispatchFileEvent(page, 'paste', PNG_B64);
    check(sent === 'dispatched', 'paste: the event reached the document realm');
    check(await paintedImages(page) > 0, 'paste inserts an image that actually PAINTS');
    await page.close();
  }

  // ── 5. a REAL ⌘V, not a constructed ClipboardEvent ─────────────────────────
  /*
   * Sections 3 and 4 dispatch an event with a defined `clipboardData`. That
   * proves the handler, the message hop and the upload — and it bypasses the
   * browser's own clipboard path, so it cannot answer the two things that
   * actually broke:
   *
   *   1. Pasting TEXT must still land in the paragraph. The image listener is
   *      registered with capture:true on the document, so it runs BEFORE the
   *      contentEditable host — it has to be completely transparent when it
   *      declines, or pasting text into a document stops working.
   *   2. Pasting an IMAGE must insert, paint AND PERSIST. It did not: a paste
   *      never blurs the host it happened in, so text pasted a moment earlier
   *      was still uncommitted and the structural insert composed against a
   *      source that never had it, silently dropping the text. The file picker
   *      hid this, because clicking a toolbar button blurs on the way.
   */
  {
    /*
     * The keystroke is the POINT, so it is the one the person at this machine
     * would press: ⌘V on a Mac, Ctrl+V everywhere else. Hardcoding Meta+V
     * passed on the laptop it was written on and tested nothing on Linux.
     */
    const PASTE = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';
    const st = await mint();
    const { chrome, context } = await clipboardBrowser(st.id);
    const page = await context.newPage();
    await fetch(`${B}/api/artifacts/${st.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
      body: JSON.stringify({
        title: 'paste probe',
        markup: '<div className="p-10"><h1 className="text-3xl font-bold">Paste probe</h1>'
          + '<p className="mt-4 text-lg">START </p></div>',
        theme: 'modernist',
      }),
    });
    await openEditor(page, st);
    const frame = await documentFrame(page);

    await writeClipboard(page, () => navigator.clipboard.writeText('PASTED_TEXT_OK'));
    // The editor replaces the paragraph node after a text edit; keep a locator that resolves the current one.
    const para = frame.locator('p').filter({ hasText: 'START' }).first();
    await para.click();
    await page.waitForTimeout(400);
    await page.keyboard.press(PASTE);
    await page.waitForTimeout(1200);
    const text = await para.textContent() ?? '';
    check(text.includes('PASTED_TEXT_OK'), `a real text paste lands in the paragraph (got ${JSON.stringify(text)})`);
    check(text.includes('START'), 'and it did not replace what was already there');

    await writeClipboard(page, async () => {
      // Encoded by Chrome itself, so the clipboard will certainly accept it.
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#e11d48'; ctx.fillRect(0, 0, 64, 64);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
    await para.click();
    await page.waitForTimeout(400);
    await page.keyboard.press(PASTE);
    await page.waitForTimeout(4000);
    check(await paintedImages(page) > 0, 'a real image paste inserts an image that PAINTS');

    const stored = await (await fetch(`${B}/api/artifacts/${st.id}`, {
      headers: { Authorization: `Bearer ${st.token}` },
    })).json();
    check(/src="ref:[A-Za-z0-9]{6,12}"/.test(stored.markup ?? ''), 'the image ref reached the stored source');
    check((stored.markup ?? '').includes('PASTED_TEXT_OK'), 'and so did the text pasted a moment before it');
    await chrome.close();
  }

  // ── 6. what the reader looks at while the bytes travel ─────────────────────
  /*
   * The publish pipeline computes a ~95-byte blurred copy of every image and
   * stores it in `meta.placeholder`, and NOTHING RENDERED IT for a whole
   * release — because the tests asserted a placeholder was PRODUCED and
   * nothing asserted it was CONSUMED. This is the check whose absence allowed
   * that: it stalls the real bytes and looks at what is on screen meanwhile.
   *
   * A VALID png, deliberately: the 2×2 above is malformed (sharp reads its
   * header, a full decode fails with `vipspng: libpng read error`), so no
   * thumbnail can be made of it and it correctly gets no blur.
   */
  {
    // Both artifacts live under ONE token: a `ref:` only resolves to the
    // caller's own artifacts, so a two-token setup fails validation, not the
    // feature.
    const st = await mint();
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` };
    await fetch(`${B}/api/artifacts/${st.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ title: 'blur image', image: VALID_PNG }) });
    const doc = await (await fetch(`${B}/api/artifacts`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'blur doc',
        markup: `<div data-design="tw" className="p-10"><img src="ref:${st.id}" alt="blurred" className="w-40" /></div>`,
      }),
    })).json();

    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    // HOLD the image bytes. Everything else loads; only the picture is late,
    // which is exactly the condition a reader on a slow link is in.
    let release = () => {};
    const held = new Promise((r) => { release = r; });
    await page.route(`**/a/${st.id}/raw*`, async (route) => { await held; await route.continue(); });
    await becomeOwner(page, B, st.token);
    await page.goto(`${B}/a/${doc.id}`, { waitUntil: 'domcontentloaded' });
    const frame = await documentFrame(page);
    await frame.waitForSelector('img[alt="blurred"]', { timeout: 20_000 });

    const during = await frame.evaluate(() => {
      const el = document.querySelector('img[alt="blurred"]');
      const box = el.getBoundingClientRect();
      return {
        src: el.getAttribute('src'),
        background: getComputedStyle(el).backgroundImage.slice(0, 34),
        width: Math.round(box.width),
        height: Math.round(box.height),
        arrived: el.naturalWidth,
      };
    });
    check(/\/raw(\?|$)/.test(during.src ?? ''), `a ref: image renders the bytes URL, not the artifact page (${during.src})`);
    check(during.arrived === 0, `the bytes really are still in flight (naturalWidth ${during.arrived})`);
    check(during.background.startsWith('url("data:image/webp'), `the blur is what the reader sees meanwhile (${during.background}…)`);
    // A background paints nothing without a box. The recorded dimensions are
    // what give it one before the image has any of its own.
    check(during.width > 0 && during.height > 0, `and it has an area to paint in (${during.width}×${during.height})`);

    release();
    const after = await frame.evaluate(async () => {
      const deadline = Date.now() + 10000;
      const el = () => document.querySelector('img[alt="blurred"]');
      while (Date.now() < deadline && !(el()?.naturalWidth > 0)) await new Promise((r) => setTimeout(r, 100));
      return el()?.naturalWidth ?? 0;
    });
    check(after > 0, `and the real image covers it once it lands (naturalWidth ${after})`);
    await page.close();
  }

  // ── 7. replacing an image that is already in the document ─────────────────
  /*
   * A file dropped ONTO an image, or pasted while one is selected, replaces
   * that image instead of inserting another: same node (id, classes, alt), one
   * image still, a new `ref:`. The paste is a REAL keystroke because the real
   * one is what broke: a selected image holds no focus, so ⌘V fires on the
   * page's <body>, outside the story root, and was silently dropped.
   */
  {
    const PASTE = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';
    const st = await mint();
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` };
    // The minted artifact becomes the ORIGINAL picture; the document shows it.
    await fetch(`${B}/api/artifacts/${st.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ title: 'original', image: VALID_PNG }) });
    const doc = await (await fetch(`${B}/api/artifacts`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: 'replace doc',
        markup: '<div data-design="tw" className="p-10"><p className="text-lg">Replace probe</p>'
          + `<img src="ref:${st.id}" alt="the original" className="w-40 rounded-xl" /></div>`,
      }),
    })).json();
    const { chrome, context } = await clipboardBrowser(doc.id);
    const page = await context.newPage();
    const stored = async () => (await (await fetch(`${B}/api/artifacts/${doc.id}`, { headers: auth })).json()).markup ?? '';
    const imgTag = (markup) => /<img\b[^>]*\/>/.exec(markup)?.[0] ?? '';
    const idOf = (tag) => / id="([^"]+)"/.exec(tag)?.[1];
    const srcOf = (tag) => / src="([^"]+)"/.exec(tag)?.[1];
    const waitReplaced = async (from) => {
      let tag = '';
      for (let i = 0; i < 30; i++) {
        if (i) await page.waitForTimeout(500);
        tag = imgTag(await stored());
        if (srcOf(tag) !== from) break;
      }
      return tag;
    };
    const original = imgTag(await stored());
    await openEditor(page, { id: doc.id, token: st.token });
    const frame = await documentFrame(page);
    await frame.evaluate(() => { window.__gateRootBeforeDrop = document.querySelector('[data-mx-inline-story]'); });

    // 7a. drop onto the image
    const marked = await frame.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'r.png', { type: 'image/png' }));
      const img = document.querySelector('[data-mx-inline-story] img[alt="the original"]');
      img.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const label = document.querySelector('[data-mx-drop-replace-label]')?.textContent ?? null;
      img.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return label;
    }, VALID_PNG.split(',')[1]);
    check(marked === 'Drop to replace', `dragging a file over an image says it will replace it (${marked})`);
    const dropped = await waitReplaced(srcOf(original));
    const afterDrop = await stored();
    await page.waitForTimeout(1000);
    check(await frame.evaluate(() => window.__gateRootBeforeDrop === document.querySelector('[data-mx-inline-story]')),
      'the editor stays mounted after the image save');
    check(srcOf(dropped) !== srcOf(original) && /^ref:/.test(srcOf(dropped) ?? ''), `a drop onto the image changes its src (${srcOf(original)} → ${srcOf(dropped)})`);
    check(idOf(dropped) && idOf(dropped) === idOf(original), 'and it is the same node: the id is kept');
    check(dropped.includes('alt="the original"') && dropped.includes('w-40 rounded-xl'), 'with its alt text and classes');
    check((afterDrop.match(/<img\b/g) ?? []).length === 1, 'and nothing was inserted beside it');

    // 7b. a real ⌘V while the image is selected
    await writeClipboard(page, async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0d9488'; ctx.fillRect(0, 0, 64, 64);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
    const selectedImage = frame.locator('[data-mx-inline-story] img[alt="the original"]');
    await selectedImage.click();
    await frame.waitForFunction(() => document.querySelector('[data-mx-inline-story] img[alt="the original"]')?.getAttribute('data-mx-selected') === 'block');
    await page.keyboard.press(PASTE);
    const pasted = await waitReplaced(srcOf(dropped));
    const afterPaste = await stored();
    check(srcOf(pasted) !== srcOf(dropped), `a real paste with the image selected replaces it (${srcOf(dropped)} → ${srcOf(pasted)})`);
    check(idOf(pasted) === idOf(original), 'same node again');
    check((afterPaste.match(/<img\b/g) ?? []).length === 1, 'and the paste inserted nothing');
    check(await paintedImages(page) > 0, 'and the replacement paints');
    await chrome.close();
  }
});

await browser.close();
check.done();

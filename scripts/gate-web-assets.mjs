import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { checkWebImport } from './lib/web-import-cases.mjs';
import { artifactDocument } from './lib/artifact-document.mjs';
/**
 * Gate: an external URL in a document is OURS by the time a reader sees it.
 *
 * The whole design rests on facts a unit test cannot see, because every one of
 * them is about a real browser loading a real document:
 *
 *  1. ZERO requests to the source host. The URL stays in the stored markup, so
 *     the only thing standing between a reader and the third party is the
 *     serve-time mapping — if it misses one position, the picture still paints
 *     (from the source) and every unit test still passes.
 *  2. The picture paints from /assets/<hash>, at the size the row recorded,
 *     with the blur behind it — URL-keeping without the box is a layout-shift
 *     regression against the `ref:` path (R2).
 *  3. The FONT applies, from our origin. The document's own CSP is
 *     `font-src 'self' data:`, so a face that was not mapped does not fall back
 *     — it silently does not exist.
 *  4. A phone must not download the desktop's copy, and a REFRESH must reach a
 *     reader who already has the old bytes. Both are facts about a real
 *     browser. The first is measured AT REAL DEVICE PIXEL RATIOS, because a
 *     browser selects by slot x DPR and not by CSS width: the first cut of this
 *     feature shipped a 640-wide variant that only a DPR-1 viewport ever chose,
 *     and a gate pinned at `deviceScaleFactor: 1` said it worked. So the phone
 *     legs run at DPR 2 AND 3 — what an actual handset is — and the desktop leg
 *     at DPR 2, where the document column genuinely needs the full copy.
 *  5. Both BINDING TIMES. Everything above imports at publish, because the
 *     author wrote the URL. Section 6 is the other end of the clock: an
 *     `<img src="$pick">` names a URL only the reader's browser knows, so the
 *     document's own endpoint imports it on demand — with the same guarantees
 *     (asked once, served from /assets, never reached from the page) plus the
 *     refusals and the private-document bound that keep it from being an open
 *     image proxy.
 *  6. R15: a stored SVG is markup, and a top-level navigation to one must not
 *     run in this app's origin — while an <img> of the same asset still paints.
 *     `Content-Disposition: attachment` makes the navigation a download and
 *     `CSP: sandbox` makes it opaque if it renders at all; either is a pass,
 *     "a document in our origin" is the failure.
 *
 *   usage: node scripts/gate-web-assets.mjs [base]
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { becomeOwner, publishAs, startDocument } from './lib/start-doc.mjs';
import { loginViaEmail, startMailSink } from './lib/mail-login.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('web-assets');

/* ── the "public web" this gate imports from ─────────────────────────────────
 * Its own port so the count of requests to it is unambiguous: anything it is
 * asked for after the publish is a reader reaching a third party. */
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
/* A real woff2: one glyph, so "did the font apply" is measurable by the width
 * of a word rendered in it. Built at startup from the platform's own metrics is
 * overkill — what matters is that the browser ACCEPTS the face, so a minimal
 * valid file is enough to prove the pipeline, and the assertion below is that
 * the face resolves to our origin rather than to the source host. */
const WOFF2 = Buffer.from(
  'd09GMgABAAAAAAKUAA0AAAAABiwAAAI9AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGiYbhBocMAZgAIE0EQgKgVCBHwsIAAE2AiQDGAQgBYspB1IMBxvsBcieB/Yn8W3TVe/dqAOEIiIiqmZmZmYWZmZmZmYWZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmYAAAA',
  'base64',
);

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
  if (path === '/face.woff2') { res.writeHead(200, { 'Content-Type': 'font/woff2' }); res.end(WOFF2); return; }
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

const markup = `<Helmet><style>{\`@font-face{font-family:Probe;src:url(${WEB}/face.woff2${RUN}) format('woff2')}#typed{font-family:Probe,serif}\`}</style></Helmet>`
  + '<div data-design="tw" className="p-10">'
  + `<img src="${WEB}/photo.png${RUN}" alt="probe" />`
  + `<img src="${WEB}/logo.svg${RUN}" alt="vector" />`
  + `<img src="${WEB}/wide.jpg${RUN}" alt="wide" className="w-full" />`
  + '<p id="typed">hello</p>'
  + '</div>';

const put = await fetch(`${B}/api/artifacts/${owner.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ title: 'web assets', markup }) });
const wrote = await put.json();
if (put.status !== 200) {
  console.error(`could not publish (${put.status} ${JSON.stringify(wrote)})`);
  process.exit(2);
}
check(Array.isArray(wrote.warnings) === false || wrote.warnings.length === 0, `publish imported everything (${JSON.stringify(wrote.warnings ?? [])})`);

// The STORED markup keeps the author's URLs — the half of the design an agent sees.
const stored = await (await fetch(`${B}/api/artifacts/${owner.id}`, { headers: auth })).json();
check(stored.markup.includes(`${WEB}/photo.png${RUN}`), 'the stored markup still carries the source URL');
check(stored.markup.includes(`${WEB}/face.woff2${RUN}`), 'the stored markup still carries the @font-face url');

const importHits = [...hits];
check(importHits.filter((h) => h === '/photo.png').length === 1, `the source host was asked once for the image (${importHits.length} requests at publish)`);
hits = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const outbound = [];
/* Every FONT the document actually loaded, with where it came from and whether
 * it arrived — the only proof that `font-src 'self'` admits the mapped url. A
 * face the CSP refused yields no successful response, and the fetch precedes
 * the parse, so this holds however minimal the file is. */
const fontResponses = [];
page.on('request', (r) => { if (r.url().startsWith(WEB)) outbound.push(r.url()); });
page.on('response', (r) => {
  if (r.request().resourceType() === 'font') fontResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
});
await becomeOwner(page, B, owner.token);
await page.goto(`${B}/a/${owner.id}`, { waitUntil: 'networkidle' });

const frame = await artifactDocument(page, { timeout: 30_000 });
const probe = await frame.evaluate(async () => {
  const deadline = Date.now() + 8000;
  const shot = () => {
    const img = document.querySelector('img[alt="probe"]');
    const svg = document.querySelector('img[alt="vector"]');
    const p = document.getElementById('typed');
    return {
      src: img?.getAttribute('src') ?? null,
      width: img?.getAttribute('width') ?? null,
      height: img?.getAttribute('height') ?? null,
      blur: img ? getComputedStyle(img).backgroundImage : '',
      natural: img ? [img.naturalWidth, img.naturalHeight] : [-1, -1],
      svgSrc: svg?.getAttribute('src') ?? null,
      svgNatural: svg ? [svg.naturalWidth, svg.naturalHeight] : [-1, -1],
      wideSrc: document.querySelector('img[alt="wide"]')?.getAttribute('src') ?? null,
      wideSrcset: document.querySelector('img[alt="wide"]')?.getAttribute('srcset') ?? null,
      wideSizes: document.querySelector('img[alt="wide"]')?.getAttribute('sizes') ?? null,
      wideCurrent: document.querySelector('img[alt="wide"]')?.currentSrc ?? null,
      fontFamily: p ? getComputedStyle(p).fontFamily : '',
      sheet: [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n'),
    };
  };
  while (Date.now() < deadline) {
    const s = shot();
    if (s.natural[0] > 0 && s.svgNatural[0] > 0) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  return shot();
});

const ASSET_URL = /^\/assets\/[0-9a-f]{64}\?v=[0-9a-f]{8}$/;
check(ASSET_URL.test(probe.src ?? ''), `the raster <img> is served from our origin, versioned (${probe.src})`);
check(probe.natural[0] > 0 && probe.natural[1] > 0, `it paints (${probe.natural.join('×')})`);
check(probe.width === '48' && probe.height === '32', `it carries the box the row recorded (width=${probe.width} height=${probe.height})`);
check(probe.blur.startsWith('url(') && probe.blur.includes('data:image/'), 'the blur placeholder rides as an inline background');
check(ASSET_URL.test(probe.svgSrc ?? ''), `the SVG <img> is served from our origin, versioned (${probe.svgSrc})`);
check(probe.svgNatural[0] > 0, `the SVG paints as an image despite the attachment header (${probe.svgNatural.join('×')})`);
check(probe.sheet.includes('/assets/') && !probe.sheet.includes(WEB), 'the @font-face src was rewritten to our origin');
// …and VERSIONED: a face is served from the same immutable address a picture
// is, so a refreshed font needs the same cache key (R19).
check(/url\(\/assets\/[0-9a-f]{64}\?v=[0-9a-f]{8}\)/.test(probe.sheet), 'the @font-face src carries the content version');
check(probe.fontFamily.includes('Probe'), `the paragraph asks for the imported face (${probe.fontFamily})`);
check(
  fontResponses.some((f) => /^200 \/assets\/[0-9a-f]{64}$/.test(f)),
  `the browser LOADED a font from /assets (${fontResponses.join(', ') || 'no font request at all'})`,
);

/* ── two widths, and the browser picking ────────────────────────────────────
 * `sizes` is authoritative for the choice, so this is a real browser decision
 * and not a guess about layout. */
check(/w=1280 1280w, \/assets\/[0-9a-f]{64}\?v=[0-9a-f]{8} 1600w$/.test(probe.wideSrcset ?? ''),
  `the wide image offers both widths (${probe.wideSrcset})`);
check(probe.wideSizes === '(max-width: 640px) 100vw, 768px', `…and the column they are read in (${probe.wideSizes})`);

// THE HEADLINE: nothing on the page reached the source host.
check(outbound.length === 0 && hits.length === 0, `zero requests to the source host while reading (${outbound.length} browser, ${hits.length} server-side)`);

/* ── which copy each screen actually asks for ───────────────────────────────
 * THE DPR IS THE POINT. A browser picks by slot x DPR: a 390px phone at DPR 3
 * needs 1170 device pixels, so a 640-wide variant is skipped and the full copy
 * downloaded — which is what shipped, and what a gate pinned at DPR 1 could not
 * see. These legs run at the ratios real devices have, and the desktop leg runs
 * at DPR 2, where a 768px column needs 1536 device pixels and the full copy is
 * the RIGHT answer. Asserted by the request the browser actually made. */
const whichCopy = async (label, viewport, deviceScaleFactor) => {
  const page2 = await browser.newPage({ viewport, deviceScaleFactor });
  const asked = [];
  page2.on('request', (r) => { if (r.resourceType() === 'image') asked.push(new URL(r.url()).search); });
  await becomeOwner(page2, B, owner.token);
  await page2.goto(`${B}/a/${owner.id}`, { waitUntil: 'networkidle' });
  const f = await artifactDocument(page2, { timeout: 30_000 });
  const current = await f.evaluate(async () => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const img = document.querySelector('img[alt="wide"]');
      if (img?.currentSrc) return img.currentSrc;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  });
  await page2.close();
  return { label: `${label} ${viewport.width}px DPR${deviceScaleFactor}`, current, asked };
};

for (const dpr of [2, 3]) {
  const shot = await whichCopy('phone', { width: 390, height: 844 }, dpr);
  check((shot.current ?? '').includes('w=1280'), `${shot.label} loads the narrow copy (${shot.current})`);
  check(shot.asked.some((s) => s.includes('w=1280')), `…and asked our origin for it (${shot.asked.join(' ') || 'no image request'})`);
}
const desk = await whichCopy('desktop', { width: 1200, height: 900 }, 2);
check(!(desk.current ?? '').includes('w='), `${desk.label} loads the full copy — 768 x 2 needs more than 1280 (${desk.current})`);

/* ── a refresh reaches a reader who already has the old bytes (R19) ──────────
 * /assets/<hash> is immutable for a year and its address is derived from the
 * URL, so the only thing that can make a browser ask again is the url the next
 * render emits. */
const before = probe.wideSrc;
wideColour = '#b4381f';
hits = [];
const refreshed = await fetch(`${B}/api/artifacts/assets/refresh`, {
  method: 'POST', headers: auth, body: JSON.stringify({ id: owner.id }),
});
const refreshBody = await refreshed.json();
check(refreshed.status === 200 && (refreshBody.refreshed ?? []).length > 0,
  `refresh_asset re-fetched the changed sources (${refreshed.status} ${JSON.stringify(refreshBody).slice(0, 160)})`);

const reader = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const fetchedAfter = [];
reader.on('response', (r) => { if (r.request().resourceType() === 'image') fetchedAfter.push(new URL(r.url()).pathname + new URL(r.url()).search); });
await becomeOwner(reader, B, owner.token);
await reader.goto(`${B}/a/${owner.id}`, { waitUntil: 'networkidle' });
const readerFrame = await artifactDocument(reader, { timeout: 30_000 });
const after = await readerFrame.evaluate(async () => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const img = document.querySelector('img[alt="wide"]');
    if (img?.naturalWidth > 0) return img.getAttribute('src');
    await new Promise((r) => setTimeout(r, 100));
  }
  return document.querySelector('img[alt="wide"]')?.getAttribute('src') ?? null;
});
check(after !== before && ASSET_URL.test(after ?? ''), `the refreshed asset is served at a new ?v= (${before} → ${after})`);
/* The VERSION is what must have moved; WHICH width this reader picks is the
 * browser's business (a 1200px DPR-1 page needs 768 device pixels, so it takes
 * the 1280 copy — the srcset working). */
const newVersion = new URL(after ?? '', B).searchParams.get('v');
check(
  fetchedAfter.some((u) => u.startsWith(new URL(after ?? '', B).pathname) && u.includes(`v=${newVersion}`)),
  `…and the reader's browser fetched the new version (${fetchedAfter.filter((u) => u.includes('/assets/')).join(' ') || 'nothing'})`,
);
await reader.close();

/* ── the layout does not move ───────────────────────────────────────────────
 * Measured the way the reading gates do: cumulative layout shift over the
 * document's own load, which is what the recorded box exists to keep at zero. */
const shifted = await frame.evaluate(async () => {
  let total = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) total += e.value;
  }).observe({ type: 'layout-shift', buffered: true });
  await new Promise((r) => setTimeout(r, 600));
  return total;
});
check(shifted < 0.02, `no layout shift as the images land (CLS ${shifted.toFixed(4)})`);

/* ── R15: the SVG as a TOP-LEVEL navigation ─────────────────────────────────
 * A pass is anything but "a document running in this app's origin": the
 * attachment header turns it into a download, and the sandbox header makes it
 * opaque if a browser renders it anyway. */
const svgUrl = `${B}${probe.svgSrc}`;
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

const headers = (await fetch(svgUrl)).headers;
check(headers.get('content-security-policy') === 'sandbox', 'the asset carries CSP: sandbox');
check(headers.get('content-disposition') === 'attachment', 'the asset carries Content-Disposition: attachment');
check(headers.get('x-content-type-options') === 'nosniff', 'the asset carries nosniff');
check((headers.get('cache-control') ?? '').includes('immutable'), 'the asset is immutable');

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
    process.exit(2);
  }
  check((boundWrote.warnings ?? []).length === 0,
    `bound: publish fetched nothing and warned about nothing (${JSON.stringify(boundWrote.warnings ?? [])})`);
  check(hits.length === boundHitsBefore,
    `bound: the source host was not asked at publish — publish cannot see a bound URL (${hits.length - boundHitsBefore} requests)`);
  const boundStored = await (await fetch(`${B}/api/artifacts/${bound.id}`, { headers: boundAuth })).json();
  check(boundStored.markup.includes('src="$pick"'), 'bound: the stored markup keeps the binding the author wrote');

  // A STRANGER: no session, no adopted token. A public document is served
  // top-level, so this is the reading path a shared link gives someone.
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

  /**
   * The `<img>` once it has SETTLED on the URL we are asking about — polled by
   * the address in its src, never by a timer: an `<img>` keeps the pixels of
   * its previous source until the new one decodes, so "has it painted" asked
   * too early is the old picture answering for the new one.
   */
  const shotOf = (expect) => reading.evaluate(async (want) => {
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
  await reading.selectOption('select[aria-label="pick"]', TWO);
  const secondAnswer = await secondImport;
  const secondShot = await shotOf(secondAnswer.url);
  check(/^\/assets\/[0-9a-f]{64}$/.test(secondShot.src ?? '') && secondShot.src === secondAnswer.url
    && secondShot.src !== firstShot.src,
  `bound: picking another URL renders that import's distinct cached address (${secondShot.src})`);
  check(hits.filter((h) => h === '/pic2.png').length === 1, 'bound: the source host was asked once for the second');

  const beforeReturn = { web: hits.length, endpoint: endpointCalls.length };
  await reading.selectOption('select[aria-label="pick"]', ONE);
  const back = await shotOf('/assets/');
  check(/^\/assets\/[0-9a-f]{64}$/.test(back.src ?? '') && back.natural[0] === 48,
    `bound: coming back renders our copy directly, and it still paints (${back.src})`);
  check(hits.length === beforeReturn.web && endpointCalls.length === beforeReturn.endpoint,
    `bound: neither the source host nor the endpoint was asked again (${hits.length - beforeReturn.web} / ${endpointCalls.length - beforeReturn.endpoint})`);

  const untilRefused = () => reading.evaluate(async () => {
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
  await reading.selectOption('select[aria-label="pick"]', BAD);
  const refused = await untilRefused();
  check(refused.mark === 'refused' && refused.src === null,
    `bound: a refused URL is marked and carries no src (data-mx-asset=${refused.mark})`);
  check(refused.alt === 'the pick', "bound: the alt text is still the author's, so the browser draws it");
  await reading.selectOption('select[aria-label="pick"]', DATA_URL);
  const dataShot = await untilRefused();
  check(dataShot.mark === 'refused' && dataShot.src === null && dataShot.natural !== 40,
    `bound: a data: value is refused by the MAPPING, not left to the policy (${JSON.stringify(dataShot)})`);

  check(boundOutbound.length === 0, `bound: zero requests from the page to the source host (${boundOutbound.length})`);

  /*
   * THE CASE THE WHOLE RELAY EXISTS FOR, and it is the DEFAULT one: a signed-in
   * user's document is born private, so its first reader is its owner, looking
   * at it in the shell. The frame is opaque-origin — its <img> carries no
   * cookie — so the endpoint sees an anonymous caller and the read ACL answers
   * 404. The page asks instead, with its session, and hands back the public
   * address of our copy (mx:asset).
   */
  const sink = await startMailSink();
  const PRIV = `${WEB}/pic3.png?run=${RUN_ID}`;
  const holder = await browser.newPage();
  await loginViaEmail(holder, B, sink, `mxmx_test_boundassets_${RUN_ID}@example.com`);
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

  const beforePriv = hits.filter((h) => h === '/pic3.png').length;
  await holder.goto(`${B}/a/${mine.id}`, { waitUntil: 'networkidle' });
  const owned = await paints(await artifactDocument(holder, { timeout: 30_000 }));
  check(owned.natural[0] === 48 && owned.natural[1] === 32,
    `bound: a private document's OWNER sees the picture, imported through the page (${JSON.stringify(owned)})`);
  check(/^\/assets\/[0-9a-f]{64}$/.test(owned.src ?? ''),
    `bound: and its src is the public content address the relay handed back (${owned.src})`);
  check(hits.filter((h) => h === '/pic3.png').length === beforePriv + 1,
    'bound: the source host was asked exactly once for it');
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
  const seenByGuest = await paints(await artifactDocument(guest, { timeout: 30_000 }));
  check(seenByGuest.natural[0] === 48,
    `bound: an INVITED VIEWER of the private document sees the picture too, through the shell (${JSON.stringify(seenByGuest)})`);
  check(hits.filter((h) => h === '/pic3.png').length === beforeGuest,
    'bound: and cost the source host nothing — it was already ours');
  sink.close();
}

await browser.close();
web.close();

check.done();

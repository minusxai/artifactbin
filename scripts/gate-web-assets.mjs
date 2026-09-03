/**
 * Gate: an external URL in a document is OURS by the time a reader sees it.
 *
 * The whole design rests on four facts a unit test cannot see, because each of
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
 *     browser: whether `srcset` + `sizes` make it fetch the 640-wide variant at
 *     390px and the full one at 1200px, and whether the `?v=` a refreshed row
 *     emits actually moves — the address is served `immutable`, so nothing else
 *     could make a cached reader ask again (R19).
 *  5. R15: a stored SVG is markup, and a top-level navigation to one must not
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
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

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
  res.writeHead(404); res.end();
});
// 6220–6229 is this agent's throwaway-server range.
await new Promise((resolve) => web.listen(6223, '127.0.0.1', resolve));
const WEB = 'http://127.0.0.1:6223';
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
ok(Array.isArray(wrote.warnings) === false || wrote.warnings.length === 0, `publish imported everything (${JSON.stringify(wrote.warnings ?? [])})`);

// The STORED markup keeps the author's URLs — the half of the design an agent sees.
const stored = await (await fetch(`${B}/api/artifacts/${owner.id}`, { headers: auth })).json();
ok(stored.markup.includes(`${WEB}/photo.png${RUN}`), 'the stored markup still carries the source URL');
ok(stored.markup.includes(`${WEB}/face.woff2${RUN}`), 'the stored markup still carries the @font-face url');

const importHits = [...hits];
ok(importHits.filter((h) => h === '/photo.png').length === 1, `the source host was asked once for the image (${importHits.length} requests at publish)`);
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

const frame = await (await page.waitForSelector('iframe[title="artifact"]', { timeout: 30_000 })).contentFrame();
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
ok(ASSET_URL.test(probe.src ?? ''), `the raster <img> is served from our origin, versioned (${probe.src})`);
ok(probe.natural[0] > 0 && probe.natural[1] > 0, `it paints (${probe.natural.join('×')})`);
ok(probe.width === '48' && probe.height === '32', `it carries the box the row recorded (width=${probe.width} height=${probe.height})`);
ok(probe.blur.startsWith('url(') && probe.blur.includes('data:image/'), 'the blur placeholder rides as an inline background');
ok(ASSET_URL.test(probe.svgSrc ?? ''), `the SVG <img> is served from our origin, versioned (${probe.svgSrc})`);
ok(probe.svgNatural[0] > 0, `the SVG paints as an image despite the attachment header (${probe.svgNatural.join('×')})`);
ok(probe.sheet.includes('/assets/') && !probe.sheet.includes(WEB), 'the @font-face src was rewritten to our origin');
ok(probe.fontFamily.includes('Probe'), `the paragraph asks for the imported face (${probe.fontFamily})`);
ok(
  fontResponses.some((f) => /^200 \/assets\/[0-9a-f]{64}$/.test(f)),
  `the browser LOADED a font from /assets (${fontResponses.join(', ') || 'no font request at all'})`,
);

/* ── two widths, and the browser picking ────────────────────────────────────
 * `sizes` is authoritative for the choice, so this is a real browser decision
 * and not a guess about layout. */
ok(/w=640 640w, \/assets\/[0-9a-f]{64}\?v=[0-9a-f]{8} 1600w$/.test(probe.wideSrcset ?? ''),
  `the wide image offers both widths (${probe.wideSrcset})`);
ok(probe.wideSizes === '(max-width: 640px) 100vw, 768px', `…and the column they are read in (${probe.wideSizes})`);
ok((probe.wideCurrent ?? '').includes('w=640') === false, `a 1200px desktop loads the full copy (${probe.wideCurrent})`);

// THE HEADLINE: nothing on the page reached the source host.
ok(outbound.length === 0 && hits.length === 0, `zero requests to the source host while reading (${outbound.length} browser, ${hits.length} server-side)`);

/* ── the phone gets the phone's copy ────────────────────────────────────────
 * Same document, same markup, a 390px viewport: the browser must reach for the
 * 640-wide object instead of the 1600-wide one, and it must ask OUR origin for
 * it. Asserted by the request the browser actually made. */
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const phoneAsked = [];
phone.on('request', (r) => { if (r.resourceType() === 'image') phoneAsked.push(new URL(r.url()).search); });
await becomeOwner(phone, B, owner.token);
await phone.goto(`${B}/a/${owner.id}`, { waitUntil: 'networkidle' });
const phoneFrame = await (await phone.waitForSelector('iframe[title="artifact"]', { timeout: 30_000 })).contentFrame();
const phoneCurrent = await phoneFrame.evaluate(async () => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const img = document.querySelector('img[alt="wide"]');
    if (img?.currentSrc) return img.currentSrc;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
});
ok((phoneCurrent ?? '').includes('w=640'), `a 390px phone loads the narrow copy (${phoneCurrent})`);
ok(phoneAsked.some((s) => s.includes('w=640')), `…and asked our origin for it (${phoneAsked.join(' ') || 'no image request'})`);
await phone.close();

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
ok(refreshed.status === 200 && (refreshBody.refreshed ?? []).length > 0,
  `refresh_asset re-fetched the changed sources (${refreshed.status} ${JSON.stringify(refreshBody).slice(0, 160)})`);

const reader = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const fetchedAfter = [];
reader.on('response', (r) => { if (r.request().resourceType() === 'image') fetchedAfter.push(new URL(r.url()).pathname + new URL(r.url()).search); });
await becomeOwner(reader, B, owner.token);
await reader.goto(`${B}/a/${owner.id}`, { waitUntil: 'networkidle' });
const readerFrame = await (await reader.waitForSelector('iframe[title="artifact"]', { timeout: 30_000 })).contentFrame();
const after = await readerFrame.evaluate(async () => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const img = document.querySelector('img[alt="wide"]');
    if (img?.naturalWidth > 0) return img.getAttribute('src');
    await new Promise((r) => setTimeout(r, 100));
  }
  return document.querySelector('img[alt="wide"]')?.getAttribute('src') ?? null;
});
ok(after !== before && ASSET_URL.test(after ?? ''), `the refreshed asset is served at a new ?v= (${before} → ${after})`);
ok(fetchedAfter.some((u) => u === after), `…and the reader's browser fetched THAT url (${fetchedAfter.join(' ') || 'nothing'})`);
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
ok(shifted < 0.02, `no layout shift as the images land (CLS ${shifted.toFixed(4)})`);

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
ok(!verdict.startsWith('OUR ORIGIN'), `a top-level navigation to the stored SVG does not run in this origin: ${verdict}`);

const headers = (await fetch(svgUrl)).headers;
ok(headers.get('content-security-policy') === 'sandbox', 'the asset carries CSP: sandbox');
ok(headers.get('content-disposition') === 'attachment', 'the asset carries Content-Disposition: attachment');
ok(headers.get('x-content-type-options') === 'nosniff', 'the asset carries nosniff');
ok((headers.get('cache-control') ?? '').includes('immutable'), 'the asset is immutable');

await browser.close();
web.close();

const failed = out.filter((l) => l.startsWith('FAIL'));
console.log(failed.length ? `\n${failed.length} failed` : '\nall ok');
process.exit(failed.length ? 1 : 0);

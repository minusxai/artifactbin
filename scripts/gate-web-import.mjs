/**
 * Gate: an asset imported FROM THE WEB paints, and the reader never touches
 * the origin host.
 *
 * The unit suite proves the bytes are fetched and stored. Only a
 * browser can prove the two things that actually matter to a reader:
 *   1. the imported image PAINTS inside the sandboxed document (naturalWidth
 *      > 0 — the exact failure mode gate-ref-image exists for), and
 *   2. NO request leaves for the origin host. That is the whole point of
 *      ingest-and-own — a hotlink would render identically and leak every
 *      reader's IP, so "it looks right" is not evidence. This watches the
 *      network instead.
 * Same for an imported Google font: served from our origin, never gstatic.
 *
 * The "web" here is a local server this gate starts, so the gate needs no
 * internet and the app must be running with WEB_INGEST_ALLOW_PRIVATE=1 (dev
 * sets it by default — lib/config).
 *
 *   usage: node scripts/gate-web-import.mjs [base]
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { startDocument, becomeOwner } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3040';
const out = [];
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

// A 2×2 red PNG — small, but with non-zero dimensions so a paint is measurable.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8Dwn4EIwDiqkL4KAcT9GO0U4BxjAAAAAElFTkSuQmCC',
  'base64',
);

// ── the "origin host" the document must never be sent to ────────────────────
let hostHits = 0;
const web = createServer((req, res) => {
  hostHits++;
  if (req.url === '/logo.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PNG);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => web.listen(0, '127.0.0.1', r));
const WEB = `http://127.0.0.1:${web.address().port}`;
console.log(`   fixture host: ${WEB}`);

const started = await startDocument(B);
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${started.token}` };

// ── publish a document that names a WEB image; the door must import it ──────
const put = await fetch(`${B}/api/artifacts/${started.id}`, {
  method: 'PUT',
  headers: auth,
  body: JSON.stringify({
    title: 'web import gate',
    markup: `<div id="root" className="p-8"><h1 id="heading" className="text-2xl font-bold">Imported</h1><img id="shot" src="${WEB}/logo.png" alt="imported" /></div>`,
  }),
});
const body = await put.json();
ok(put.status === 200, `the publish imported rather than refused (${put.status})`);
// The URL is KEPT: the author wrote one and reads one back, so the echo is not
// news (`markup_changed: false`) and the stored source still names the host.
// What changes is what a READER is served — checked in the browser below.
ok(body.markup_changed === false, `nothing was rewritten, so the echo carries no markup (markup_changed ${body.markup_changed})`);
const storedSource = (await (await fetch(`${B}/api/artifacts/${started.id}`, { headers: auth })).json()).markup ?? '';
ok(storedSource.includes(`${WEB}/logo.png`), 'the stored source still carries the URL its author wrote');

const fetchesBeforeRead = hostHits;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

// Watch EVERY request the page and its frames make.
const offOrigin = [];
page.on('request', (r) => { if (r.url().startsWith(WEB)) offOrigin.push(r.url()); });

await page.goto(`${B}/a/${started.id}`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// The reader is served the document top-level (proxy.ts), so the img is on the page.
const painted = await page.evaluate(() => {
  const img = document.querySelector('#shot');
  return img ? { w: img.naturalWidth, src: img.getAttribute('src') } : null;
});
ok(!!painted && painted.w > 0, `the imported image PAINTS (naturalWidth ${painted?.w ?? 'n/a'})`);
ok(!!painted && !painted.src.startsWith('http'), `and it loads from this origin (${painted?.src})`);
ok(offOrigin.length === 0, `the reader made NO request to the origin host (${offOrigin.length})`);
ok(hostHits === fetchesBeforeRead, 'and the host saw no traffic from the read at all');

// ── a Google font names a family; the reader must never reach gstatic ───────
const gstatic = [];
page.on('request', (r) => { if (/gstatic|googleapis/.test(r.url())) gstatic.push(r.url()); });

const fontDoc = await startDocument(B);
const fontPut = await fetch(`${B}/api/artifacts/${fontDoc.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fontDoc.token}` },
  body: JSON.stringify({
    title: 'font import gate',
    markup: '<Helmet><meta name="font-display" content="Lobster" /></Helmet><div className="p-8"><h1 id="h" className="text-5xl font-bold">Lobster headline</h1></div>',
  }),
});
if (fontPut.status === 200) {
  await page.goto(`${B}/a/${fontDoc.id}`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const family = await page.evaluate(() => {
    const h = document.querySelector('#h');
    return h ? getComputedStyle(h).fontFamily : '';
  });
  ok(/Lobster/.test(family), `the heading asks for the imported family (${family})`);
  const faces = await page.evaluate(() => [...document.querySelectorAll('style')]
    .map((s) => s.textContent ?? '').join('\n').match(/\/webfonts\/[0-9a-f]{32}\.woff2/g)?.length ?? 0);
  ok(faces > 0, `its @font-face rules point at THIS origin (${faces} face(s))`);
  ok(gstatic.length === 0, `the reader made NO request to Google (${gstatic.length})`);
} else {
  // A deployment with no outbound access to Google cannot resolve the family;
  // say so rather than failing a gate about OUR behaviour.
  console.log(`   (skipped the font leg: the deployment could not resolve the family — ${fontPut.status})`);
}

// ── the HUMAN door: the editor's insert-image popover takes a URL ───────────
// jsdom proves the wiring; only a browser proves the control is reachable,
// the popover opens, and the inserted image actually paints in the document.
{
  const doc = await startDocument(B);
  await becomeOwner(page, B, doc.token);
  await page.goto(`${B}/a/${doc.id}#edit`, { waitUntil: 'load' });
  await page.waitForSelector('[aria-label="Insert image"]', { timeout: 60000 });
  await page.click('[aria-label="Insert image"]');
  const urlField = await page.waitForSelector('[aria-label="Image URL"]', { timeout: 10000 }).catch(() => null);
  ok(!!urlField, 'the insert-image control offers a URL field');
  if (urlField) {
    await page.fill('[aria-label="Image URL"]', `${WEB}/logo.png`);
    await page.click('[aria-label="Import image from URL"]');
    // POLL, don't sleep. The insert commits, the save debounces, and the
    // document re-renders with refData that knows the new id — the `ref:` is
    // resolved to a URL only on that pass, so a single early read sees the raw
    // ref and reports a phantom failure. (Same polling shape as
    // gate-image-upload, for the same reason.)
    // The frame is sandboxed WITHOUT allow-same-origin, so the parent cannot
    // read contentDocument: drive it through Playwright's frame API.
    let inserted = null;
    for (let i = 0; i < 40 && !(inserted && inserted.w > 0); i++) {
      const frame = page.frames().find((f) => f !== page.mainFrame());
      inserted = frame
        ? await frame.evaluate(() => {
            // NOT `querySelector('img')`: every served document carries the
            // credits-footer logo, and matching that reports success for an
            // image this gate never inserted. An IMPORTED image resolves to
            // its own artifact's bytes — /a/<id>/raw — so match that shape.
            const img = [...document.querySelectorAll('img')]
              .find((i) => /\/a\/[A-Za-z0-9]+\/raw/.test(i.getAttribute('src') ?? ''));
            return img ? { w: img.naturalWidth, src: img.getAttribute('src') } : null;
          }).catch(() => null)
        : null;
      if (inserted && inserted.w > 0) break;
      await page.waitForTimeout(500);
    }
    ok(!!inserted, 'the imported image was inserted into the document');
    ok(!!inserted && inserted.w > 0, `and it paints (naturalWidth ${inserted?.w ?? 'n/a'})`);
    ok(!!inserted && !/^https?:/.test(inserted.src ?? ''), `from this origin, not the source host (${inserted?.src})`);
  }
}

await browser.close();
web.close();

if (out.some((l) => l.startsWith('FAIL'))) {
  console.error(`\n${out.filter((l) => l.startsWith('FAIL')).length} check(s) failed`);
  process.exit(1);
}
console.log('\nall web-import checks passed');

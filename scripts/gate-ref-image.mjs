/**
 * Gate: an image bound by `ref:<id>` must actually paint.
 *
 * The fault this pins: refData handed the interpreter `url: "/a/<id>"` — the
 * HTML *page* of the image artifact, not its bytes. An <img> pointed at a page
 * loads to naturalWidth 0. The documented pattern (`<img src="ref:<id>">`,
 * skills/markup) therefore rendered a broken image on every story, and no
 * test in the suite looked at a RENDERED ref image, so nothing caught it. The
 * unit test asserts the URL shape; this asserts the pixels, inside the iframe
 * where the failure actually shows.
 *
 *   usage: node scripts/gate-ref-image.mjs [base]
 */
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

// A 2×2 red PNG — small, but non-zero dimensions so a real paint is measurable.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8Dwn4EIwDiqkL4KAcT9GO0U4BxjAAAAAElFTkSuQmCC';

async function mint() {
  // The token comes from the start LINK now — /api/start hands the browser a
  // cookie, not a secret (lib/agent-session).
  return startDocument(B);
}

// Both artifacts live under ONE token — a `ref:` only resolves to the caller's
// own artifacts, so a two-token setup fails validation, not the feature.
const owner = await mint();
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` };

// 1. an image artifact holding real bytes (reuse the started id)
await fetch(`${B}/api/artifacts/${owner.id}`, {
  method: 'PUT',
  headers: auth,
  body: JSON.stringify({ title: 'ref image', image: PNG }),
});

// 2. a story under the same token that binds it
const docRes = await fetch(`${B}/api/artifacts`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    title: 'ref image doc',
    markup: `<div data-design="tw" className="p-10"><img src="ref:${owner.id}" alt="probe" className="w-40" /></div>`,
  }),
});
if (docRes.status !== 201) {
  console.error(`could not publish the referencing doc (${docRes.status} ${await docRes.text()})`);
  process.exit(2);
}
const doc = await docRes.json();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await becomeOwner(page, B, owner.token); // the shell belongs to the owner
await page.goto(`${B}/a/${doc.id}`, { waitUntil: 'networkidle' });

// The document is a SERVED page in an opaque-origin frame: reached through the
// frame API, never contentDocument (which is null across origins by design).
const docFrame = await (await page.waitForSelector('iframe[title="artifact"]', { timeout: 30_000 })).contentFrame();
const probe = await docFrame.evaluate(async () => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const el = document.querySelector('img[alt="probe"]');
    if (el && el.complete && el.naturalWidth > 0) {
      return { src: el.getAttribute('src'), w: el.naturalWidth, h: el.naturalHeight };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const el = document.querySelector('img[alt="probe"]');
  return el
    ? { src: el.getAttribute('src'), w: el.naturalWidth, h: el.naturalHeight }
    : { src: null, w: -1, h: -1 };
});

ok(probe.w > 0 && probe.h > 0, `ref image paints (naturalWidth ${probe.w}, height ${probe.h})`);
// The bytes URL is `/a/<id>/raw` with an optional `?v=<version>` cache-buster.
ok(typeof probe.src === 'string' && /\/raw(\?|$)/.test(probe.src), `the rendered src points at the bytes URL (${probe.src})`);

/*
 * ── THE BLUR: what the reader looks at while the bytes travel ───────────────
 *
 * The publish pipeline has computed a ~95-byte blurred copy of every image
 * since #157 and stored it in `meta.placeholder`, and NOTHING RENDERED IT for
 * a whole release — because the tests asserted a placeholder was PRODUCED and
 * nothing asserted it was CONSUMED. This is the test whose absence allowed
 * that: it stalls the real bytes and looks at what is on screen meanwhile.
 *
 * A VALID png, deliberately: the 2×2 above is malformed (sharp reads its
 * header, a full decode fails with `vipspng: libpng read error`), so no
 * thumbnail can be made of it and it correctly gets no blur.
 */
const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8dMpruoH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1weeF8xbShDdKgAAAABJRU5ErkJggg==';
{
  const owner2 = await mint();
  const auth2 = { 'Content-Type': 'application/json', Authorization: `Bearer ${owner2.token}` };
  await fetch(`${B}/api/artifacts/${owner2.id}`, { method: 'PUT', headers: auth2, body: JSON.stringify({ title: 'blur image', image: VALID_PNG }) });
  const d = await (await fetch(`${B}/api/artifacts`, {
    method: 'POST', headers: auth2,
    body: JSON.stringify({ title: 'blur doc', markup: `<div data-design="tw" className="p-10"><img src="ref:${owner2.id}" alt="blurred" className="w-40" /></div>` }),
  })).json();

  const p2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  // HOLD the image bytes. Everything else loads; only the picture is late,
  // which is exactly the condition a reader on a slow link is in.
  let release = () => {};
  const held = new Promise((r) => { release = r; });
  await p2.route(`**/a/${owner2.id}/raw*`, async (route) => { await held; await route.continue(); });
  await becomeOwner(p2, B, owner2.token);
  await p2.goto(`${B}/a/${d.id}`, { waitUntil: 'domcontentloaded' });
  const f2 = await (await p2.waitForSelector('iframe[title="artifact"]', { timeout: 30_000 })).contentFrame();
  await f2.waitForSelector('img[alt="blurred"]', { timeout: 20_000 });

  const during = await f2.evaluate(() => {
    const el = document.querySelector('img[alt="blurred"]');
    const box = el.getBoundingClientRect();
    return {
      background: getComputedStyle(el).backgroundImage.slice(0, 34),
      width: Math.round(box.width), height: Math.round(box.height),
      arrived: el.naturalWidth,
    };
  });
  ok(during.arrived === 0, `the bytes really are still in flight (naturalWidth ${during.arrived})`);
  ok(during.background.startsWith('url("data:image/webp'), `the blur is what the reader sees meanwhile (${during.background}…)`);
  // A background paints nothing without a box. The recorded dimensions are
  // what give it one before the image has any of its own.
  ok(during.width > 0 && during.height > 0, `and it has an area to paint in (${during.width}×${during.height})`);

  release();
  const after = await f2.evaluate(async () => {
    const deadline = Date.now() + 10000;
    const el = () => document.querySelector('img[alt="blurred"]');
    while (Date.now() < deadline && !(el()?.naturalWidth > 0)) await new Promise((r) => setTimeout(r, 100));
    return { arrived: el()?.naturalWidth ?? 0 };
  });
  ok(after.arrived > 0, `and the real image covers it once it lands (naturalWidth ${after.arrived})`);
  await p2.close();
}

await browser.close();

const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : `\nall ${out.length} checks passed`);
process.exit(failed ? 1 : 0);

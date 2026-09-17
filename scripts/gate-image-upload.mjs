/**
 * Gate: a human can put an image into a story, every way, and it sticks —
 * and a `ref:` image paints once it is in there.
 *
 * P3's promise is that the file picker, a paste, and a drag all end the same
 * way — the bytes become an unlisted artifact and `<img src="ref:<id>">` is
 * appended through the edit queue — and that leaving the editor persists it
 * (the exact "click done, change lost" class the whole effort started from).
 * Section 5 presses the REAL keystroke rather than dispatching an event, and
 * section 6 holds the bytes in flight to see what a reader looks at while a
 * ref: image loads: the blur placeholder, in a box of the recorded size.
 *
 * The paste/drop half is realm-sensitive: the listeners live inside the SERVED
 * document (its own window, sandboxed without allow-same-origin), so the events
 * are dispatched THERE through Playwright's frame API — a page-level dispatch
 * would prove nothing, and `contentDocument` is null from the parent. Every
 * check asserts the image actually PAINTS (naturalWidth > 0) and counts only
 * `/a/<id>/raw` sources: the credits-footer logo made an earlier version of
 * this gate pass while nothing was being inserted at all.
 *
 *   usage: node scripts/gate-image-upload.mjs [base]
 */
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { chromium } from 'playwright';
import { artifactDocument } from './lib/artifact-document.mjs';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('image-upload');

// A 2×2 red PNG (non-zero dimensions so a real paint is measurable).
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8Dwn4EIwDiqkL4KAcT9GO0U4BxjAAAAAElFTkSuQmCC';
const PNG_BUF = Buffer.from(PNG_B64, 'base64');

const MARKUP = '<div data-design="tw" className="p-10">'
  + '<h1 className="text-4xl font-bold">Image gate</h1>'
  + '<p className="mt-4 text-lg">Body copy.</p></div>';

async function mint() {
  const st = await startDocument(B);
  if (!st.id || !st.token) {
    console.error(`cannot start a document (${JSON.stringify(st)}).`
      + '\nThe start_doc door is rate limited per IP, in memory: restart the server to clear it.');
    process.exit(2);
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
 * Two realms to look in, and both matter: the EDIT canvas is a same-origin
 * frame the page can reach into, while the SERVED document is opaque-origin
 * and only reachable through the frame API. Ask Playwright for whichever
 * frame is there.
 */
async function paintedImages(page) {
  const countIn = (ctx) => ctx.evaluate(async () => {
    const deadline = Date.now() + 8000;
    const count = () => {
      const own = Array.from(document.querySelectorAll('[data-mx-inline-story] img'));
      // ONLY artifact images. Every served document carries the credits-footer
      // logo (/logo-128.png), and counting it made this check pass while a
      // freshly inserted image rendered its literal `ref:<id>` — which is
      // exactly the bug that hid here until gate-web-assets measured properly.
      return own
        .filter((i) => /\/a\/[A-Za-z0-9]+\/raw/.test(i.getAttribute('src') ?? ''))
        .filter((i) => i.complete && i.naturalWidth > 0).length;
    };
    let n = 0;
    while (Date.now() < deadline) { n = count(); if (n > 0) break; await new Promise((r) => setTimeout(r, 100)); }
    return n;
  });

  await page.locator('[data-mx-inline-story]').waitFor();
  return countIn(page);
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
 * document, which is sandboxed without allow-same-origin, so the parent cannot
 * reach `contentDocument` and a page-level dispatch would prove nothing. That
 * unreachability is also why this leg silently asserted nothing for a while —
 * and the feature it covers had in fact been lost. Playwright can evaluate
 * inside an opaque frame even though script cannot, which is what makes a real
 * end-to-end assertion possible here.
 */
async function documentFrame(page) {
  await page.locator('[data-mx-inline-story]').waitFor();
  return page.mainFrame();
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

const browser = await chromium.launch();

// ── 1. the file picker: the guaranteed path ────────────────────────────────
{
  const st = await mint();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await openEditor(page, st);
  await page.setInputFiles('[aria-label="Upload image file"]', { name: 'shot.png', mimeType: 'image/png', buffer: PNG_BUF });
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

  // ── the export pipeline itself renders with the embedded image ───────────
  const exp = await fetch(`${B}/a/${st.id}/export`);
  const buf = Buffer.from(await exp.arrayBuffer());
  check(exp.status === 200 && (exp.headers.get('content-type') ?? '').startsWith('image/') && buf.length > 1000,
    `export renders a real image with the embed (${exp.status}, ${buf.length} bytes)`);
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
  /*
   * Real Chrome where it is installed — the clipboard is what this section is
   * about, and it is the browser people actually paste in. A machine without
   * it (a bare container, a fresh checkout) gets Playwright's own Chromium.
   */
  const chrome = await chromium.launch({ channel: 'chrome', headless: true })
    .catch(() => chromium.launch({ headless: true }));
  const context = await chrome.newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
  const page = await context.newPage();

  const st = await mint();
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

  await page.evaluate(() => navigator.clipboard.writeText('PASTED_TEXT_OK'));
  const para = await frame.$('p');
  await para.click();
  await page.waitForTimeout(400);
  await page.keyboard.press(PASTE);
  await page.waitForTimeout(1200);
  const text = await frame.evaluate(() => document.querySelector('p')?.textContent ?? '');
  check(text.includes('PASTED_TEXT_OK'), `a real text paste lands in the paragraph (got ${JSON.stringify(text)})`);
  check(text.includes('START'), 'and it did not replace what was already there');

  await page.evaluate(async () => {
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
 * The publish pipeline has computed a ~95-byte blurred copy of every image
 * since #157 and stored it in `meta.placeholder`, and NOTHING RENDERED IT for
 * a whole release — because the tests asserted a placeholder was PRODUCED and
 * nothing asserted it was CONSUMED. This is the check whose absence allowed
 * that: it stalls the real bytes and looks at what is on screen meanwhile.
 *
 * A VALID png, deliberately: the 2×2 above is malformed (sharp reads its
 * header, a full decode fails with `vipspng: libpng read error`), so no
 * thumbnail can be made of it and it correctly gets no blur.
 */
{
  const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8dMpruoH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1weeF8xbShDdKgAAAABJRU5ErkJggg==';
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
  const frame = await artifactDocument(page, { timeout: 30_000 });
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

await browser.close();

check.done();

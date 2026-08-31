/**
 * Gate: a human can put an image into a story, three ways, and it sticks.
 *
 * P3's promise is that the file picker, a paste, and a drag all end the same
 * way — the bytes become an unlisted artifact and `<img src="ref:<id>">` is
 * appended through the edit queue — and that leaving the editor persists it
 * (the exact "click done, change lost" class the whole effort started from).
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
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

// A 2×2 red PNG (non-zero dimensions so a real paint is measurable).
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8Dwn4EIwDiqkL4KAcT9GO0U4BxjAAAAAElFTkSuQmCC';
const PNG_BUF = Buffer.from(PNG_B64, 'base64');

const MARKUP = '<div data-design="tw" className="p-10">'
  + '<h1 className="text-4xl font-bold">Image gate</h1>'
  + '<p className="mt-4 text-lg">Body copy.</p></div>';

async function mint() {
  const res = { json: async () => startDocument(B), ok: true, status: 201 }; // start link → token
  const st = await res.json();
  if (!st.id || !st.token) {
    console.error(`cannot mint (${res.status} ${JSON.stringify(st)}).`
      + '\nThe anonymous-mint limit is per-IP and in-memory: restart the dev server to clear it.');
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
      const own = Array.from(document.querySelectorAll('img'));
      const inner = document.querySelector('[aria-label="Story canvas"] iframe');
      const nested = Array.from(inner?.contentDocument?.querySelectorAll('img') ?? []);
      // ONLY artifact images. Every served document carries the credits-footer
      // logo (/logo-128.png), and counting it made this check pass while a
      // freshly inserted image rendered its literal `ref:<id>` — which is
      // exactly the bug that hid here until gate-web-import measured properly.
      return [...own, ...nested]
        .filter((i) => /\/a\/[A-Za-z0-9]+\/raw/.test(i.getAttribute('src') ?? ''))
        .filter((i) => i.complete && i.naturalWidth > 0).length;
    };
    let n = 0;
    while (Date.now() < deadline) { n = count(); if (n > 0) break; await new Promise((r) => setTimeout(r, 100)); }
    return n;
  });

  const docFrameEl = await page.$('iframe[title="artifact"]');
  if (docFrameEl) {
    const f = await docFrameEl.contentFrame();
    if (f) return countIn(f);
  }
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
  const el = await page.$('iframe[title="artifact"]');
  return el ? el.contentFrame() : null;
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
    document.body.dispatchEvent(ev);
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
  ok((await paintedImages(page)) >= 1, 'file picker: the uploaded image paints in the canvas');

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
  ok(/<img[^>]*src="ref:/.test(got), 'the image ref is in the persisted source');
  const view = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await view.goto(`${B}/a/${st.id}`, { waitUntil: 'networkidle' });
  // A fresh page with NO token is exactly the sessionless reader the exporter
  // is — so a paint here proves an unlisted image is reachable without auth,
  // which is why born-unlisted is load-bearing (a private image would 404 here
  // and bake a hole into the export).
  ok((await paintedImages(view)) >= 1, 'and it still paints on a fresh, tokenless read (the exporter is one too)');
  await view.close();

  // ── the export pipeline itself renders with the embedded image ───────────
  const exp = await fetch(`${B}/a/${st.id}/export`);
  const buf = Buffer.from(await exp.arrayBuffer());
  ok(exp.status === 200 && (exp.headers.get('content-type') ?? '').startsWith('image/') && buf.length > 1000,
    `export renders a real image with the embed (${exp.status}, ${buf.length} bytes)`);
  await page.close();
}

// ── 3. drop, inside the iframe realm ───────────────────────────────────────
{
  const st = await mint();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await openEditor(page, st);
  const sent = await dispatchFileEvent(page, 'drop', PNG_B64);
  ok(sent === 'dispatched', 'drag-drop: the event reached the document realm');
  ok(await paintedImages(page) > 0, 'drag-drop inserts an image that actually PAINTS');
  await page.close();
}

// ── 4. paste, inside the iframe realm ──────────────────────────────────────
{
  const st = await mint();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await openEditor(page, st);
  const sent = await dispatchFileEvent(page, 'paste', PNG_B64);
  ok(sent === 'dispatched', 'paste: the event reached the document realm');
  ok(await paintedImages(page) > 0, 'paste inserts an image that actually PAINTS');
  await page.close();
}

await browser.close();

const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : `\nall ${out.length} checks passed`);
process.exit(failed ? 1 : 0);

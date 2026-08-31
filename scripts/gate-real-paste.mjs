/**
 * Gate: a REAL ⌘V, not a synthetic ClipboardEvent.
 *
 * gate-image-upload dispatches a constructed event with a defined
 * `clipboardData`. That proves the handler, the message hop and the upload —
 * but it bypasses the browser's own clipboard path, so it cannot answer the two
 * questions that actually broke:
 *
 *   1. Pasting TEXT must still land in the paragraph. The image listener is
 *      registered with capture:true on the document, so it runs BEFORE the
 *      contentEditable host — it has to be completely transparent when it
 *      declines, or pasting text into a document stops working.
 *   2. Pasting an IMAGE must insert, paint AND PERSIST. It did not: a paste
 *      never blurs the host it happened in, so text pasted a moment earlier was
 *      still uncommitted, and the structural insert composed against a source
 *      that never had it — silently dropping the text. The file picker hid this
 *      because clicking a toolbar button blurs, which commits on the way.
 *
 * Both are invisible to a synthetic event, which is why this gate exists
 * alongside the other one rather than replacing it.
 *
 *   usage: node scripts/gate-real-paste.mjs [base]
 */
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3040';
const MARKUP = '<div className="p-10"><h1 className="text-3xl font-bold">Paste probe</h1>'
  + '<p className="mt-4 text-lg">START </p></div>';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8Dwn4EIwDiqkL4KAcT9GO0U4BxjAAAAAElFTkSuQmCC';

/*
 * The keystroke is the POINT of this gate, so it has to be the one the person
 * at this machine would actually press: ⌘V on a Mac, Ctrl+V everywhere else.
 * Hardcoding Meta+V passed on the laptop it was written on and quietly tested
 * nothing on Linux — the first CI run of the set caught it.
 */
const PASTE = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';

const out = [];
const ok = (c, l) => { const s = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(s); console.log(s); return c; };

const st = await startDocument(B);
await fetch(`${B}/api/artifacts/${st.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
  body: JSON.stringify({ title: 'paste probe', markup: MARKUP, theme: 'modernist' }),
});

/*
 * Real Chrome where it is installed — the clipboard is the one thing this gate
 * is about, and it is the browser people actually paste in. A machine without
 * it (a bare container, a fresh checkout) gets Playwright's own Chromium
 * rather than an error about a browser the gate never explained needing.
 */
const browser = await chromium.launch({ channel: 'chrome', headless: true })
  .catch(() => chromium.launch({ headless: true }));
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
const page = await context.newPage();

await becomeOwner(page, B, st.token);
await page.goto(`${B}/a/${st.id}#edit`, { waitUntil: 'load' });
await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
await page.waitForTimeout(3000);

const frame = await (await page.$('iframe[title="artifact"]')).contentFrame();

// ── 1. a real TEXT paste must land in the paragraph ─────────────────────────
await page.evaluate(() => navigator.clipboard.writeText('PASTED_TEXT_OK'));
const para = await frame.$('p');
await para.click();
await page.waitForTimeout(400);
await page.keyboard.press(PASTE);
await page.waitForTimeout(1200);

const text = await frame.evaluate(() => document.querySelector('p')?.textContent ?? '');
ok(text.includes('PASTED_TEXT_OK'), `a real text paste lands in the paragraph (got ${JSON.stringify(text)})`);
ok(text.includes('START'), 'and it did not replace what was already there');

// ── 2. a real IMAGE paste must insert and paint ─────────────────────────────
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

const painted = await frame.evaluate(async () => {
  const deadline = Date.now() + 8000;
  const count = () => Array.from(document.querySelectorAll('img'))
    .filter((i) => /\/a\/[A-Za-z0-9]+\/raw/.test(i.getAttribute('src') ?? ''))
    .filter((i) => i.complete && i.naturalWidth > 0).length;
  let n = 0;
  while (Date.now() < deadline) { n = count(); if (n > 0) break; await new Promise((r) => setTimeout(r, 150)); }
  return n;
});
ok(painted > 0, `a real image paste inserts an image that PAINTS (${painted})`);

// ── 3. and it persisted ─────────────────────────────────────────────────────
const stored = await fetch(`${B}/api/artifacts/${st.id}`, { headers: { Authorization: `Bearer ${st.token}` } }).then((r) => r.json());
ok(/src="ref:[A-Za-z0-9]{6,12}"/.test(stored.markup ?? ''), 'the image ref reached the stored source');
ok((stored.markup ?? '').includes('PASTED_TEXT_OK'), 'the pasted text reached the stored source');

await browser.close();
const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : `\nall ${out.length} checks passed`);
process.exit(failed ? 1 : 0);

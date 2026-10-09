/**
 * Gate: EXPORTS — what the exporter photographs, checked as pixels.
 *
 * One journey over a shared fixture set (folded in from the former export-slice and social-preview gates, and the
 * PNG/JPEG/card/`?chrome=0` assertions thirteen gates each carried a copy of). The exporter photographs a URL with
 * the SERVER's headless browser, so every claim here is about the picture it returns — which no faked
 * BrowserService can produce. The route's own decisions (parsing, refusals, the cache key) are asserted against the
 * real handler in services/app/__tests__/export.test.ts and export-seam.test.ts.
 *
 *   1. A DECK IS CHECKED ONE SLIDE AT A TIME. An agent reviews its own deck by looking at it, and the only shot it
 *      could ask for was the WHOLE document — six full-viewport slides in one tall PNG, every slide too small to
 *      read. Measured on a real run, Claude Opus 5 guessed `?slide=2`, `?full=1`, `?mode=full` and `?print=1` (all of
 *      which silently returned the same full page), then worked around the gap by PUBLISHING a throwaway document
 *      holding one slide, exporting that, and deleting it. `?slide=N` is that look, done properly: the slice is ONE
 *      SCREEN of the deck, slide 2 differs from slide 1, and a full shot runs past the fold.
 *   2. ONE FORMAT SET: PNG and JPEG bytes, the 1600×840 og card, a repeat served byte for byte from the stored
 *      render, and the capture render (`raw?chrome=0`) carrying no navigation chrome.
 *   3. THE EDITABLE SOCIAL PREVIEW: owner chrome → sharing → cropper → pointer and keyboard → saved card pixels →
 *      reset back to the top-left default. The Helmet directive it writes is asserted on the source in
 *      services/app/lib/document/__tests__/social-preview.test.ts; here only the card's pixels are.
 *
 *   usage: node scripts/gates/gate-exports.mjs [base]
 */
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { launchChromium } from './lib/browser.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import sharp from 'sharp';
import { becomeOwner, startDocument } from '../lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('exports');

// ── the shared fixture set ──────────────────────────────────────────────────
const slide = (n, body) => `<Slide title="Slide ${n}" className="justify-center p-16">${body}</Slide>`;
const DECK =
  '<Helmet><title>Slice gate</title></Helmet>'
  + '<SlideDeck>'
  + slide(1, '<h1 className="text-6xl font-bold">First slide</h1><p className="mt-6 text-lg">The cover of the deck.</p>')
  + slide(2, '<h2 className="text-5xl font-bold">Second slide</h2><p className="mt-6 text-lg">A different claim entirely.</p>')
  + slide(3, '<h2 className="text-5xl font-bold">Third slide</h2><p className="mt-6 text-lg">And a third.</p>')
  + '</SlideDeck>';
// The full shot must run PAST THE FOLD. `/docs/artifactbin/references/publishing-versions.md` promises "the fully
// rendered page" and it was one viewport for every markup document — the shot photographed the app page's iframe
// element, whose box is the viewport.
const TALL = '<div className="p-10"><h1>Tall</h1>'
  + Array.from({ length: 40 }, (_, i) => `<p>filler paragraph ${i}, long enough that this document runs well past a single screen.</p>`).join('')
  + '</div>';
const FIELD = `<Helmet><title>Social preview gate</title><style>{\`
html,body{margin:0}.field{position:relative;width:1600px;height:1000px;background:rgb(51,204,51)}
.top{position:absolute;inset:0 0 auto 0;height:10px;background:rgb(204,51,51)}
.left{position:absolute;inset:0 auto 0 0;width:10px;background:rgb(51,51,204)}
\`}</style></Helmet><div className="field"><div className="top"></div><div className="left"></div></div>`;

const publish = async (body) => {
  const start = await startDocument(BASE);
  const put = await fetch(`${BASE}/api/artifacts/${start.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${start.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ...start, status: put.status, detail: put.ok ? '' : await put.text() };
};

/** PNG dimensions straight from the IHDR chunk — no image library for two integers. */
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

async function shot(id, query = '') {
  const res = await fetch(`${BASE}/a/${id}/export${query}`);
  const type = res.headers.get('content-type') ?? '';
  const body = type.startsWith('image/') ? Buffer.from(await res.arrayBuffer()) : await res.json().catch(() => null);
  return { status: res.status, type, body };
}

const [deck, tallDoc, field] = await Promise.all([
  publish({ title: 'Slice gate', markup: DECK, template: 'deck', theme: 'industry' }),
  publish({ title: 'Tall', markup: TALL }),
  publish({ markup: FIELD }),
]);
check(deck.status === 200, `published the deck (${deck.status})`);
if (field.status !== 200) throw new Error(`seed failed: ${field.status} ${field.detail}`);

// ── 1 + 2: the deck's pictures, over plain HTTP ─────────────────────────────
async function deckLeg(browser) {
  // `whole` is both the slice comparison's full deck and the format set's PNG.
  const whole = await shot(deck.id, '?format=png');
  const [one, two, jpg, card, tall] = await Promise.all([
    shot(deck.id, '?slide=1'), shot(deck.id, '?slide=2'), shot(deck.id, '?format=jpg'),
    shot(deck.id, '?format=png&mode=card'), shot(tallDoc.id),
  ]);

  if (whole.status !== 200 || one.status !== 200) {
    check(false, `renders available (whole ${whole.status}, slide ${one.status}) — is a headless browser installed?`);
  } else {
    const w = pngSize(whole.body);
    const s1 = pngSize(one.body);
    check(s1.height < w.height, `a slide is ONE SCREEN, not the document (slide ${s1.height}px < deck ${w.height}px)`);
    check(s1.height > 200, `a slide is a real screen, not a sliver (${s1.height}px)`);
    check(two.status === 200 && !one.body.equals(two.body), 'slide 2 is a different picture from slide 1');
  }
  check(tall.status === 200 && Buffer.isBuffer(tall.body) && pngSize(tall.body).height > 1000,
    `a full export photographs past the fold (${tall.status === 200 && Buffer.isBuffer(tall.body) ? pngSize(tall.body).height + 'px' : tall.status})`);

  // The format set (from the former full-kit gate; one copy here, where twelve other gates each carried one).
  const pngBytes = Buffer.isBuffer(whole.body) ? whole.body : Buffer.alloc(0);
  check(whole.status === 200 && whole.type === 'image/png', `export renders PNG (${whole.status})`);
  check(pngBytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'export bytes are a real PNG');
  check(pngBytes.length > 1000, `export is a non-trivial image (${pngBytes.length} bytes)`);
  const jpgBytes = Buffer.isBuffer(jpg.body) ? jpg.body : Buffer.alloc(0);
  check(jpgBytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), 'export renders JPEG on request');
  const cardBytes = Buffer.isBuffer(card.body) ? card.body : Buffer.alloc(24);
  check(JSON.stringify(pngSize(cardBytes)) === JSON.stringify({ width: 1600, height: 840 }),
    `mode=card crops to the og ratio (${JSON.stringify(pngSize(cardBytes))})`);
  check(pngBytes.length >= 24 && pngSize(pngBytes).height !== 840, 'the default capture is the full page, not the card');
  // Version-keyed: a repeat fetch is byte-identical (memory + object store).
  const again = await shot(deck.id, '?format=png');
  check(Buffer.isBuffer(again.body) && again.body.equals(pngBytes), 'a repeat export serves the stored render, byte for byte');
  // The capture must not contain the document's own chrome — and must still BE the document, or a refusal body
  // would pass the first half.
  const capture = await fetch(`${BASE}/a/${deck.id}/raw?chrome=0`);
  const bare = await capture.text();
  const page = await browser.newPage({ viewport: { width: 1600, height: 840 } });
  try {
    await page.goto(`${BASE}/a/${deck.id}/raw?chrome=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('mx-story-data') || document.documentElement.hasAttribute('data-mx-ready'));
    for (const selector of ['nav.mx-rail', '[aria-label="Slide controls"]']) {
      const control = page.locator(selector);
      check(await control.count() === 1 && !await control.isVisible(), `capture navigation is retained for hydration but invisible (${selector})`);
    }
    check(await page.locator('.mx-deck > .mx-doc').count() === 1
      && await page.locator('.mx-doc').innerText().then((text) => text.includes('First slide')),
    'capture hydration preserves the deck hierarchy and visible content');
  } finally {
    await page.close();
  }
  check(capture.status === 200 && bare.includes('First slide'), `and still carries the document (${capture.status})`);
}

// ── 3: the editable social preview, in a browser ────────────────────────────
async function socialLeg(browser) {
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${field.token}` };
  const cardOf = async () => {
    const res = await fetch(`${BASE}/a/${field.id}/export?mode=card&format=png&refresh=1`, { headers: auth });
    if (!res.ok) throw new Error(`card failed: ${res.status} ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const rgb = async (bytes, x, y) => {
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    const at = (y * info.width + x) * info.channels;
    return { size: { width: info.width, height: info.height }, color: [...data.subarray(at, at + 3)] };
  };

  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  await becomeOwner(page, BASE, field.token);
  await page.goto(`${BASE}/a/${field.id}`, { waitUntil: 'load' });
  await openArtifactControls(page);
  await page.getByLabel('Owner actions').getByLabel('Share', { exact: true }).click();
  await page.getByRole('dialog', { name: 'Sharing', exact: true }).getByLabel('Edit social preview').click();
  const dialog = page.getByRole('dialog', { name: 'Social preview' });
  await dialog.waitFor();
  await dialog.getByAltText('Artifact preview').waitFor({ state: 'visible', timeout: 30_000 });
  const frame = dialog.getByLabel('Move social preview crop');
  await frame.waitFor({ timeout: 30_000 });

  const handle = dialog.getByLabel('Resize social preview crop');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('resize handle has no layout box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 60, handleBox.y - 30);
  await page.mouse.up();
  check(Number(await handle.getAttribute('aria-valuenow')) < 1600, 'pointer resize changes the locked crop');

  const frameBox = await frame.boundingBox();
  if (!frameBox) throw new Error('crop frame has no layout box');
  await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
  await page.mouse.down();
  // Dragging pans the document: left/up reveals a region farther right/down.
  await page.mouse.move(frameBox.x + frameBox.width / 2 - 20, frameBox.y + frameBox.height / 2 - 12);
  await page.mouse.up();
  check(!String(await frame.getAttribute('aria-valuetext')).startsWith('x 0, y 0,'), 'pointer drag positions the crop');

  await dialog.getByLabel('Reset social preview').click();
  await dialog.getByLabel('Resize social preview crop').press('ArrowLeft');
  await frame.press('ArrowRight');
  await frame.press('ArrowDown');
  check((await frame.getAttribute('aria-valuetext')) === 'x 10, y 10, width 1580', 'keyboard resize and position update the locked crop');
  await dialog.getByText('save preview').click();
  await dialog.waitFor({ state: 'detached' });

  // "save persists canonical {x,y,width} in Helmet" is a source fact: social-preview.test.ts (writeSocialPreviewCrop).
  const selected = await rgb(await cardOf(), 800, 5);
  check(JSON.stringify(selected.size) === JSON.stringify({ width: 1600, height: 840 }), 'saved card is exactly 1600×840');
  check(JSON.stringify(selected.color) === JSON.stringify([51, 204, 51]), `saved card uses the selected source region (${selected.color})`);

  // Reload to prove the frame is restored from persisted source, not dialog state.
  await page.reload({ waitUntil: 'load' });
  await openArtifactControls(page);
  await page.getByLabel('Owner actions').getByLabel('Share', { exact: true }).click();
  await page.getByRole('dialog', { name: 'Sharing', exact: true }).getByLabel('Edit social preview').click();
  const resetDialog = page.getByRole('dialog', { name: 'Social preview' });
  await resetDialog.getByLabel('Move social preview crop').waitFor({ timeout: 30_000 });
  await resetDialog.getByLabel('Reset social preview').click();
  await resetDialog.getByText('save preview').click();
  await resetDialog.waitFor({ state: 'detached' });
  // "reset removes the directive" is a source fact: social-preview.test.ts (writeSocialPreviewCrop(…, null)).
  const reset = await rgb(await cardOf(), 800, 5);
  check(JSON.stringify(reset.color) === JSON.stringify([204, 51, 51]), `reset restores the top-left card (${reset.color})`);
  await page.close();
}

/*
 * The two legs share nothing but the server, so they run side by side; a leg that throws is a failed check and the
 * other still reports. The route's REFUSALS (`?slide=two` → 400 unknown_slide, a slide past the end → the count)
 * are decided by the route alone and asserted in export.test.ts and export-seam.test.ts.
 */
const browser = await launchChromium();
const leg = (name, run) => run().catch((error) => check(false, `${name} could not finish (${String(error?.stack ?? error).split('\n').slice(0, 4).join(' | ')})`));
try {
  await Promise.all([leg('the deck leg', () => deckLeg(browser)), leg('the social preview leg', () => socialLeg(browser))]);
} finally {
  await browser.close();
}

check.done();

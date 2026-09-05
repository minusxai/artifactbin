/**
 * Gate: THERE IS ONE DOCUMENT.
 *
 * Editing used to build a second one — a different iframe, a different origin,
 * a different renderer, a second React root, the dataflow run again and every
 * chart mounted again — and everything that made that bearable (the reading
 * position carried between two renderings, the holds that put it back, the
 * reveal that hid the seam) existed because of it. This gate asserts the thing
 * that replaced all of it, and asserts it by OBJECT IDENTITY, which no amount
 * of timing luck can fake: the frame and the chart embed are the same objects
 * from reading, through typing and an agent's write, and back out again.
 *
 * The second half is the trust model. The author's <script> shares the frame's
 * realm with the editor, so a document that tries to forge an edit must write
 * nothing: the runtime mints its session nonce before that script exists
 * (lib/story-runtime/pristine), and the page drops everything unsigned.
 *
 *   usage: node scripts/gate-inplace-edit.mjs [base]
 */
import { chromium } from 'playwright';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const ok = (pass, label) => { console.log(`${pass ? '  ok ' : 'FAIL '} ${label}`); if (!pass) failures.push(label); };
const note = (label) => console.log(`  ·   ${label}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHART = '{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"x","type":"nominal"},"y":{"field":"y","type":"quantitative"}}}}';
const filler = Array.from({ length: 40 }, (_, i) =>
  `<p id="f${i}">filler paragraph ${i}, long enough that this document scrolls a good way past the fold.</p>`).join('');

const doc = (lede) =>
  '<Helmet><Value name="rows" type="table" value={[{"x":"a","y":1},{"x":"b","y":3}]} /></Helmet>'
  + '<div data-design="tw" className="p-10">'
  + `<h1 id="h" className="text-3xl">In place</h1><p id="lede">${lede}</p>`
  + '<p id="total">Total: 42</p>'
  + `<Question data="$rows" height={280} viz={${CHART}} />`
  + `<p id="after">a paragraph after the chart</p>${filler}</div>`;

const api = async (id, token, path, init) => fetch(`${BASE}/api/artifacts/${id}${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
});

const publish = async (markup) => {
  const start = await startDocument(BASE);
  const res = await api(start.id, start.token, '', { method: 'PUT', body: JSON.stringify({ markup }) });
  if (!res.ok) throw new Error(`PUT → ${res.status} ${await res.text()}`);
  return start;
};

const browser = await chromium.launch();

// ── 1. One document, all the way through ────────────────────────────────────
{
  const start = await publish(doc('the first version'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await becomeOwner(page, BASE, start.token);
  await page.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });
  await page.waitForSelector('iframe[title="artifact"]', { timeout: 30000 });
  await sleep(7000);

  const frame = () => page.frames().find((f) => /\/raw/.test(f.url()));

  // Stamp what must survive, and start counting frame replacements.
  await page.evaluate(() => {
    document.querySelector('iframe[title="artifact"]').__probe = 'same-frame';
    window.__swaps = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (n.nodeType === 1 && n.matches?.('iframe[title="artifact"]')) window.__swaps++;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await frame().evaluate(() => {
    document.querySelector('[aria-label="Question embed"]').__probe = 'same-embed';
    const drawn = document.querySelector('[aria-label="Question embed"] svg, [aria-label="Question embed"] canvas');
    if (drawn) drawn.__probe = 'same-chart';
    window.scrollTo(0, 900);
  });
  await sleep(700);
  const readingAt = await frame().evaluate(() => window.scrollY);
  ok(readingAt > 500, `the reader is somewhere specific before editing (scrollY ${readingAt})`);

  // ENTER
  await openArtifactControls(page);
  await page.click('[aria-label="Edit artifact"]');
  await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 20000 });
  await sleep(3000);
  ok(await page.evaluate(() => window.__swaps) === 0
    && await page.evaluate(() => document.querySelector('iframe[title="artifact"]')?.__probe) === 'same-frame',
    'entering edit did not replace the document');
  ok(Math.abs(await frame().evaluate(() => window.scrollY) - readingAt) < 5,
    'and did not move the reader');
  ok(await frame().evaluate(() => !!document.querySelector('#lede')?.isContentEditable),
    'the document itself became editable');

  /*
   * Focus WITHOUT clicking, and edit something ON SCREEN: both click() and
   * focus() scroll their target into view, so anything else measures the gate
   * scrolling rather than the product.
   */
  const hosts = await frame().evaluate(() => [...document.querySelectorAll('p[id]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.top > 40 && r.bottom < window.innerHeight - 40; })
    .slice(0, 2).map((el) => el.id));
  if (hosts.length !== 2) throw new Error('gate: no visible paragraph pair to edit');
  note(`editing ${hosts[0]}, committing by moving to ${hosts[1]}`);
  const focusHost = (id) => frame().evaluate((hostId) => {
    const el = document.getElementById(hostId);
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, id);

  // TYPE
  const before = await (await api(start.id, start.token, '', {})).json();
  await focusHost(hosts[0]);
  await page.keyboard.type('EDITED IN PLACE');
  await focusHost(hosts[1]);
  await sleep(3500);
  const after = await (await api(start.id, start.token, '', {})).json();
  ok(after.version > before.version, `typing persists with no save (v${before.version} → v${after.version})`);
  ok(after.markup.includes('EDITED IN PLACE'), 'the typed text reached the stored source');
  ok(Math.abs(await frame().evaluate(() => window.scrollY) - readingAt) < 5, 'and typing did not move the reader');

  // AN AGENT WRITES, into the paragraph the cursor is parked in
  const head = await (await api(start.id, start.token, '', {})).json();
  await api(start.id, start.token, '/edits', {
    method: 'POST',
    body: JSON.stringify({ edit_id: head.edit_id, old_string: 'Total:', new_string: 'Agent total:' }),
  });
  await sleep(5000);
  const shown = await frame().evaluate(() => document.body.innerText);
  ok(/Agent total:/.test(shown), "the agent's write reached the open document");
  ok(/EDITED IN PLACE/.test(shown), "and the human's own text survived it");
  ok(await frame().evaluate(() => document.querySelector('[aria-label="Question embed"] svg, [aria-label="Question embed"] canvas')?.__probe) === 'same-chart',
    'the chart kept the svg it had drawn');
  ok(await page.evaluate(() => window.__swaps) === 0, 'and the document was still never replaced');

  // LEAVE
  const leavingAt = await frame().evaluate(() => window.scrollY);
  await page.click('[aria-label="Exit edit mode"]');
  await sleep(3000);
  ok(await page.evaluate(() => window.__swaps) === 0
    && await page.evaluate(() => document.querySelector('iframe[title="artifact"]')?.__probe) === 'same-frame',
    'leaving edit did not replace it either');
  ok(Math.abs(await frame().evaluate(() => window.scrollY) - leavingAt) < 5, 'nor moved the reader on the way out');
  ok(await frame().evaluate(() => !document.querySelector('#lede')?.isContentEditable), 'and the document is no longer editable');
  /*
   * The EMBED is the no-remount promise. Its <svg> is Vega's own: leaving gives
   * the viewport back the editing bar's height, and a responsive view redraws
   * when its container resizes — exactly as it would if the reader resized the
   * window. The svg identity is asserted across the agent's write above, where
   * nothing resizes.
   */
  ok(await frame().evaluate(() => document.querySelector('[aria-label="Question embed"]')?.__probe) === 'same-embed',
    'the chart embed was never remounted across the whole journey');
  await page.close();
}

// ── 2. A document whose author script is hostile ────────────────────────────
{
  const AUTHOR = `
    // Everything a script in this realm can reach, reaching for the write path.
    try { window.top.postMessage({ type: 'mx:text-edit', path: '0.1', innerHtml: 'FORGED BY THE SCRIPT' }, '*'); } catch (e) {}
    try { window.top.postMessage({ type: 'mx:text-edit', nonce: 'guessed', path: '0.1', innerHtml: 'FORGED WITH A GUESS' }, '*'); } catch (e) {}
    setTimeout(function () {
      try { window.top.postMessage({ type: 'mx:text-edit', path: '0.1', innerHtml: 'FORGED LATE' }, '*'); } catch (e) {}
    }, 2500);
  `;
  const markup = `<Helmet><script>{\`${AUTHOR}\`}</script></Helmet>`
    + '<div data-design="tw" className="p-10"><h1 id="h">Scripted</h1><p id="lede">the author wrote this</p>'
    + filler + '</div>';
  const start = await publish(markup);
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await becomeOwner(page, BASE, start.token);
  await page.evaluate(() => { window.__swaps = 0; });
  await page.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });
  await page.waitForSelector('iframe[title="artifact"]', { timeout: 30000 });
  await sleep(6000);
  await page.evaluate(() => {
    document.querySelector('iframe[title="artifact"]').__probe = 'same-frame';
    window.__swaps = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (n.nodeType === 1 && n.matches?.('iframe[title="artifact"]')) window.__swaps++;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  const at = await (await api(start.id, start.token, '', {})).json();
  await openArtifactControls(page);
  await page.click('[aria-label="Edit artifact"]');
  await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 20000 });
  await sleep(5000);

  const frame = () => page.frames().find((f) => /\/raw/.test(f.url()));
  ok(await page.evaluate(() => window.__swaps) === 0
    && await page.evaluate(() => document.querySelector('iframe[title="artifact"]')?.__probe) === 'same-frame',
    'a SCRIPTED document is edited in place too — no swap');
  ok(await frame().evaluate(() => !!document.getElementById('lede')?.isContentEditable),
    'and it is editable');

  const now = await (await api(start.id, start.token, '', {})).json();
  /*
   * Assert the PARAGRAPH, not the absence of the word: the forged payloads
   * appear in the author script's own source, so searching the markup for them
   * finds the attempt rather than its result.
   */
  const lede = /<p id="lede">([^<]*)<\/p>/.exec(now.markup)?.[1] ?? '(gone)';
  ok(lede === 'the author wrote this', `nothing the author script forged reached the document ("${lede}")`);
  ok(now.version === at.version, `and it spent no versions trying (v${at.version} → v${now.version})`);
  await page.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall in-place edit checks passed');
process.exit(failures.length ? 1 : 0);

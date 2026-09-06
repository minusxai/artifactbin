/**
 * Gate: the tracer slice, in a real browser, end to end.
 *
 * The vitest suite proves the document's bytes; what only a browser can prove:
 *
 *   1. the Helmet <script> EXECUTES in view mode (DOM mutation observed)
 *   2. the sandbox holds: opaque origin (no localStorage, no parent reach),
 *      CSP blocks network exfiltration (fetch + img beacon)
 *   3. the author <style> actually paints
 *   4. hydration works: a kit Tab switches on click inside the iframe
 *   5. SSR carried the data: a <Number> over a dataset ref reads correctly
 *   6. a remote edit remounts the iframe (live down-sync survives the switch)
 *   7. the EDIT canvas renders the script statically — it never executes there
 *
 * usage: node scripts/gate-script-slice.mjs [base]   (default :3040)
 */
import { chromium } from 'playwright';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeOwner } from './lib/start-doc.mjs';
import { mintAnon } from './lib/mint-anon.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3040';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const mint = await mintAnon(BASE);
const api = async (path, body, method = 'POST') => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mint.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

const ds = await api('/api/artifacts', { dataset: [{ region: 'NA', revenue: 10 }, { region: 'EU', revenue: 20 }], title: 'rev' });

const SCRIPT = [
  "document.body.dataset.scriptRan = '1';",
  "const el = document.createElement('div'); el.id = 'script-made'; el.textContent = 'made by script'; document.body.appendChild(el);",
  "window.__exfil = 'pending';",
  "fetch('https://example.com/x').then(() => { window.__exfil = 'allowed'; }, () => { window.__exfil = 'blocked'; });",
  "const img = new Image(); img.onload = () => { window.__img = 'allowed'; }; img.onerror = () => { window.__img = 'blocked'; }; img.src = 'https://example.com/pixel.png';",
  "try { void parent.document.title; window.__parent = 'reachable'; } catch { window.__parent = 'blocked'; }",
  "try { localStorage.getItem('x'); window.__storage = 'reachable'; } catch { window.__storage = 'blocked'; }",
].join('\n');

const markup = [
  '<Helmet><title>slice gate</title>',
  `<Query name="rows">{\`select * from ref_${ds.id}\`}</Query>`,
  '<style>{`h1 { color: rgb(200, 10, 10); }`}</style>',
  '<script>{`' + SCRIPT + '`}</script></Helmet>',
  '<h1 className="text-4xl font-bold">Slice doc</h1>',
  `<p>total: <Number data="$rows" col="revenue" agg="sum" /></p>`,
  '<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">Tab one</TabsTrigger><TabsTrigger value="two">Tab two</TabsTrigger></TabsList>',
  '<TabsContent value="one"><p>first pane</p></TabsContent><TabsContent value="two"><p>second pane</p></TabsContent></Tabs>',
].join('\n');

const doc = await api('/api/artifacts', { markup });
console.log(`   doc: ${BASE}/a/${doc.id}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// The shell (and its frame) belongs to the owner; readers get the document.
await becomeOwner(page, BASE, mint.token);
await page.goto(`${BASE}/a/${doc.id}`);

const frameEl = await page.waitForSelector('iframe[title="artifact"]', { timeout: 15000 });
const frame = await frameEl.contentFrame();
await frame.waitForSelector('h1', { timeout: 15000 });

// 1. Script executes only in its own opaque child, never in the rendered document.
const authorFrame = await (await frame.waitForSelector('iframe[title="Isolated artifact script"]', { state: 'attached' })).contentFrame();
await authorFrame.waitForFunction("document.body.dataset.scriptRan === '1'", { timeout: 10000 }).catch(() => {});
check(await authorFrame.evaluate("document.body.dataset.scriptRan === '1'"), 'Helmet script executed in its isolated realm');
check(await authorFrame.evaluate("!!document.getElementById('script-made')"), 'script can only create elements in its own hidden realm');
check(await frame.evaluate("!document.getElementById('script-made') && !document.body.dataset.scriptRan"), 'author script did not mutate the visible document');

// 2. isolation
await authorFrame.waitForFunction("window.__exfil !== 'pending'", { timeout: 10000 }).catch(() => {});
check((await authorFrame.evaluate('window.__exfil')) === 'blocked', 'CSP blocked fetch exfiltration');
check((await authorFrame.evaluate('window.__img')) === 'blocked', 'CSP blocked img beacon');
check((await authorFrame.evaluate('window.__parent')) === 'blocked', 'visible document unreachable from author script');
check((await authorFrame.evaluate('window.__storage')) === 'blocked', 'localStorage unreachable (opaque origin)');

// 3. author style painted
const color = await frame.evaluate("getComputedStyle(document.querySelector('h1')).color");
check(color === 'rgb(200, 10, 10)', `author <style> painted the h1 (${color})`);

/*
 * 5. DATA — paint first, then fill in.
 *
 * This used to read the figure straight out of the SSR'd body, because the
 * server ran every query before sending a byte. It no longer does: the
 * document arrives with its declarations and fetches its own rows, so the
 * value is not in the HTML and IS on the screen a moment later. Both halves
 * are checked, because either one alone would pass for the wrong reason — an
 * absent number could mean paint-first or a broken query, and a present one
 * could mean the fetch worked or that the server quietly ran it anyway.
 */
const served = await (await fetch(`${BASE}/a/${doc.id}/raw`)).text();
check(!served.includes('total: 30'), 'the served HTML does NOT carry the figure — the server ran no query');
/*
 * Re-acquired each time, deliberately. The shell REPLACES the iframe when a
 * document has not announced that it can adopt updates, which is ordinary
 * behaviour a reader never notices — but a Playwright frame handle captured
 * before that points at a document which no longer exists, and polling it
 * waits forever. It never showed before because the figure was server-rendered
 * INTO the dead document's html; now it arrives after a fetch, so only the
 * living frame has it. A browser follows the replacement; a captured handle
 * does not.
 */
const untilInFrame = async (predicate, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const live = await (await page.$('iframe[title="artifact"]'))?.contentFrame();
    if (await live?.evaluate(predicate).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
const arrived = await untilInFrame(() => document.body.innerText.includes('total: 30'));
check(arrived, 'and the document fetched its own rows: the Number reads 30');

// 4. hydration: tab two switches
await frame.click('text=Tab two');
await frame.waitForSelector('text=second pane', { timeout: 10000 }).catch(() => {});
check(await frame.evaluate("document.body.innerText.includes('second pane')"), 'kit Tabs hydrated (tab switch works)');

// 6. remote edit remounts the iframe
const edited = markup.replace('Slice doc', 'Slice doc v2');
await api(`/api/artifacts/${doc.id}/edits`, { edit_id: doc.edit_id, source: edited });
let remounted = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  const f = await (await page.$('iframe[title="artifact"]'))?.contentFrame();
  if (f && (await f.evaluate("document.body.innerText").catch(() => '')).includes('Slice doc v2')) { remounted = true; break; }
}
check(remounted, 'remote edit reached the view (iframe remounted)');

// 6b. The point of author JavaScript: it drives real HTML controls. A
//     document like this could not be authored at all until <button> and the
//     rest of the interactive vocabulary were allowed.
const interactive = await api('/api/artifacts', {
  markup: [
    '<Helmet><script>{`',
    "document.addEventListener('click', function (e) {",
    "  if (e.target && e.target.id === 'tick') {",
    "    var n = document.getElementById('count');",
    "    n.textContent = String(Number(n.textContent) + 1);",
    '  }',
    '});',
    '`}</script></Helmet>',
    '<p id="count">0</p>',
    '<button id="tick">count up</button>',
    '<input id="field" type="text" value="typed" />',
  ].join('\n'),
});
{
  const p2 = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await becomeOwner(p2, BASE, mint.token); // a fresh context owns nothing
  await p2.goto(`${BASE}/a/${interactive.id}`);
  const f2 = await (await p2.waitForSelector('iframe[title="artifact"]', { timeout: 20000 })).contentFrame();
  await f2.waitForSelector('#tick', { timeout: 20000 });
  await p2.waitForTimeout(1500);
  await f2.click('#tick');
  await f2.click('#tick');
  await p2.waitForTimeout(400);
  check((await f2.textContent('#count')) === '0', 'a legacy author DOM listener cannot observe or mutate visible controls');
  // An authored value is the STARTING value, not a binding: React would
  // otherwise make the field controlled with no onChange and refuse input.
  await f2.fill('#field', 'edited by the reader');
  check((await f2.inputValue('#field')) === 'edited by the reader', 'and an authored <input> stays editable');
  await p2.close();
}

// 6c. An author script that THROWS must not take the document with it: it is
//     the author's bug, and the reader should still get the document.
const broken = await api('/api/artifacts', {
  markup: [
    '<Helmet><script>{`throw new Error("author bug");`}</script></Helmet>',
    '<h1>Still readable</h1>',
    '<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger>',
    '<TabsTrigger value="two">Two</TabsTrigger></TabsList>',
    '<TabsContent value="one"><p>pane one</p></TabsContent>',
    '<TabsContent value="two"><p>pane two</p></TabsContent></Tabs>',
  ].join('\n'),
});
{
  const p3 = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await becomeOwner(p3, BASE, mint.token); // a fresh context owns nothing
  await p3.goto(`${BASE}/a/${broken.id}`);
  const f3 = await (await p3.waitForSelector('iframe[title="artifact"]', { timeout: 20000 })).contentFrame();
  await f3.waitForSelector('h1', { timeout: 20000 });
  await p3.waitForTimeout(2500);
  check((await f3.evaluate('document.body.innerText')).includes('Still readable'), 'a throwing author script still renders the document');
  await f3.click('text=Two');
  await p3.waitForTimeout(600);
  check((await f3.evaluate('document.body.innerText')).includes('pane two'), 'and hydration survived it');
  await p3.close();
}

/*
 * 7. EDITING A SCRIPTED DOCUMENT.
 *
 * There is no edit canvas any more, and with it goes the rule that the author's
 * script was rendered statically there. Editing happens in this document, so
 * the script has already run and keeps running — which is the accepted trade
 * (seamless-editing-v2.md §5), paid for by the trust model rather than by a
 * second rendering: what the script CANNOT do is write, because it has no way
 * to sign a message (gate-inplace-edit proves that).
 *
 * What must hold here is that a scripted document is editable at all, in the
 * frame it was already in, without the script being re-run.
 */
await becomeOwner(page, BASE, mint.token);
await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
await page.waitForSelector('iframe[title="artifact"]', { timeout: 30000 });
await page.waitForTimeout(4000);
const documentFrame = () => page.frames().find((f) => /\/raw/.test(f.url()));
await page.evaluate(() => { document.querySelector('iframe[title="artifact"]').__probe = 'same-frame'; });
const runsBefore = await documentFrame().evaluate("document.querySelectorAll('#script-made').length").catch(() => 0);

await openArtifactControls(page);
await page.click('[aria-label="Edit artifact"]');
await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 30000 });
await page.waitForTimeout(4000);

check(await page.evaluate(() => document.querySelector('iframe[title="artifact"]')?.__probe) === 'same-frame',
  'a scripted document is edited in the frame it was already in');
check(await documentFrame().evaluate("!!document.querySelector('h1')?.isContentEditable").catch(() => false),
  'and it becomes editable');
check(await documentFrame().evaluate("document.querySelectorAll('#script-made').length").catch(() => -1) === runsBefore,
  'entering edit did not re-run the author script');

await browser.close();
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1); }
console.log('\nall checks passed');

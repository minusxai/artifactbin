import { inlineStory } from './lib/page-facts.mjs';
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { artifactDocument } from './lib/artifact-document.mjs';
/**
 * Gate: the tracer slice, in a real browser, end to end.
 *
 * The vitest suite proves the document's bytes; what only a browser can prove:
 *
 *   1. a managed Iframe script EXECUTES in view mode (DOM mutation observed)
 *   2. the sandbox holds: opaque origin (no localStorage, no parent reach),
 *      CSP blocks network exfiltration (fetch + img beacon)
 *   3. the author <style> actually paints
 *   4. hydration works: a kit Tab switches on click inside the iframe
 *   5. SSR carried the data: a <Number> over a dataset ref reads correctly
 *   6. a remote edit updates the current document (live down-sync survives the switch)
 *   7. the EDIT canvas renders the script statically — it never executes there
 *   8. authored JS has DATA capability only: forged reader actions and text
 *      edits are refused, an undeclared mutation is refused, and a changed or
 *      removed script replaces or revokes its realm
 *
 * usage: node scripts/gates/gate-script-slice.mjs [base]   (default :3040)
 */
import { chromium } from 'playwright';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeOwner } from '../lib/start-doc.mjs';
import { connectAgent } from './lib/cli-connection.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3040';
const check = createChecker('script-slice');
/** The compiled reader is the only reader. */
/** The path that answered a navigation (`x-mx-reader`), or null. */
const readerOf = (response) => response?.headers()['x-mx-reader'] ?? null;

const mint = await connectAgent(BASE);
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
  "fetch('http://169.254.169.254/latest/meta-data').then(() => { window.__exfil = 'allowed'; }, () => { window.__exfil = 'blocked'; });",
  "const img = new Image(); img.onload = () => { window.__img = 'allowed'; }; img.onerror = () => { window.__img = 'blocked'; }; img.src = 'http://169.254.169.254/pixel.png';",
  "try { void parent.document.title; window.__parent = 'reachable'; } catch { window.__parent = 'blocked'; }",
  "try { localStorage.getItem('x'); window.__storage = 'reachable'; } catch { window.__storage = 'blocked'; }",
].join('\n');

const markup = [
  '<Helmet><title>slice gate</title>',
  `<Import name="rows_data" src="ref:${ds.id}" /><Query name="rows">{\`select * from rows_data.rows\`}</Query>`,
  '<style>{`h1 { color: rgb(200, 10, 10); }`}</style>',
  '</Helmet>',
  '<h1 className="text-4xl font-bold">Slice doc</h1>',
  '<Iframe title="Slice script" height={100}><p>managed script</p><script>{`' + SCRIPT + '`}</script></Iframe>',
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

const frameEl = await inlineStory(page, { timeout: 15000 });
const frame = page.mainFrame();
await frame.waitForSelector('h1', { timeout: 15000 });
const managedRealm = async (host, title) => {
  const outer = host.locator(`iframe[title="${title}"]`); await outer.waitFor({ timeout: 20000 });
  const wrapper = await outer.contentFrame(); const inner = wrapper.locator('iframe'); await inner.waitFor({ timeout: 20000 });
  return (await inner.elementHandle()).contentFrame();
};
const scriptRealm = await managedRealm(frame, 'Slice script');

// 1. script executed
await scriptRealm.waitForFunction("document.body.dataset.scriptRan === '1'", { timeout: 10000 }).catch(() => {});
check(await scriptRealm.evaluate("document.body.dataset.scriptRan === '1'"), 'managed script executed in view mode');
check(await scriptRealm.evaluate("!!document.getElementById('script-made')"), 'script-created element present only in its managed realm');

// 2. isolation
await scriptRealm.waitForFunction("window.__exfil !== 'pending'", { timeout: 10000 }).catch(() => {});
check((await scriptRealm.evaluate('window.__exfil')) === 'blocked', 'CSP blocked fetch exfiltration');
check((await scriptRealm.evaluate('window.__img')) === 'blocked', 'CSP blocked img beacon');
check((await scriptRealm.evaluate('window.__parent')) === 'blocked', 'parent document unreachable (opaque origin)');
check((await scriptRealm.evaluate('window.__storage')) === 'blocked', 'localStorage unreachable (opaque origin)');
check((await frame.locator('#script-made').count()) === 0, 'managed author DOM never enters the document parent');

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
    const live = page.mainFrame();
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
  const f = page.mainFrame();
  if (f && (await f.evaluate("document.body.innerText").catch(() => '')).includes('Slice doc v2')) { remounted = true; break; }
}
check(remounted, 'remote edit reached the view (inline document updated)');

// 6b. The point of author JavaScript: it drives real HTML controls. A
//     document like this could not be authored at all until <button> and the
//     rest of the interactive vocabulary were allowed.
const interactive = await api('/api/artifacts', {
  markup: [
    '<Iframe title="Interactive script" height={120}><script>{`',
    "document.addEventListener('click', function (e) {",
    "  if (e.target && e.target.id === 'tick') {",
    "    var n = document.getElementById('count');",
    "    n.textContent = String(Number(n.textContent) + 1);",
    '  }',
    '});',
    '`}</script>',
    '<p id="count">0</p>',
    '<button id="tick">count up</button>',
    '<input id="field" type="text" value="typed" /></Iframe>',
  ].join('\n'),
});
{
  const p2 = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await becomeOwner(p2, BASE, mint.token); // a fresh context owns nothing
  await p2.goto(`${BASE}/a/${interactive.id}`);
  const f2 = await artifactDocument(p2, { timeout: 20000 });
  const interactiveRealm = await managedRealm(f2, 'Interactive script');
  await interactiveRealm.waitForSelector('#tick', { timeout: 20000 });
  await p2.waitForTimeout(1500);
  await interactiveRealm.click('#tick');
  await interactiveRealm.click('#tick');
  await p2.waitForTimeout(400);
  check((await interactiveRealm.textContent('#count')) === '2', 'a managed author script drives a real <button>');
  // An authored value is the STARTING value, not a binding: React would
  // otherwise make the field controlled with no onChange and refuse input.
  await interactiveRealm.fill('#field', 'edited by the reader');
  check((await interactiveRealm.inputValue('#field')) === 'edited by the reader', 'and an authored <input> stays editable');
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
  const brokenPage = await p3.goto(`${BASE}/a/${broken.id}`);
  check(readerOf(brokenPage) === 'compiled', `a document with a throwing author script is served compiled (${readerOf(brokenPage)}, ${brokenPage?.headers()['x-mx-reader-fallback'] ?? 'no fallback'})`);
  const f3 = await artifactDocument(p3, { timeout: 20000 });
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
 * the script has already run and keeps running — which is the accepted trade,
 * paid for by the trust model rather than by a second rendering: what the
 * script CANNOT do is write, because it has no way to sign a message
 * (gate-inplace-edit proves that).
 *
 * The edit handover replaces the compiled story root by design (spec §7.3).
 */
await becomeOwner(page, BASE, mint.token);
await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
await inlineStory(page);
await page.waitForTimeout(4000);
const documentFrame = () => page.mainFrame();


await openArtifactControls(page);
await page.click('[aria-label="Edit artifact"]');
await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 30000 });
await page.waitForTimeout(4000);



check(await documentFrame().evaluate("!!document.querySelector('h1')?.isContentEditable").catch(() => false),
  'and it becomes editable');
/*
 * 8. AUTHORED JS HAS DATA CAPABILITY, NEVER RENDERER OR ACCOUNT AUTHORITY.
 *
 * Sections 2 and 7 proved what the realm cannot REACH (parent, storage,
 * network, the editor's signing nonce). This one proves what it cannot ASK
 * FOR: the reader actions and text edits it can post to the top window are
 * refused, an undeclared mutation is refused, and the data capability it does
 * have still works — the signal round trip is the control, because a script
 * that simply failed to run would pass every refusal check above.
 */
{
  // Author code runs in the page's QuickJS realm: `top`, `document`, `fetch` and `WebAssembly` do not exist
  // there, so the forging attempts of the frame era are now a report of what is absent.
  const AUTHOR = [
    "mx.set({escape:[typeof top, typeof parent, typeof document, typeof fetch, typeof WebAssembly, typeof XMLHttpRequest].join(',')});",
    "mx.mutate('undeclared').then(()=>mx.set({mutation:'escaped'}),()=>mx.set({mutation:'refused'}));",
    'mx.subscribe(["input","output"],snapshot=>{const input=snapshot.signals.input.value;if(snapshot.signals.output.value!==input*2)void mx.set({output:input*2});});',
    "dom.setText(dom.query('#heading'), 'Script boundary: realm');",
    "mx.set({input:3});",
  ].join('\n');
  const scripted = (code) => '<Helmet>'
    + '<Value name="mutation" type="string" default="waiting" /><Value name="escape" type="string" default="unknown" />'
    + '<Value name="input" type="number" default={0} /><Value name="output" type="number" default={0} />'
    + `<script>{\`${code}\`}</script></Helmet>`
    + '<h1 id="heading">Script boundary</h1>'
    + '<output id="probe-mutation">{$mutation}</output><output id="probe-output">{$output}</output><output id="probe-escape">{$escape}</output>';

  const isolated = await api('/api/artifacts', { title: 'mxmx_test_script_isolation', markup: scripted(AUTHOR) });
  const head = async () => (await fetch(`${BASE}/api/artifacts/${isolated.id}`, {
    headers: { Authorization: `Bearer ${mint.token}` },
  })).json();

  const p4 = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await becomeOwner(p4, BASE, mint.token); // a fresh context owns nothing
  const accountRequests = [];
  p4.on('request', (r) => {
    if (/\/(like|follow|edits|annotations)(?:\?|$)/.test(new URL(r.url()).pathname) && r.method() !== 'GET') {
      accountRequests.push(r.url());
    }
  });
  const isolatedPage = await p4.goto(`${BASE}/a/${isolated.id}`);
  {
    check(readerOf(isolatedPage) === 'compiled', `the author-script document is served compiled (${readerOf(isolatedPage)}, ${isolatedPage?.headers()['x-mx-reader-fallback'] ?? 'no fallback'})`);
    // The same document by itself: compiled, its script only as data, under a policy with no inline script.
    const rawCopy = await fetch(`${BASE}/a/${isolated.id}/raw`);
    const csp = rawCopy.headers.get('content-security-policy') ?? '';
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src ')) ?? '';
    const rawHtml = await rawCopy.text();
    check(rawCopy.headers.get('x-mx-reader') === 'compiled' && /^script-src 'self'/.test(scriptSrc) && !scriptSrc.includes("'unsafe-inline'") && csp.split('; ').includes("frame-src 'self'"),
      `the compiled /raw copy runs no inline script and may frame only same-origin (${scriptSrc})`);
    check(rawHtml.split("mx.mutate('undeclared')").length === 2 && /<script type="application\/json" id="mx-story-data">[^<]*mx\.mutate\('undeclared'\)/.test(rawHtml),
      'its author code is in the JSON data island and nowhere else');
    const wrapper = await fetch(`${BASE}/author-frame`);
    const wrapperCsp = wrapper.headers.get('content-security-policy') ?? '';
    check(wrapper.status === 200 && wrapperCsp.includes('sandbox allow-scripts') && wrapperCsp.includes("frame-src 'none'"),
      'the author-script wrapper answers at /author-frame under its own sandbox policy');
    check((await fetch(`${BASE}/story/author-frame`)).status === 404, 'the retired /story/author-frame alias is absent');
  }
  const f4 = await artifactDocument(p4, { timeout: 20000 });
  const settled = await f4.waitForFunction(
    () => document.querySelector('#probe-mutation')?.textContent === 'refused'
      && document.querySelector('#probe-output')?.textContent === '6',
    null, { timeout: 20000 },
  ).then(() => true, async () => {
    console.error('  isolation state', await f4.locator('output').allTextContents());
    return false;
  });
  check(settled, 'an undeclared mx.mutate() is refused while the declared signal still round-trips (3 → 6)');
  check(await f4.locator('#probe-escape').textContent() === 'undefined,undefined,undefined,undefined,undefined,undefined',
    'author code sees no top, parent, document, fetch, WebAssembly or XMLHttpRequest');
  check(await f4.locator('#heading').textContent() === 'Script boundary: realm', 'and reaches the page only through the dom API');
  check(accountRequests.length === 0,
    `author code invoked no account API (${accountRequests.slice(0, 2).join(', ') || 'none'})`);
  check((await head()).version === 1, 'and nothing reached the source');
  check(await f4.locator('iframe').count() === 0, 'no author frame exists: the script runs in the page\'s interpreter');
  const realmBefore = await f4.evaluate(() => document.documentElement.getAttribute('data-mx-author-realm'));
  check(!!realmBefore, `the running realm is recorded on the document (${realmBefore})`);

  // A changed script replaces its old realm, and a removed script ends it.
  await api(`/api/artifacts/${isolated.id}`, { markup: scripted("mx.set({output:77})") }, 'PUT');
  await f4.waitForFunction(() => document.querySelector('#probe-output')?.textContent === '77', null, { timeout: 20000 });
  check(await f4.evaluate(() => document.documentElement.getAttribute('data-mx-author-realm')) !== realmBefore, 'a changed script replaces its old realm');
  await api(`/api/artifacts/${isolated.id}`, { markup: '<h1 id="heading">Script removed</h1><Card>Still interactive</Card>' }, 'PUT');
  await f4.waitForFunction(() => document.querySelector('#heading')?.textContent === 'Script removed', null, { timeout: 20000 });
  check(await f4.evaluate(() => document.documentElement.getAttribute('data-mx-author-realm')) === null, 'and a removed script ends it');
  await p4.close();
}

await browser.close();
check.done();

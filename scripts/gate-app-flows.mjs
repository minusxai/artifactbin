/**
 * Whole-application flow gate against a RUNNING server:
 *
 *   node scripts/gate-app-flows.mjs [base-url]
 *
 * Everything a user or agent actually does, checked in one pass and seeded by
 * the script itself:
 *   API      — the four content tiers create + serve, exports, versions/revert,
 *              cross-token isolation, refs + delete protection, MCP's 8 tools
 *   AUTH     — signup, duplicate refusal, claim, revoke, login/logout, nav
 *   VIEWER   — themes flip live, a bound select re-runs queries, deck rail + present
 *   EDITOR   — toolbar, title/theme/colorMode, grid drag, slide rename
 *   MOBILE   — no horizontal overflow on the pages people open on a phone
 *
 * Complements the unit suite: these contracts live in the browser (same-origin
 * iframe focus, real drag, session cookies) where jsdom cannot follow.
 *
 * Exits non-zero on the first failing section's summary.
 */
import { chromium } from 'playwright';
import { openArtifactControls, openMenu } from './lib/reveal-chrome.mjs';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';
import { startMailSink, loginViaEmail, isSignedInAs } from './lib/mail-login.mjs';
import { mintAnonResponse } from './lib/mint-anon.mjs';

const B = process.argv[2] ?? 'http://localhost:3000';
const fails = [];
const ok = (c, l) => { console.log(`${c ? '  ok ' : 'FAIL '} ${l}`); if (!c) fails.push(l); };
const J = async (path, init = {}, token) => {
  const res = await fetch(`${B}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  let body = null; try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
};
// Anonymous minting is IP-rate-limited (10/hour). Say so plainly rather than
// failing every later check with an opaque 401.
const mint = async () => {
  const res = await mintAnonResponse(B);
  const r = { status: res.status, body: await res.json().catch(() => null) };
  if (r.status === 429) {
    console.error('\nAnonymous mint is rate-limited (10/hour per IP). Wait for the window, restart the server (the limiter is in-memory), or export GATE_TOKEN=<mx_...> and re-run.');
    process.exit(2);
  }
  if (!r.body?.token) { console.error(`\nCould not mint a token: ${r.status} ${JSON.stringify(r.body)}`); process.exit(2); }
  return r.body.token;
};

// ───────────────────────────── API ─────────────────────────────
console.log('█ API');
const T = process.env.GATE_TOKEN || (await mint());
const T2 = await mint();
const made = {};
const tiers = {
  markup: { markup: '<div data-design="tw" className="p-8"><h1 className="text-3xl font-bold">Tier markup</h1></div>' },
  // Prose and head content are PART of a document now, not tiers of their own.
  prose: { markup: '<Helmet><title>t</title></Helmet><h1>Tier prose</h1><p>Body <strong>bold</strong>.</p>' },
  dataset: { dataset: [{ region: 'EU', month: '2026-01-01', revenue: 100 }, { region: 'NA', month: '2026-01-01', revenue: 300 }, { region: 'EU', month: '2026-02-01', revenue: 150 }, { region: 'NA', month: '2026-02-01', revenue: 250 }] },
  viz: { viz: { description: 'd', engine: 'vega-lite', bindings: [{ name: 'x', label: 'X', accepts: ['nominal'] }], template: { mark: 'bar', encoding: { x: { field: '{{x}}', type: '{{x:kind}}' } } } } },
  image: { image: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>').toString('base64') },
};
for (const [name, body] of Object.entries(tiers)) {
  const r = await J('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: `Tier ${name}`, ...body }) }, T);
  ok(r.status === 201, `create ${name} → 201`);
  made[name] = r.body;
}
// ONE url per artifact: /a/<id> renders the document itself for every tier
// — no redirect — and the machine surfaces hang off that same url.
const head = async (path) => { const r = await fetch(`${B}${path}`, { redirect: 'manual' }); return { status: r.status, ct: r.headers.get('content-type'), r }; };
for (const k of ['markup', 'prose', 'dataset', 'viz', 'image']) {
  const h = await head(`/a/${made[k].id}`);
  ok(h.status === 200 && h.ct?.includes('text/html'), `${k} /a/<id> IS the page (200 html, no redirect)`);
}
ok((await head(`/a/${made.markup.id}/raw`)).ct?.includes('text/html'), 'a document ./raw serves the served page');
ok((await head(`/a/${made.dataset.id}/raw`)).ct?.includes('json'), 'dataset ./raw serves JSON');
ok((await head(`/a/${made.viz.id}/raw`)).ct?.includes('json'), 'viz ./raw serves JSON');
ok((await head(`/a/${made.image.id}/raw`)).ct?.includes('svg'), 'image ./raw serves bytes');
{
  const csp = (await head(`/a/${made.markup.id}/raw`)).r.headers.get('content-security-policy') ?? '';
  ok(csp.includes("default-src 'none'") && csp.includes('sandbox allow-scripts'), 'a document ./raw keeps the sandboxing CSP');
}
for (const k of ['markup', 'prose']) {
  const r = await fetch(`${B}/a/${made[k].id}/export`);
  ok(r.status === 200 && (await r.arrayBuffer()).byteLength > 2000, `${k} exports a PNG`);
}
await J(`/api/artifacts/${made.markup.id}`, { method: 'PUT', body: JSON.stringify({ markup: '<div data-design="tw" className="p-8"><h1 className="text-3xl font-bold">v2</h1></div>' }) }, T);
ok((await J(`/api/artifacts/${made.markup.id}/versions`, {}, T)).body.versions.length === 1, 'versions archives the previous state');
ok((await J(`/api/artifacts/${made.markup.id}/revert`, { method: 'POST', body: JSON.stringify({ version: 1 }) }, T)).body.version === 3, 'revert creates a new head');
ok((await J(`/api/artifacts/${made.markup.id}`, {}, T2)).status === 404, 'another token gets a uniform 404');
ok((await J('/api/artifacts', {}, null)).status === 401, 'no token → 401');
const conflict = await J(`/api/artifacts/${made.markup.id}`, { method: 'PUT', body: JSON.stringify({ markup: '<p className="p-1">x</p>', expectedVersion: 1 }) }, T);
ok(conflict.status === 409 && conflict.body.error === 'version_conflict', 'stale expectedVersion → 409');
const doc = (await J('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'refdoc', markup: `<Helmet><Query name="rows">{\`select * from ref_${made.dataset.id}\`}</Query></Helmet><div data-design="tw" className="p-8"><Question data="$rows" viz={{kind:"table"}} /></div>` }) }, T)).body;
ok((await J(`/api/artifacts/${made.dataset.id}`, { method: 'DELETE' }, T)).status === 409, 'referenced dataset delete → 409');
ok((await J(`/api/artifacts/${made.dataset.id}?force=true`, { method: 'DELETE' }, T)).status === 200, 'force delete breaks the link knowingly');
ok((await fetch(`${B}/a/${doc.id}`)).status === 200, 'a document whose ref died still serves');
ok((await J('/api/artifacts', { method: 'POST', body: JSON.stringify({ markup: '<Nope />' }) }, T)).status === 400, 'unknown component → 400');
const mcp = async (name, args) => {
  const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${T}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const b = await r.json();
  return { isError: b.result?.isError ?? false, data: JSON.parse(b.result?.content?.[0]?.text ?? '{}') };
};
const m = await mcp('create_artifact', { title: 'mcp doc', markup: '<div data-design="tw" className="p-6"><h1 className="text-2xl font-bold">mcp</h1></div>' });
ok(!m.isError && m.data.format === 'markup', 'mcp create_artifact');
ok((await mcp('get_artifact', { id: m.data.id })).data.markup.includes('mcp'), 'mcp get_artifact');
ok((await mcp('update_artifact', { id: m.data.id, markup: '<div data-design="tw" className="p-6"><h1 className="text-2xl font-bold">mcp2</h1></div>' })).data.version === 2, 'mcp update_artifact');
ok((await mcp('list_artifacts', {})).data.artifacts.length > 0, 'mcp list_artifacts');
ok((await mcp('list_versions', { id: m.data.id })).data.versions.length === 1, 'mcp list_versions');
ok(!(await mcp('get_version', { id: m.data.id, version: 1 })).isError, 'mcp get_version');
ok((await mcp('revert_artifact', { id: m.data.id, version: 1 })).data.version === 3, 'mcp revert_artifact');
ok((await mcp('delete_artifact', { id: m.data.id })).data.ok === true, 'mcp delete_artifact');

// seed the documents the UI sections drive
const ds = (await J('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Gate data', dataset: tiers.dataset.dataset }) }, T)).body;
const dataDoc = (await J('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Gate doc', theme: 'modernist', markup: `<Helmet>
<Value name="region" type="string" />
<Query name="regions">{\`select distinct region from ref_${ds.id} order by 1\`}</Query>
<Query name="sales">{\`select * from ref_${ds.id} where $region is null or region = $region\`}</Query>
</Helmet><div data-design="tw" className="@container p-10">
<h1 className="text-4xl font-bold tracking-tight">Gate doc</h1>
<div className="mt-4"><select aria-label="Region" value="$region" options="$regions" /></div>
<p className="mt-4">Total: <Number data="$sales" col="revenue" agg="sum" prefix="$" /></p>
<div className="mt-6 h-64 flex min-h-0 flex-col"><Question title="Rev" data="$sales" viz={{kind:"vega-lite", spec:{mark:"bar", encoding:{x:{field:"month",type:"temporal"}, y:{field:"revenue",type:"quantitative"}}}}} /></div>
</div>` }) }, T)).body;
const deckDoc = (await J('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Gate deck', markup: `<div data-design="tw" className="@container w-full"><SlideDeck>
<Slide title="One" className="flex flex-col items-center justify-center gap-4 text-center"><h1 className="text-6xl font-bold">Slide one</h1></Slide>
<Slide title="Two" className="flex flex-col items-center justify-center gap-4 text-center"><h2 className="text-4xl font-semibold">Slide two</h2></Slide>
<Slide title="Three" className="flex flex-col items-center justify-center gap-4 text-center"><h2 className="text-4xl font-semibold">Slide three</h2></Slide>
</SlideDeck></div>` }) }, T)).body;
const gridDoc = (await J('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Gate grid', markup: `<div data-design="tw" className="@container w-full p-6"><Grid>
<GridItem x={0} y={0} w={4} h={2}><Card className="h-full"><CardHeader><CardTitle>Tile A</CardTitle></CardHeader></Card></GridItem>
<GridItem x={4} y={0} w={4} h={2}><Card className="h-full"><CardHeader><CardTitle>Tile B</CardTitle></CardHeader></Card></GridItem>
</Grid></div>` }) }, T)).body;

const sink = await startMailSink();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const p = await ctx.newPage();
p.on('dialog', (d) => d.accept());
const surface = () => p.frames().find((f) => f !== p.mainFrame());
// Edit is a MODE on the artifact's one url — `#edit` is a fragment, so it
// never reaches the server and never changes the link you share.
const unlock = async (id) => {
  // A browser's credential is the httpOnly session cookie now, not a
  // localStorage token — and the shell that carries edit mode belongs to the
  // owner, so this has to happen BEFORE landing on the document.
  await becomeOwner(p, B, T);
  await p.goto(`${B}/a/${id}#edit`, { waitUntil: 'load' });
  await p.waitForTimeout(4000);
};

// ───────────────────────────── AUTH ─────────────────────────────
console.log('█ AUTH');
const EMAIL = `mxmx_test_appflows_${Date.now().toString(36)}@example.com`;
await p.goto(B, { waitUntil: 'load' });
// All navigation lives behind the hamburger.
await openMenu(p);
ok((await p.locator('[aria-label="Login"]').count()) === 1, 'the menu offers the login link when logged out');
ok((await p.locator('[aria-label="Log in"]').count()) === 0, 'no duplicate "Log in" accessible name');
await p.keyboard.press('Escape');
// One flow for both: a verified code for an unknown address creates the account.
await loginViaEmail(p, B, sink, EMAIL);
const signedIn = () => isSignedInAs(p, EMAIL);
ok(await signedIn(), 'a first login with a code creates the account and signs you in');
ok((await p.locator('[aria-label="Password"]').count()) === 0, 'no password is asked for anywhere');
const claimToken = await mint();
await J('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Claimed artifact', markup: '<h1>claimed</h1>' }) }, claimToken);
await p.goto(`${B}/account`, { waitUntil: 'load' });
await p.fill('[aria-label="Token to claim"]', claimToken); await p.click('[aria-label="Claim token"]'); await p.waitForTimeout(3000);
await p.goto(`${B}/`, { waitUntil: 'load' }); await p.waitForTimeout(1000);
ok((await p.getByText('Claimed artifact').count()) > 0, 'claimed artifacts appear on the dashboard');
await p.goto(`${B}/account`, { waitUntil: 'load' }); await p.waitForTimeout(800);
const revoke = p.locator('[aria-label^="Revoke token"]').first();
if (await revoke.count()) {
  await revoke.click(); await p.waitForTimeout(2500);
  ok((await fetch(`${B}/api/artifacts`, { headers: { Authorization: `Bearer ${claimToken}` } })).status === 401, 'revoked token stops working');
} else ok(false, 'tokens page offers revoke');
await openMenu(p);
await p.click('[aria-label="Sign out"]'); await p.waitForTimeout(3000);
await openMenu(p);
ok(!(await signedIn()) && await p.locator('[aria-label="Login"]').isVisible(), 'sign out clears the session');
// Logging back in to the SAME address must reuse the account, not make a second.
await loginViaEmail(p, B, sink, EMAIL);
ok(await signedIn(), 'log back in with a fresh code works');

// ───────────────────────────── VIEWER ─────────────────────────────
console.log('█ SANDBOX');
// Two shapes, one guarantee. For the OWNER the document is a child frame of the
// app, which is only safe while that frame keeps an OPAQUE origin — the parent
// holds the session cookie, and author JS must not reach it. For everyone else
// the document is served top-level, where the same opacity is what stops it
// touching the app at all (proved end-to-end in gate-secure-arch).
//
// A fresh context, holding only the token that owns this document: the AUTH
// section above signed a DIFFERENT user in, and a signed-in non-owner is a
// reader — served the document, with no frame to probe.
const ownerCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const op = await ownerCtx.newPage();
await becomeOwner(op, B, T);
await op.goto(`${B}/a/${made.markup.id}`, { waitUntil: 'load' });
{
  const probe = await op.evaluate(() => {
    const f = document.querySelector('iframe[title="artifact"]');
    if (!f) return { missing: true };
    let readable = true;
    try { readable = !!f.contentDocument; } catch { readable = false; }
    return { sandbox: f.getAttribute('sandbox') || '', readable };
  });
  ok(!probe.missing && probe.sandbox.includes('allow-scripts') && !probe.sandbox.includes('allow-same-origin'),
     'the document renders in a frame sandboxed without allow-same-origin');
  ok(probe.readable === false, 'the artifact frame is opaque to the app page (cannot reach its storage)');
}

// And the reader's copy — same document, no frame, still opaque.
{
  const readerCtx = await browser.newContext();
  const rp = await readerCtx.newPage();
  await rp.goto(`${B}/a/${made.markup.id}`, { waitUntil: 'load' });
  ok((await rp.locator('iframe[title="artifact"]').count()) === 0, 'a reader is served the document itself, with no app frame');
  const opaque = await rp.evaluate(() => { try { void localStorage.length; return false; } catch { return true; } });
  ok(opaque, 'and that document has an opaque origin — storage is unreachable inside it');
  await readerCtx.close();
}
await ownerCtx.close();

console.log('█ VIEWER');
// dataDoc belongs to token T, and ownership resolves SESSION FIRST — so while
// the AUTH section's user is signed in, they simply don't own this document and
// get no owner chrome. Drop back to the token that does.
// Wherever the menu lives now (the bar, a document's own chrome, a framed
// document's), open it if it is there at all.
if (await openMenu(p, { timeout: 8000 }).then(() => true, () => false)) {
  if (await p.locator('[aria-label="Sign out"]').count()) {
    await p.click('[aria-label="Sign out"]');
    await p.waitForTimeout(2500);
  } else {
    await p.keyboard.press('Escape');
  }
}
// A browser's credential is the httpOnly session cookie now, not a
// localStorage token — and the shell belongs to the OWNER, which after the
// sign-out above is whoever holds T.
await becomeOwner(p, B, T);
await p.goto(`${B}/a/${dataDoc.id}`, { waitUntil: 'load' });
await p.waitForTimeout(3500);

// The document is the SERVED page in a sandboxed frame now, so everything a
// reader sees is asserted inside that frame — the theme included.
const themeOf = async () => surface()?.locator('[data-theme]').first().getAttribute('data-theme').catch(() => null);
ok((await themeOf()) === 'modernist', 'the served document carries the authored theme');
const before = (await surface().getByText('Total:').first().textContent()).trim();
await surface().locator('select').first().selectOption('EU');
// Wait for the CHANGE, not a fixed time: the relay's first hop compiles the
// query route under `next dev`, and a cold hit lands just past a 2.5 s wait.
let after = before;
for (let i = 0; i < 32 && after === before; i++) { await p.waitForTimeout(250); after = (await surface().getByText('Total:').first().textContent()).trim(); }
ok(before !== after, 'a bound select re-runs the query and the live Number follows');
ok((await surface().locator('svg.marks, canvas').count()) > 0, 'chart renders');
await openArtifactControls(p);
ok((await p.locator('[aria-label="Edit artifact"]').count()) === 1, 'artifact controls offer Edit to the owner');
// LIGHT is the app's default and carries NO attribute (app/globals.css puts
// it on bare `:root`), so DARK is the one that gets stamped — the reverse of
// what this read when dark was the default, which is exactly the shape of
// drift a gate reading the attribute is here to catch.
await p.click('[aria-label="Light mode"]');
await p.waitForFunction(() => !document.documentElement.dataset.theme);
await surface().locator('html:not(.dark)').waitFor({ timeout: 8000 });
ok(true, 'one appearance choice turns both the app and document light');
await p.click('[aria-label="Dark mode"]');
await p.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
await surface().locator('html.dark').waitFor({ timeout: 8000 });
ok(true, 'the same appearance choice turns both the app and document dark');
await p.keyboard.press('Escape');

// A deck's navigation lives INSIDE the document (scripts/gate-deck-chrome.mjs
// covers it in depth); here we only prove it is there and drives the document.
await p.goto(`${B}/a/${deckDoc.id}`, { waitUntil: 'load' });
await p.waitForTimeout(3800);
const deck = surface();
ok((await deck.locator('.mx-rail-row').count()) === 3, 'deck rail lists every slide');
await deck.click('[aria-label="Go to slide 3: Three"]'); await p.waitForTimeout(1500);
// Scoped to the document column: the rail's previews are real <Slide>
// elements too, so an unscoped query measures a miniature.
ok(await deck.evaluate("Math.abs(document.querySelectorAll('.mx-doc [data-mx-slide]')[2].getBoundingClientRect().top) < 60"),
   'rail click scrolls to the slide');
ok((await deck.locator('[aria-label="Slide position"]').count()) === 1, 'the present bar is there');
await deck.click('[aria-label="Previous slide"]'); await p.waitForTimeout(1200);
ok((await deck.locator('[aria-label="Slide position"]').textContent()).startsWith('2'), 'paging works');

// ───────────────────────────── EDITOR ─────────────────────────────
console.log('█ EDITOR');
await unlock(dataDoc.id);
ok((await surface().locator('svg.marks, canvas').count()) > 0, 'embeds render inside the editor');
await surface().locator('h1').first().click(); await p.waitForTimeout(900);
ok((await p.locator('[aria-label="Typography toolbar"]').count()) === 1, 'clicking text opens the toolbar');
const cls = async () => surface().locator('h1').first().getAttribute('class');
const c0 = await cls();
await p.click('[aria-label="Increase font size"]'); await p.waitForTimeout(500);
ok((await cls()) !== c0, 'font-size step applies');
await p.click('[aria-label="Toggle italic"]'); await p.waitForTimeout(500);
await p.click('[aria-label="Align center"]'); await p.waitForTimeout(500);
await p.fill('[aria-label="Title"]', 'Gate doc renamed');
// Colour mode FIRST: a theme that pins its mode hides this toggle entirely
// (JsxArtifactEditor renders it only when storyThemeMode(theme) is null), so
// doing it after the pick would be waiting for a control that is gone by design.
if (await p.locator('[aria-label="Toggle color mode"]').count()) {
  await p.click('[aria-label="Toggle color mode"]');
  await p.waitForTimeout(600);
}
// Dropdown: the per-theme buttons only exist once the picker is open.
await p.click('[aria-label="Theme"]'); await p.waitForSelector('[aria-label="Theme organic"]', { timeout: 10_000 });
await p.click('[aria-label="Theme organic"]'); await p.waitForTimeout(600);
ok((await p.locator('[aria-label="Toggle color mode"]').count()) === 0, 'a theme that pins its colour mode hides the toggle');
// SAVE-LESS: nothing is clicked here. The edits above must persist on their
// own within one debounce window.
ok((await p.locator('[aria-label="Save"]').count()) === 0, 'there is no Save button');
await p.waitForTimeout(3000);
const saved = (await J(`/api/artifacts/${dataDoc.id}`, {}, T)).body;
ok(saved.markup.includes('italic') && saved.markup.includes('text-center'), 'toolbar edits persist with no save');
// colorMode is no longer asserted here: a pinning theme owns the surface mode
// (storyThemeMode), so the stored field is not what the reader sees and the
// toggle that used to set it is hidden for such themes.
ok(saved.title === 'Gate doc renamed' && saved.theme === 'organic', 'title and theme persist with no save');
// The old "vN · saved" chip is gone — the editor is save-less. The version
// advancing is the same claim, anchored on the server.
ok(saved.version > dataDoc.version, `persistence advanced the version (v${dataDoc.version} → v${saved.version})`);
await unlock(gridDoc.id);
const box = await surface().locator('.react-grid-item').first().boundingBox().catch(() => null);
if (box) {
  await p.mouse.move(box.x + box.width / 2, box.y + 20);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 260, box.y + 200, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(3000);
  ok(!/x=\{0\} y=\{0\}[\s\S]{0,120}Tile A/.test((await J(`/api/artifacts/${gridDoc.id}`, {}, T)).body.markup), 'grid drag writes coordinates back with no save');
} else ok(false, 'grid items are draggable in edit mode');
await unlock(deckDoc.id);
await p.waitForTimeout(1200);
/*
 * The rail is the DOCUMENT's own chrome now, so its rename affordance lives in
 * the frame — `page.click` only ever searched the main frame, which is why
 * this had to move rather than merely be renamed.
 */
await surface().click('[aria-label="Edit slide 2 title"]');
await surface().fill('[aria-label="Slide 2 title"]', 'Renamed two');
await surface().press('[aria-label="Slide 2 title"]', 'Enter');
await p.waitForTimeout(3000);
ok((await J(`/api/artifacts/${deckDoc.id}`, {}, T)).body.markup.includes('Renamed two'), 'slide rename persists with no save');

// ───────────────────────────── MOBILE ─────────────────────────────
console.log('█ MOBILE');
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await mctx.newPage();
const overflow = async () => mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
for (const [label, url] of [['viewer', `/a/${dataDoc.id}`], ['deck', `/a/${deckDoc.id}`], ['docs', '/docs'], ['login', '/login']]) {
  await mp.goto(`${B}${url}`, { waitUntil: 'load' });
  await mp.waitForTimeout(2000);
  ok((await overflow()) <= 2, `${label}: no horizontal scroll`);
}
// Ownership first: the shell that carries edit mode belongs to the owner.
await becomeOwner(mp, B, T);
await mp.goto(`${B}/a/${dataDoc.id}#edit`, { waitUntil: 'load' });
await mp.waitForTimeout(4000);
ok(await mp.locator('[aria-label="Exit edit mode"]').isVisible(), 'editor chrome is reachable on a phone');
ok((await overflow()) <= 2, 'editor: no horizontal scroll');
await mctx.close();
sink.close();

await browser.close();
if (fails.length) { console.error(`\n${fails.length} check(s) failed:\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('\nall app-flow gates passed');

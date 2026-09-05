/**
 * The human path, end to end, against a RUNNING server:
 *
 *   node scripts/gate-editor-flow.mjs [base-url]
 *
 *   1. anonymous mint → publish a document with live embeds
 *   2. /a/<id> shows it → its Edit button switches to edit mode in place
 *   3. adopting the anonymous token unlocks the editor; embeds render inside it
 *   4. type into a heading → ONE click on Save persists it (the regression
 *      this gate exists for: the engine commits text edits on BLUR, so a
 *      Save gated on a dirty flag stayed disabled and swallowed the click)
 *   5. embeds still render after the save; the source really changed
 *   6. signup → claim the token on /account → the artifact appears on the
 *      dashboard → the editor opens with NO stored token (session auth) and
 *      saves through /api/my
 *
 * jsdom cannot model same-origin iframe focus/blur, so this browser gate is
 * the only place these contracts can be checked. Exits non-zero on failure.
 */
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
import { mintAnon } from './lib/mint-anon.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const api = async (path, init = {}, token) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

// ── 1. seed: a document with a bound select, a Number and a chart over a query ──
const { token } = await mintAnon(BASE);
const dataset = await api('/api/artifacts', {
  method: 'POST',
  body: JSON.stringify({ title: 'Editor gate dataset', dataset: [
    { region: 'EU', month: '2026-01-01', revenue: 120 }, { region: 'NA', month: '2026-01-01', revenue: 180 },
    { region: 'EU', month: '2026-02-01', revenue: 150 }, { region: 'NA', month: '2026-02-01', revenue: 210 },
  ] }),
}, token);
const markup = `<Helmet>
<Value name="region" type="string" />
<Query name="regions">{\`select distinct region from ref_${dataset.id} order by 1\`}</Query>
<Query name="sales">{\`select * from ref_${dataset.id} where $region is null or region = $region\`}</Query>
</Helmet><div data-design="tw" className="@container p-10">
<h1 className="text-4xl font-bold tracking-tight">Editor gate</h1>
<div className="mt-4"><select aria-label="Region" value="$region" options="$regions" /></div>
<p className="mt-4">Total: <Number data="$sales" col="revenue" agg="sum" prefix="$" /></p>
<div className="mt-6 h-72 flex min-h-0 flex-col"><Question title="Revenue" data="$sales" viz={{kind:"vega-lite", spec:{mark:"bar", encoding:{x:{field:"month",type:"temporal"}, y:{field:"revenue",type:"quantitative"}}}}} /></div>
</div>`;
const doc = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Editor gate', markup }) }, token);

const sink = await startMailSink();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();

// ── 2-3. reader sees no owner chrome → #edit deep link → token unlock ──
await page.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
await page.waitForTimeout(2000);
// No token in this browser: the viewer bar (theme/edit) is owner chrome and
// must not render. The way into edit mode without it is the #edit fragment.
check((await page.locator('[aria-label="Edit this document"]').count()) === 0, 'a reader with no token sees no edit chrome');
await page.goto(`${BASE}/a/${doc.id}#edit`);
await page.waitForTimeout(2500);
check(page.url().includes(`/a/${doc.id}`) && page.url().endsWith('#edit'), `Edit stays on the same url, as a mode (${page.url()})`);

// Exchange the bearer for the httpOnly browser session cookie; from then on
// this browser IS the anonymous owner. The signed-out home intentionally has
// no token browser now: it leads with account login instead.
await becomeOwner(page, BASE, token);
await page.goto(`${BASE}/a/${doc.id}#edit`, { waitUntil: 'load' });
await page.waitForTimeout(4500);
let frame = page.frames().find((f) => f !== page.mainFrame());
check(!!frame, 'story surface mounted in the editor');
check((await frame.locator('svg.marks, canvas').count()) > 0, 'embeds render inside the editor');

// ── 4-5. type; it persists on its own (no Save button exists) ──
check((await page.locator('[aria-label="Save"]').count()) === 0, 'the editor has no Save button');
const beforeTyping = (await api(`/api/artifacts/${doc.id}`, {}, token)).version;
await frame.locator('h1').first().click({ clickCount: 3 });
await page.keyboard.type('Edited by the gate');
// Blur commits the text edit (engine invariant), then the buffer drains itself.
// Blur the host DIRECTLY rather than clicking the next paragraph: selecting the
// heading pops the Typography toolbar, which is `fixed` right below it and
// covers this document's only <p> — so the click could never land and the gate
// sat in Playwright's retry loop until it timed out. What is under test is that
// typing persists WITHOUT a save, not which gesture ends the edit; the gesture
// itself is gate-inplace-edit's subject, where the hosts are chosen clear of it.
await frame.locator('h1').first().evaluate((el) => el.blur());
await page.waitForTimeout(3000);
// The old "saving… / vN · saved" chip is gone — the markup editor is save-less
// and shows no status. The server is the stronger anchor for the same claim.
const readBack = await api(`/api/artifacts/${doc.id}`, {}, token);
check(readBack.version > beforeTyping, `typing persists with no save (v${beforeTyping} → v${readBack.version})`);
check(readBack.markup.includes('Edited by the gate'), 'the typed text reached the stored source');
frame = page.frames().find((f) => f !== page.mainFrame());
check((await frame.locator('svg.marks, canvas').count()) > 0, 'embeds still render after persisting');

// Idle must not spend versions: nothing typed ⇒ nothing written.
const quiet = (await api(`/api/artifacts/${doc.id}`, {}, token)).version;
await page.waitForTimeout(2000);
check(((await api(`/api/artifacts/${doc.id}`, {}, token)).version) === quiet, 'an idle editor writes nothing');

// ── 5b. an AGENT edit to a DIFFERENT node reaches the OPEN, IDLE editor live ──
const head = await api(`/api/artifacts/${doc.id}`, {}, token);
const agentEdit = await api(`/api/artifacts/${doc.id}/edits`, {
  method: 'POST',
  body: JSON.stringify({ edit_id: head.edit_id, old_string: 'Total:', new_string: 'Agent total:' }),
}, token);
check(agentEdit.markup.includes('Agent total:'), 'a concurrent agent edit applies while a human has the editor open');
await page.waitForTimeout(3500);
frame = page.frames().find((f) => f !== page.mainFrame());
const shown = await frame.locator('body').innerText();
check(/Agent total:/.test(shown), 'the idle editor adopted the agent edit without a reload');
check(/Edited by the gate/.test(shown), "the human's own text survived the adoption");

// ── 5c. the source pane mounts a real editor, served from THIS origin ──
/*
 * `@monaco-editor/react` does not bundle Monaco: left to itself it injects a
 * <script> pointing at jsdelivr, and the app's own CSP (`script-src 'self'`)
 * refuses it — so `code` mode showed "Loading…" forever, in development and on
 * the deployment alike. Nothing in the unit suite could see it: the editor's UI
 * test mocks `@monaco-editor/react` outright, so the loader never runs there.
 * The two halves of the fix are both checked here — the editor really mounts,
 * and it did so without reaching off-origin for it.
 */
const offOrigin = [];
const cspErrors = [];
page.on('requestfailed', (r) => { if (!r.url().startsWith(BASE)) offOrigin.push(`${r.url()} (${r.failure()?.errorText})`); });
page.on('request', (r) => { if (r.resourceType() === 'script' && !r.url().startsWith(BASE)) offOrigin.push(r.url()); });
// script-src only: the dev server's own HMR websocket trips a connect-src
// violation that has nothing to do with the editor.
page.on('console', (m) => { if (m.type() === 'error' && /violates the following Content Security Policy directive: "script-src/.test(m.text())) cspErrors.push(m.text()); });

await page.goto(`${BASE}/a/${doc.id}#edit`, { waitUntil: 'load' });
await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
await page.waitForTimeout(2500);
await page.click('[aria-label="Edit the source"]');
const mounted = await page.waitForSelector('[aria-label="Markup source"]', { timeout: 30_000 }).then(() => true).catch(() => false);
check(mounted, 'the source pane mounts a real editor, not a permanent "Loading…"');
check((await page.locator('[aria-label="Source pane"]').getByText('Loading...').count()) === 0,
  'and the loading placeholder is gone');
/*
 * The pane is the document's own markup, not an empty buffer. Two things make a
 * naive substring check lie: Monaco paints U+00A0 for every space, and it
 * renders only the LINES currently on screen (and only the visible span of a
 * long one) — so a word that is plainly there can be absent from the DOM. Check
 * the direction that holds regardless: whatever it is showing is really a piece
 * of this document, and it is showing something.
 */
const flat = (t) => t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const lines = await page.locator('[aria-label="Source pane"] .view-line').allTextContents();
const stored = flat((await api(`/api/artifacts/${doc.id}`, {}, token)).markup);
// Not a containment check on the whole pane: Monaco also virtualises a long
// line HORIZONTALLY, so the joined text has gaps in it and matches nothing.
// What holds is that it is showing this document, from the top.
check(lines.length >= 3 && stored.startsWith(flat(lines[0])) && flat(lines[0]).length > 0,
  `the pane carries the document source (${lines.length} lines from ${JSON.stringify(flat(lines[0]).slice(0, 30))})`);
check(offOrigin.length === 0, `the editor loads no off-origin script (${offOrigin.slice(0, 2).join(', ') || 'none'})`);
check(cspErrors.length === 0, `and trips no CSP directive (${cspErrors.slice(0, 1).join(' ') || 'none'})`);

/*
 * AND TYPING INTO IT MUST NOT LOSE CHARACTERS. A controlled <Editor value> is
 * a race: every keystroke sets React state, and a render that lands one
 * keystroke behind pushes that STALE string back into Monaco's model, wiping
 * whatever was typed in between. Measured before the fix, at full speed:
 * "typed in code mode" reached the server as "typemode", while the same words
 * at 150ms a key arrived whole — which is exactly why no hand test would ever
 * have found it. So this types with NO delay, and compares exactly.
 */
const typed = ' plus fast typing';
await page.click('[aria-label="Source pane"] .view-lines');
await page.keyboard.press('End');
await page.keyboard.type(typed);            // no `delay`: the race needs speed
await page.waitForTimeout(4000);
const afterTyping = (await api(`/api/artifacts/${doc.id}`, {}, token)).markup;
check(afterTyping.endsWith(typed), `fast typing in the code pane loses nothing (…${JSON.stringify(afterTyping.slice(-24))})`);

// The other half of the same contract: local typing must not move the model,
// but a replacement from OUTSIDE still must. Monaco paints U+00A0 for spaces.
const paneHead = await api(`/api/artifacts/${doc.id}`, {}, token);
await api(`/api/artifacts/${doc.id}/edits`, {
  method: 'POST',
  body: JSON.stringify({ edit_id: paneHead.edit_id, old_string: 'Agent total:', new_string: 'Agent wrote while code was open:' }),
}, token);
await page.waitForTimeout(6000);
const paneAfter = ((await page.locator('[aria-label="Source pane"] .view-lines').textContent().catch(() => '')) ?? '')
  .replace(/\u00a0/g, ' ');
check(paneAfter.includes('Agent wrote while code was open:'), 'and the open code pane still adopts an agent edit');


// ── 5d. a token for a DIFFERENT artifact must not open a working editor ──
// The editor is seeded from the page for speed, so `art` exists before we know
// whether this browser can WRITE. Without the ownership check first, a visitor
// holding someone else's token gets a full editor whose every save fails.
{
  // A fresh CONTEXT, so it carries none of this one's cookies.
  const strangerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const stranger = await strangerCtx.newPage();
  const other = await mintAnon(BASE);
  // Holding SOMEONE ELSE's token: a credential, but not for this document.
  await becomeOwner(stranger, BASE, other.token);
  await stranger.goto(`${BASE}/a/${doc.id}#edit`, { waitUntil: 'load' });
  await stranger.waitForTimeout(4500);
  // They are not this document's owner, so they are served the document —
  // there is no editor, and no owner chrome anywhere on it.
  check((await stranger.locator('[aria-label="Exit edit mode"]').count()) === 0,
    'no editor chrome is offered to someone who cannot save');
  check((await stranger.locator('[aria-label="Edit this document"], [aria-label="Edit artifact"]').count()) === 0,
    'nor any other owner affordance');
  await strangerCtx.close();
}

// ── 6. log in (email + code) → claim → session-authed edit ──
// There is no separate signup: a verified code for an unknown address creates
// the account, so this one call covers what used to be /signup.
const email = `mxmx_test_editor_${Date.now().toString(36)}@example.com`;
await loginViaEmail(page, BASE, sink, email);
// Signed in is the masthead's identity line — the handle, linking to the
// profile — since the header stopped printing the address (components/HeaderBar).
check((await page.locator('[aria-label="Open your profile"]').count()) === 1, 'logging in with a code signs you in');
await page.goto(`${BASE}/account`, { waitUntil: 'load' });
await page.fill('[aria-label="Token to claim"]', token);
await page.click('[aria-label="Claim token"]');
await page.waitForTimeout(3000);
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
// The dashboard lists by artifact TITLE (unchanged by a body edit), not by heading text.
check((await page.getByText('Editor gate', { exact: false }).count()) > 0, 'claimed artifact appears on the dashboard');

await page.goto(`${BASE}/a/${doc.id}#edit`, { waitUntil: 'load' });
await page.waitForTimeout(4500);
check((await page.locator('[aria-label="Owning token"]').count()) === 0, 'a signed-in owner opens the editor with nothing to paste');
frame = page.frames().find((f) => f !== page.mainFrame());
await frame.locator('h1').first().click({ clickCount: 3 });
await page.keyboard.type('Edited by the session');
// Blurred, not clicked away — same reason as the token-authed pass above.
await frame.locator('h1').first().evaluate((el) => el.blur());
await page.waitForTimeout(3000);
check((await api(`/api/artifacts/${doc.id}`, {}, token)).markup.includes('Edited by the session'),
  'session-authed editing persists through /api/my/artifacts/<id>/edits with no save');

await browser.close();
sink.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nall editor-flow gates passed');

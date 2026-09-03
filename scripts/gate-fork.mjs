/**
 * Gate: FORK, and the `?intent=` round trip that carries it through login.
 *
 * The vitest suite proves each half in process — the door's ACL, the row, the
 * anchor's two hrefs, the strip. What only a browser can prove is that they are
 * ONE journey: a logged-out reader is served the sandboxed document TOP-LEVEL,
 * so the fork control they see is an anchor inside an opaque origin, and the
 * ask has to survive a top navigation, a login, a canonical redirect and a
 * mount before anything happens. Every one of those is a place the instruction
 * could be dropped, and none of them exists in a unit test.
 *
 *   1. A (logged in) publishes a public document
 *   2. an ANONYMOUS `?intent=fork` fetch is still the DOCUMENT — the parameter
 *      is not a lever a stranger can pull on a shared link
 *   3. B (logged out) opens it top-level, opens the reader controls, taps Fork
 *   4. B lands on /login carrying the ask, and logs in THERE (the round trip is
 *      the point, so the login is driven on the page the anchor produced)
 *   5. B is returned to the document with the CONFIRM open, and confirms
 *   6. B lands on their own copy — its own URL, `forked_from` on the owner
 *      wire — and the copy's footer credits name the source
 *   7. invited as a commenter, B opens the source with `?intent=comment` and
 *      the rail is open
 *
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use
 * `npm run dev:otp -- <email>` if a human owns the server terminal.
 *
 *   node scripts/gate-fork.mjs [base]
 */
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
import { mintAnon } from './lib/mint-anon.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };
const stamp = Date.now().toString(36);
const OWNER_EMAIL = `mxmx_test_fork_owner_${stamp}@example.com`;
const FORKER_EMAIL = `mxmx_test_fork_${stamp}@example.com`;

/**
 * The login form, driven WHERE IT ALREADY IS. `loginViaEmail` navigates to
 * /login first, which would throw away the callbackUrl the fork anchor just
 * put there — and the callbackUrl is the thing under test.
 */
async function loginOnThisPage(page, sink, email) {
  await page.waitForSelector('[aria-label="Email"]', { timeout: 20000 });
  await page.fill('[aria-label="Email"]', email);
  await page.click('[aria-label="Log in with email"]');
  await page.waitForSelector('[aria-label="Login code"]', { timeout: 15000 });
  const code = sink.lastCode(email);
  if (!code) throw new Error(`no login code reached the development outbox for ${email}`);
  await page.fill('[aria-label="Login code"]', code);
  await page.click('[aria-label="Verify code"]');
}

const sink = await startMailSink();
const browser = await chromium.launch();
const ownerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const forkerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const owner = await ownerCtx.newPage();
const forker = await forkerCtx.newPage();

await loginViaEmail(owner, BASE, sink, OWNER_EMAIL);
check(Boolean((await ownerCtx.cookies(BASE)).find((c) => /better-auth/.test(c.name))), 'owner logged in');

// ── 1. a public document, published by the owner's own claimed token ──────
const anon = await mintAnon(BASE);
const claimed = await owner.evaluate(
  async (t) => (await fetch('/api/tokens/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) })).status,
  anon.token,
);
check(claimed === 200, 'owner claimed the token');
const api = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};
const doc = await api('/api/artifacts', {
  method: 'POST',
  body: JSON.stringify({
    title: 'Fork gate',
    visibility: 'public',
    markup: '<div class="p-8"><h1>Fork gate</h1><p>The original, published by its owner.</p></div>',
  }),
});
check(doc.visibility === 'public', 'a PUBLIC document — the case a stranger can reach at all');

// ── 2. the parameter is not a lever on a shared link ──────────────────────
const strangerHtml = await (await fetch(`${BASE}/a/${doc.id}?intent=fork`)).text();
check(strangerHtml.includes('data-mx-fork'), 'an anonymous ?intent=fork is still the DOCUMENT (it carries the fork anchor)');
check(!strangerHtml.includes('id="root"'), '…and never the app shell');

// ── 3. the logged-out reader taps Fork in the document's own controls ─────
await forker.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
await forker.waitForSelector('[aria-label="Open artifact controls"]', { timeout: 20000 });
check((await forker.locator('iframe[title="artifact"]').count()) === 0, 'a logged-out reader is served the document TOP-LEVEL, not the shell');
await forker.locator('[aria-label="Open artifact controls"]').click();
const forkAnchor = forker.locator('[aria-label="Fork artifact"]');
await forkAnchor.waitFor({ state: 'visible', timeout: 10000 });
check(true, 'the reader controls offer Fork');

// ── 4. the ask survives the top navigation into /login ────────────────────
await forkAnchor.click();
await forker.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 20000 });
check(
  decodeURIComponent(new URL(forker.url()).searchParams.get('callbackUrl') ?? '').includes('intent=fork'),
  'the login door carries the ask back with it',
);
await loginOnThisPage(forker, sink, FORKER_EMAIL);

// ── 5. returned to the document, with the confirm open ────────────────────
const dialog = forker.locator('[role="dialog"][aria-label="Fork this artifact"]');
await dialog.waitFor({ state: 'visible', timeout: 30000 });
check(true, 'login returned them to the document with the fork confirm open');
check(
  !new URL(forker.url()).search.includes('intent='),
  'the instruction is consumed: the address no longer carries it, so a refresh does not re-prompt',
);

await Promise.all([
  forker.waitForURL((u) => !u.pathname.includes(doc.id), { timeout: 30000 }),
  forker.locator('[aria-label="Confirm fork"]').click(),
]);
const copyPath = new URL(forker.url()).pathname;
check(copyPath.startsWith('/@'), `the copy is at its new owner's address (${copyPath})`);

// ── 6. the copy is theirs, and says where it came from ────────────────────
const copyId = /([A-Za-z0-9]{6,12})(?:-|$)/.exec(copyPath.split('/').pop() ?? '')?.[1] ?? '';
const copyRow = await forker.evaluate(
  async (id) => (await fetch(`/api/my/artifacts/${id}`, { credentials: 'same-origin' })).json(),
  copyId,
);
check(copyRow.forked_from === doc.id, `the copy records its source (forked_from = ${copyRow.forked_from})`);
check(copyRow.id !== doc.id, 'a new id — the original is untouched');

const credit = forker.frameLocator('iframe[title="artifact"]').locator('[data-mx-forked-from]');
await credit.waitFor({ state: 'attached', timeout: 30000 });
const creditText = await credit.innerText();
check(creditText.toLowerCase().includes('forked from'), `the copy's credits name its source ("${creditText.trim()}")`);
check(creditText.includes(doc.id), 'and the source is named by its address, not vaguely');

// ── 6b. the naming follows the SOURCE's tier, re-asked on every render ────
// The owner narrows the source AFTER the fork. `unlisted` exists to be listed
// nowhere, so a copy that somebody else made public must stop republishing its
// address — measured as a STRANGER, which is who reads a shared copy, and this
// is the exact shape a review measured in a browser before the rule existed.
const narrowed = await owner.evaluate(
  async (id) => (await fetch(`/api/my/artifacts/${id}/sharing`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ visibility: 'unlisted' }),
  })).status,
  doc.id,
);
check(narrowed === 200, 'the owner narrowed the source to unlisted');
const strangerCopy = await (await fetch(`${BASE}/a/${copyId}/raw`)).text();
check(!strangerCopy.includes(doc.id), "a stranger reading the copy no longer sees the unlisted source's address");
check(strangerCopy.includes('forked from a document that is not public'), '…and gets the same neutral sentence a private or deleted source gets');

// ── 7. `intent=comment` opens the conversation for an invited commenter ───
const invited = await owner.evaluate(
  async ([id, email]) => (await fetch(`/api/my/artifacts/${id}/sharing`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ shares: [{ email, role: 'commenter' }] }),
  })).status,
  [doc.id, FORKER_EMAIL],
);
check(invited === 200, 'the owner invited them as a commenter');

await forker.goto(`${BASE}/a/${doc.id}?intent=comment`, { waitUntil: 'load' });
await forker.locator('[aria-label="Annotation sidebar"]').waitFor({ state: 'visible', timeout: 30000 });
check(true, '?intent=comment opens the comment rail for a commenter');
check(!new URL(forker.url()).search.includes('intent='), '…and that instruction is consumed too');

await browser.close();
await sink.close();
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1); }
console.log('\nall good');

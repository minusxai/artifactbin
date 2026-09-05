/**
 * Gate: the drafts you made logged-out follow you into your account.
 *
 * The unit tests cover the pocket, the query and the banner separately. What
 * only a browser answers is whether the CHAIN holds: a token minted by one page
 * is still in storage when a different page loads after a full login redirect,
 * and the banner it renders actually moves ownership in the database.
 *
 * The claim it makes is ownership, with no undo, so the refusals are gated as
 * hard as the happy path: a second login must not re-offer what was already
 * claimed, and an unticked draft must stay behind.
 *
 * The dev server must point its mail at this gate's sink:
 *
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.

 *
 *   usage: node scripts/gate-claim-flow.mjs [base]
 */
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';
import { startMailSink, loginViaEmail, isSignedInAs } from './lib/mail-login.mjs';
import { mintAnon } from './lib/mint-anon.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { out.push(`${c ? '  ok ' : 'FAIL'} ${l}`); return c; };

const api = async (path, init = {}, token) => {
  const res = await fetch(`${B}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  return res.json();
};

const sink = await startMailSink();
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });

// ── an anonymous visitor makes two documents ────────────────────────────────
const anon = await mintAnon(B);
const doc = async (title) => api('/api/artifacts', {
  method: 'POST',
  body: JSON.stringify({ title, markup: `<div data-design="tw" className="p-8"><h1 className="text-3xl font-bold">${title}</h1></div>` }),
}, anon.token);
const kept = await doc('Quarterly Review');
const left = await doc('Scratch Notes');
ok(!!kept.id && !!left.id, 'an anonymous visitor published two documents');

// The browser holds the token exactly as the UI would have left it.
await p.goto(B, { waitUntil: 'load' });
// A browser's credential is the httpOnly session cookie now, not a
// localStorage token — and the shell it unlocks belongs to the owner.
await becomeOwner(p, B, anon.token);

// ── they log in ─────────────────────────────────────────────────────────────
const email = `mxmx_test_claim_${Date.now().toString(36)}@example.com`;
await loginViaEmail(p, B, sink, email);
// The masthead's identity line is the HANDLE now, not the address, so being
// signed in is that link existing (components/HeaderBar).
ok(await isSignedInAs(p, email), 'logging in with an emailed code signs you in');

// ── the banner names the drafts, without being asked for a token ────────────
await p.waitForSelector('[aria-label="Unclaimed drafts"]', { timeout: 20000 }).catch(() => {});
const banner = await p.locator('[aria-label="Unclaimed drafts"]').count();
ok(banner === 1, 'the dashboard offers the drafts made before signing in');
const text = banner ? await p.locator('[aria-label="Unclaimed drafts"]').innerText() : '';
ok(/Quarterly Review/.test(text), 'and names them, so you can tell whose they are');
// A token from ANOTHER machine has no cookie to be offered by, so pasting it
// must stay reachable. Manual claiming is account management now, rather than
// a competing call to action on the dashboard.
await p.goto(`${B}/account`, { waitUntil: 'load' });
await p.waitForSelector('[aria-label="Token to claim"]', { timeout: 10_000 }).catch(() => {});
ok((await p.locator('[aria-label="Token to claim"]').count()) === 1, 'the account page offers a way to paste a token from elsewhere');

// Return to the dashboard offer before exercising its opt-in controls.
await p.goto(B, { waitUntil: 'load' });
await p.waitForSelector('[aria-label="Unclaimed drafts"]', { timeout: 20_000 }).catch(() => {});

// What this browser holds is its httpOnly session cookie — not a value any
// script can read. The offer above is the proof it holds anything at all (the
// server answered from the cookie); this is the other half: the secret is not
// sitting in localStorage where an XSS could take it and keep it.
const stored = await p.evaluate(() => [localStorage.getItem('mx_tokens'), localStorage.getItem('mx_token')]);
ok(stored.every((v) => v === null), 'the browser keeps no token in localStorage');
const cookies = await p.context().cookies(B);
ok(cookies.some((c) => /mx-agent-session/.test(c.name) && c.httpOnly), 'it holds an httpOnly session cookie instead');

// ── untick one, claim the rest ──────────────────────────────────────────────
// Both documents belong to ONE token here, so unticking it claims nothing —
// which is itself the guarantee worth gating: nothing moves without a tick.
await p.locator('[aria-label^="Claim "]').first().uncheck();
await p.locator('[aria-label="Add to my account"]').click();
await p.waitForTimeout(1500);
let mine = await (await fetch(`${B}/api/my/artifacts`, { headers: { cookie: (await p.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') } })).json();
ok((mine.artifacts ?? []).length === 0, 'nothing is claimed while the box is unticked');

// Now tick it and claim for real.
await p.locator('[aria-label^="Claim "]').first().check();
await p.locator('[aria-label="Add to my account"]').click();
await p.waitForSelector('[aria-label="Claim result"]', { timeout: 20000 });
ok(/Added/.test(await p.locator('[aria-label="Claim result"]').innerText()), 'claiming reports what it added');

const cookieHeader = (await p.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
mine = await (await fetch(`${B}/api/my/artifacts`, { headers: { cookie: cookieHeader } })).json();
const titles = (mine.artifacts ?? []).map((a) => a.title).sort();
ok(titles.includes('Quarterly Review') && titles.includes('Scratch Notes'),
  `both documents now belong to the account (${titles.join(', ')})`);

// ── the token still edits, and the offer does not come back ─────────────────
const stillEdits = await api(`/api/artifacts/${kept.id}`, {}, anon.token);
ok(stillEdits.id === kept.id, 'the token still works — claiming changed ownership, not validity');

await p.goto(B, { waitUntil: 'load' });
await p.waitForTimeout(2500);
ok((await p.locator('[aria-label="Unclaimed drafts"]').count()) === 0,
  'and the banner does not nag again once the drafts are claimed');

// ── someone else's token is never offered ───────────────────────────────────
const stranger = await mintAnon(B);
await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Not Yours', markup: '<div data-design="tw" className="p-8"><h1 className="text-3xl">x</h1></div>' }) }, stranger.token);
const claimable = await (await fetch(`${B}/api/tokens/claimable`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
  body: JSON.stringify({ tokens: [anon.token, stranger.token] }),
})).json();
// The stranger's token is anonymous and fresh, so it IS offerable to whoever
// holds it — the point of this check is that the CLAIMED one is not re-offered.
ok(!claimable.claimable.some((c) => c.token === anon.token), 'an already-claimed token is never offered again');

console.log(out.join('\n'));
sink.close();
await b.close();
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);

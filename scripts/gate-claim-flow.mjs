/** Browser gate: verified login adopts all held guest artifacts and keeps
 * connected CLI credentials usable, without adopting unrelated guests. */
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { chromium } from 'playwright';
import { becomeOwner } from './lib/start-doc.mjs';
import { startMailSink, loginViaEmail, isSignedInAs } from './lib/mail-login.mjs';
import { connectAgent } from './lib/cli-connection.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('claim-flow');

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
const anon = await connectAgent(B);
const doc = async (title) => api('/api/artifacts', {
  method: 'POST',
  body: JSON.stringify({ title, markup: `<div data-design="tw" className="p-8"><h1 className="text-3xl font-bold">${title}</h1></div>` }),
}, anon.token);
const kept = await doc('Quarterly Review');
const left = await doc('Scratch Notes');
check(!!kept.id && !!left.id, 'an anonymous visitor published two documents');

// The browser holds the token exactly as the UI would have left it.
await p.goto(B, { waitUntil: 'load' });
// A browser's credential is the httpOnly session cookie now, not a
// localStorage token — and the shell it unlocks belongs to the owner.
await becomeOwner(p, B, anon.token);

// ── they log in ─────────────────────────────────────────────────────────────
const email = `mxmx_test_claim_${Date.now().toString(36)}@example.com`;
await loginViaEmail(p, B, sink, email);
// The page chrome names the account by HANDLE, not by address, so being signed
// in is asked of the session endpoint rather than read off the page.
check(await isSignedInAs(p, email), 'logging in with an emailed code signs you in');

// Guest ownership transfers during verified login, without a second claim UI.
check(await p.locator('[aria-label="Unclaimed drafts"]').count() === 0,
  'guest drafts are adopted automatically on verified login');
// And there is NOWHERE to paste a credential: the account page lists CLI
// connections to revoke, and nothing anywhere asks a person for a token.
await p.goto(`${B}/account`, { waitUntil: 'load' });
await p.waitForTimeout(1000);
check((await p.locator('[aria-label="Token to claim"]').count()) === 0, 'the account page asks for no pasted token');
check(!/mx_\.\.\./.test(await p.locator('body').innerText()), 'and offers no token field at all');

// Credentials remain in HttpOnly cookies, never browser-readable storage.
const stored = await p.evaluate(() => [localStorage.getItem('mx_tokens'), localStorage.getItem('mx_token')]);
check(stored.every((v) => v === null), 'the browser keeps no token in localStorage');
const cookies = await p.context().cookies(B);
check(cookies.some((c) => /mx-agent-session/.test(c.name) && c.httpOnly), 'it holds an httpOnly session cookie instead');

const cookieHeader = (await p.context().cookies(B)).map((c) => `${c.name}=${c.value}`).join('; ');
const mine = await (await fetch(`${B}/api/my/artifacts`, { headers: { cookie: cookieHeader } })).json();
const titles = (mine.artifacts ?? []).map((a) => a.title).sort();
check(titles.includes('Quarterly Review') && titles.includes('Scratch Notes'),
  `both documents now belong to the account (${titles.join(', ')})`);

// ── the token still edits, and the offer does not come back ─────────────────
const stillEdits = await api(`/api/artifacts/${kept.id}`, { method: 'PUT', body: JSON.stringify({ markup: '<h1>Updated after login</h1>' }) }, anon.token);
check(stillEdits.id === kept.id, 'the connected CLI still edits after guest ownership transfers');

await p.goto(B, { waitUntil: 'load' });
await p.waitForTimeout(2500);
check((await p.locator('[aria-label="Unclaimed drafts"]').count()) === 0,
  'and the banner does not nag again once the drafts are claimed');

// An unrelated guest is neither adopted nor claimable by an account.
const stranger = await connectAgent(B);
const unrelated = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ title: 'Not Yours', markup: '<h1>Not Yours</h1>', visibility: 'private' }) }, stranger.token);
const cannotRead = await fetch(`${B}/api/my/artifacts/${unrelated.id}`, { headers: { cookie: cookieHeader } });
check(cannotRead.status === 404, 'login did not adopt an unrelated guest identity');
const cannotClaim = await fetch(`${B}/api/tokens/claim`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
  body: JSON.stringify({ token: stranger.token }),
});
check(cannotClaim.status === 404, 'the legacy claim endpoint cannot take another guest user token');

sink.close();
await b.close();
check.done();

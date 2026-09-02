/**
 * Gate: GENERAL ACCESS — the link carries a ROLE, and the delivery follows it.
 *
 * The vitest suite proves `effectiveRole` and the SQL scopes in-process. What
 * only a browser can prove is the seam they feed: that flipping ONE control in
 * the share menu changes which of the three shapes a stranger is served, and
 * that a person nobody invited can then actually say something.
 *
 * The before/after is the whole point — the SAME person, the SAME link, one
 * setting apart:
 *
 *   1. link = `can view`     → a signed-in stranger gets the SERVED DOCUMENT:
 *                              no shell, no iframe, no comment control
 *   2. owner flips it to `can comment`
 *   3. same link, reloaded   → the SHELL, with the comments control and NO
 *                              edit affordance (commenter is not editor)
 *   4. they select words in the frame and leave a comment
 *   5. the owner, who never reloaded, watches the count arrive over the stream
 *   6. logged OUT on that same link → the bare document again: ANONYMOUS CAPS
 *      AT VIEWER, because every write here is attributed and a URL is not an
 *      identity. This is also what keeps the crawler's fast path intact.
 *   7. flipped back to `can view` → the stranger loses all of it on reload
 *
 * Two logged-in contexts and one logged-out, one mail sink. usage:
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.

 *   node scripts/gate-link-access.mjs [base]
 */
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(read, want, budgetMs = 10000) {
  const deadline = Date.now() + budgetMs;
  let last;
  while (Date.now() < deadline) {
    last = await read().catch(() => undefined);
    if (want(last)) return last;
    await sleep(200);
  }
  return last;
}

const stamp = Date.now().toString(36);
const OWNER_EMAIL = `mxmx_test_link_owner_${stamp}@example.com`;
const STRANGER_EMAIL = `mxmx_test_link_stranger_${stamp}@example.com`;

const DOC = '<div data-design="tw" className="p-10">'
  + '<h1 className="text-3xl">General access</h1>'
  + '<p id="claim">Anyone with this link may comment on it.</p>'
  + '</div>';

/** Is this page the SHELL (the app framing the document) or the document itself? */
const isShell = (page) => page.locator('iframe[title="artifact"]').count().then((n) => n === 1);

/*
 * Everything about a document lives behind ONE control (PageControls, in
 * components/PageChrome), and that popover renders its children only while it
 * is OPEN. Two consequences for a gate, and the second is the dangerous one:
 * reaching for `[aria-label="Share"]` on a closed popover simply finds nothing,
 * while a `count() === 0` on a closed popover PASSES — for the wrong reason.
 * Every check below that reads what is inside opens it first.
 *
 * It is closed again before anything touches the frame: the open popover lays a
 * click-outside overlay across the whole viewport, which would swallow a click
 * meant for the document.
 */
const CONTROLS = '[role="dialog"][aria-label="Artifact controls"]';
const controlsOpen = (page) => page.locator(CONTROLS).isVisible().catch(() => false);
const openControls = async (page) => {
  if (await controlsOpen(page)) return;
  await page.locator('[aria-label="Open artifact controls"]').click({ timeout: 15000 });
  await page.locator(CONTROLS).waitFor({ timeout: 15000 });
};
const closeControls = async (page) => {
  if (!(await controlsOpen(page))) return;
  await page.locator('[aria-label="Dismiss artifact controls"]').click();
  await page.locator(CONTROLS).waitFor({ state: 'hidden', timeout: 15000 });
};

const sink = await startMailSink();
const browser = await chromium.launch();
try {
  const ownerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const strangerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const owner = await ownerCtx.newPage();
  const stranger = await strangerCtx.newPage();
  /*
   * WHICH BUNDLE the commenter's frame actually fetched. Behaviour alone
   * cannot tell the cheap delivery from the expensive one — commenting works
   * either way — so a silent regression to the full runtime would leave this
   * gate green. Watched from here on, and read after the reload below.
   */
  const fetched = [];
  strangerCtx.on('request', (r) => { if (r.url().includes('/story/')) fetched.push(r.url()); });

  await loginViaEmail(owner, BASE, sink, OWNER_EMAIL);
  await loginViaEmail(stranger, BASE, sink, STRANGER_EMAIL);
  check(Boolean((await strangerCtx.cookies(BASE)).find((c) => /better-auth/.test(c.name))), 'a second person is signed in — and was never invited to anything');

  // The owner's token, minted anonymously and claimed by their session.
  const anon = await (await fetch(`${BASE}/api/tokens/anonymous`, { method: 'POST' })).json();
  await owner.evaluate(async (t) => fetch('/api/tokens/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }),
  }), anon.token);

  const created = await fetch(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}` },
    body: JSON.stringify({ title: 'General access gate', visibility: 'public', markup: DOC }),
  });
  const doc = await created.json();
  check(created.ok, `published a public document (${doc.id})`);

  // ── 1. link = can view: the stranger is served the DOCUMENT ──────────────
  await stranger.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  check(!(await isShell(stranger)), 'link=can view: a signed-in stranger gets the served document, not the shell');
  check((await stranger.locator('[aria-label="Toggle comments"]').count()) === 0, '…and no comment control');

  // ── 2. the owner flips ONE control ───────────────────────────────────────
  const sharingPut = (page) => page.waitForResponse(
    (r) => r.url().includes('/sharing') && r.request().method() === 'PUT' && r.status() === 200,
    { timeout: 15000 },
  );
  await owner.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  const linkRole = owner.locator('[aria-label="Link role"]');
  /*
   * IDEMPOTENT: the share button is a TOGGLE, so a blind second click closes
   * the popover it was meant to open. Escape does not help — inside the
   * popover that belongs to the dropdown, not to the panel.
   */
  const openShare = async (page) => {
    if (await linkRole.isVisible().catch(() => false)) return;
    await openControls(page);
    await page.locator('[aria-label="Share"]').first().click();
    await linkRole.waitFor({ timeout: 15000 });
  };
  await openShare(owner);
  check((await linkRole.textContent() ?? '').includes('can view'), 'general access starts at can view');
  await Promise.all([
    sharingPut(owner),
    (async () => {
      await linkRole.click();
      await owner.locator('[role="option"]', { hasText: 'can comment' }).click();
    })(),
  ]);
  check(
    (await until(() => linkRole.textContent(), (t) => (t ?? '').includes('can comment'))) !== undefined
      && ((await linkRole.textContent()) ?? '').includes('can comment'),
    'the owner set the link to can comment',
  );
  // ── 3. the SAME link, reloaded: now the shell ────────────────────────────
  await stranger.reload({ waitUntil: 'load' });
  check(await isShell(stranger), 'link=can comment: the same stranger is now served the SHELL');
  // Inside the open popover, so the two absences below are real absences.
  await openControls(stranger);
  check((await stranger.locator('[aria-label="Toggle comments"]').count()) === 1, '…with the comments control');
  check((await stranger.locator('[aria-label="Edit artifact"]').count()) === 0, '…and NO edit button — a commenter is not an editor');
  check((await stranger.locator('[aria-label="Share"]').count()) === 0, '…and no share control: the ACL stays the owner\'s');
  await closeControls(stranger);

  // ── 3b. …carrying the COMMENT layer, not the hydration runtime ───────────
  const got = (kind) => fetched.some((u) => u.includes(`/story/${kind}-`));
  check(await until(async () => got('comment'), (v) => v === true, 10000) === true,
    'the frame fetched the comment layer (~13 KB)');
  check(!got('entry'),
    '…and NEVER the hydration runtime (~384 KB): a commenter needs the frame, not the editor');

  // ── 4. they comment, from selection to saved thread ──────────────────────
  const frame = stranger.frameLocator('iframe[title="artifact"]');
  await frame.locator('#claim').waitFor({ timeout: 15000 });
  const bubble = frame.locator('[data-mx-selection-actions]');
  await until(async () => {
    await frame.locator('#claim').click({ clickCount: 3, timeout: 2000 }).catch(() => {});
    return bubble.isVisible().catch(() => false);
  }, (v) => v === true, 20000);
  check(await bubble.isVisible(), 'selecting words offers the stranger the action bubble');
  check((await frame.locator('[aria-label="Edit selected text"]').count()) === 0,
    'the bubble offers annotate and NOT edit — the capability follows the role');

  await frame.locator('[aria-label="Annotate selected text"]').click();
  const composer = await until(() => stranger.locator('[aria-label="Annotation comment"]').count(), (n) => n === 1, 10000);
  check(composer === 1, 'the composer opens on those words');
  await stranger.locator('[aria-label="Annotation comment"]').fill('a stranger with the link, saying something');
  await stranger.locator('[aria-label="Save annotation"]').click();
  const saved = await until(
    () => fetch(`${BASE}/api/artifacts/${doc.id}/annotations`, { headers: { Authorization: `Bearer ${anon.token}` } })
      .then((r) => r.json()).then((j) => j.annotations?.length ?? 0),
    (n) => n === 1, 15000,
  );
  check(saved === 1, 'the comment is stored — a person nobody invited left feedback');

  // ── 5. the owner never reloaded ──────────────────────────────────────────
  const live = await until(() => owner.locator('[aria-label="Open annotation count"]').textContent().catch(() => null), (t) => t === '1', 20000);
  check(live === '1', 'the owner watches the count arrive over the live stream — no reload');

  // ── 6. logged OUT on the same link: the anonymous ceiling ────────────────
  const anonCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const visitor = await anonCtx.newPage();
  await visitor.goto(`${BASE}/a/${doc.id}`, { waitUntil: 'load' });
  check(!(await isShell(visitor)), 'logged out on a link-commentable document: the bare document — anonymous caps at viewer');
  check((await visitor.locator('[aria-label="Toggle comments"]').count()) === 0, '…and no comment control, so the crawler path is untouched');

  // ── 7. flipped back, the stranger loses it ───────────────────────────────
  await openShare(owner);
  await Promise.all([
    sharingPut(owner),
    (async () => {
      await linkRole.click();
      await owner.locator('[role="option"]', { hasText: 'can view' }).click();
    })(),
  ]);
  await stranger.reload({ waitUntil: 'load' });
  check(!(await isShell(stranger)), 'demoted to can view: the stranger is served the plain document again');
  check((await stranger.locator('[aria-label="Toggle comments"]').count()) === 0, '…and the comment control is gone');
} finally {
  await browser.close();
  await sink.close();
}

console.log(failures.length ? `\nFAILED (${failures.length}): ${failures.join(' | ')}` : '\nall link-access checks passed');
process.exit(failures.length ? 1 : 0);

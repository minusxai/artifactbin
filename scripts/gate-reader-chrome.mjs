/**
 * Gate: THE READER'S CHROME on the served document.
 *
 * Authored prose is top-level; first-party chrome lives in one native closed
 * ShadowRoot. The gate-only browser helper exposes a getter for automation,
 * never changes root.mode, and preserves the real CSS/event boundary.
 *
 * What this pins, one leg each:
 *
 *  1. Chrome is visibly actionable on load without a reveal gesture.
 *  2. Down/up scrolling preserves the topbar and viewport-safe mobile actions.
 *  3. The end of the document keeps chrome visible too.
 *  4. Signed-out social actions enter login carrying the original intent.
 *  5. Share really shares: no platform sheet here, so the clipboard holds the
 *     document's own address and the toast says so, then goes.
 *  6. The byline links the AUTHOR, the logo is home, and home actually goes.
 *  7. A document that cannot scroll shows the chrome outright — no gesture
 *     could ever reveal it.
 *  8. The settings panel is still the settings panel: appearance, fork, and
 *     now the provenance line a fork's copy carries.
 *  9. The credits footer is gone, in both viewports.
 *
 *   node scripts/gate-reader-chrome.mjs [base]
 */
import { chromium } from './lib/gate-browser.mjs';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
import { mintAnon } from './lib/mint-anon.mjs';
import { revealReaderChrome } from './lib/reveal-chrome.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };
const stamp = Date.now().toString(36);
const EMAIL = `mxmx_test_readerchrome_${stamp}@example.com`;

const sink = await startMailSink();
const browser = await chromium.launch();

// ── the documents ─────────────────────────────────────────────────────────
// An OWNED public document, because the byline is the author's handle and an
// anonymous document deliberately has none.
const ownerCtx = await browser.newContext({ viewport: DESKTOP });
const owner = await ownerCtx.newPage();
await loginViaEmail(owner, BASE, sink, EMAIL);
const anon = await mintAnon(BASE);
const claimed = await owner.evaluate(
  async (t) => (await fetch('/api/tokens/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) })).status,
  anon.token,
);
check(claimed === 200, 'the owner claimed a token, so the document has an author');
const handle = await owner.evaluate(async () => (await (await fetch('/api/page/account')).json())?.username ?? null);
check(typeof handle === 'string' && handle.length > 0, `the owner has a handle (@${handle})`);

const api = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon.token}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

const LONG = '<div data-design="tw" className="p-10"><h1 className="text-4xl font-bold">A long read</h1>'
  + Array.from({ length: 60 }, (_, i) => `<p className="mt-4 text-lg">Five screens of it, at least. Paragraph ${i + 1}.</p>`).join('')
  + '</div>';
const long = await api('/api/artifacts', {
  method: 'POST',
  body: JSON.stringify({ title: 'Reader chrome gate', visibility: 'public', markup: LONG }),
});
const short = await api('/api/artifacts', {
  method: 'POST',
  body: JSON.stringify({ title: 'One paragraph', visibility: 'public', markup: '<div className="p-10"><p>One paragraph, and nothing to scroll.</p></div>' }),
});
// The copy is what carries provenance; the source is PUBLIC, so it is named.
const copy = await api(`/api/artifacts/${long.id}/fork`, { method: 'POST', body: JSON.stringify({ visibility: 'public' }) });
check(!!copy.id && copy.id !== long.id, `a forked copy exists (${copy.id})`);

/** A logged-out reader, with a clipboard and no platform share sheet. */
const readerContext = async (viewport) => {
  const ctx = await browser.newContext({
    viewport,
    permissions: ['clipboard-read', 'clipboard-write'],
    ...(viewport === PHONE ? { hasTouch: true, isMobile: true, deviceScaleFactor: 3 } : {}),
  });
  // Measure the CLIPBOARD path: with a sheet available, share never reaches it.
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  return ctx;
};

const chromeState = (page) => page.locator('[data-trusted-ui-root]').evaluate(root => {
  if (!root) return null;
  const box = (sel) => {
    const el = root.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
  };
  return {
    hidden: getComputedStyle(root.querySelector('[aria-label="Page bar"]')).visibility==='hidden',
    state: getComputedStyle(root.querySelector('[aria-label="Page bar"]')).position,
    artifact: location.pathname.split('/')[2],
    visibility: getComputedStyle(root).visibility,
    root: box('[aria-label="Page bar"]'),
    like: box('[aria-label="Like artifact"]'),
    rail: box('[data-controls-region]:has([aria-label="Like artifact"])'),
    byline: box('[aria-label="Artifact author"]'),
    width: window.innerWidth,
    height: window.innerHeight,
    credits: document.querySelectorAll('.mx-artifact-credits').length,
  };
});

const settle = (page) => page.waitForTimeout(350);

for (const [name, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  const ctx = await readerContext(viewport);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));
  await page.goto(`${BASE}/a/${long.id}`, { waitUntil: 'load' });
  await page.getByLabel('Page bar',{exact:true}).waitFor();
  await settle(page);

  // 1. nothing but the artifact
  let s = await chromeState(page);
  check(s?.hidden === false && ['fixed','sticky'].includes(s.state), `${name}: on load shared chrome is visible and pinned (${s?.state})`);
  check(s?.visibility === 'visible', `${name}: …really visible, not merely transparent (visibility ${s?.visibility})`);
  check(await page.locator('[aria-label="Like artifact"]').isVisible(), `${name}: the rail is actionable without a reveal gesture`);
  check(s?.artifact === long.id, `${name}: the chrome is stamped with the artifact id (${s?.artifact})`);

  // 2. down keeps it away, up brings it back
  await page.evaluate(() => window.scrollTo(0, 600));
  await settle(page);
  s = await chromeState(page);
  check(s?.hidden === false && s.root.top>=-1 && s.root.top<=1, `${name}: scroll DOWN keeps the topbar fixed and visible`);
  await page.evaluate(() => window.scrollBy(0, -80));
  await settle(page);
  s = await chromeState(page);
  check(s?.hidden === false && ['fixed','sticky'].includes(s.state), `${name}: scroll UP retains pinned visible chrome (${s?.state})`);
  check(await page.locator('[aria-label="Like artifact"]').isVisible(), `${name}: Like is visible`);
  check(
    !!s?.like && s.like.left >= -1 && s.like.right <= s.width + 1 && s.like.top >= -1 && s.like.bottom <= s.height + 1,
    `${name}: …and inside the viewport (${JSON.stringify(s?.like)} of ${s?.width}x${s?.height})`,
  );

  if (name === 'phone') {
    check(!!s?.rail && s.rail.right >= s.width - 20, `${name}: the rail hugs the right edge (right ${s?.rail?.right} of ${s?.width})`);
    check(!!s?.byline && s.byline.left <= 30 && s.byline.bottom <= s.height && s.byline.top>=44,
      `${name}: the byline sits bottom-left (${s?.byline?.left}, bottom ${s?.byline?.bottom} of ${s?.height})`);
    check(!!s?.byline && !!s.rail && (s.byline.right <= s.rail.left + 1 || s.byline.bottom<=s.rail.top), `${name}: and clear of the rail`);
    check(!!s?.like && s.like.width >= 44 && s.like.height >= 44, `${name}: a rail target is at least 44x44 (${s?.like?.width}x${s?.like?.height})`);
  } else {
    check(!!s?.root && s.root.top <= 1 && s.root.left <= 1 && s.root.right >= s.width - 1,
      `${name}: one bar across the top (${JSON.stringify(s?.root)} of ${s?.width}px)`);
    check(!!s?.rail && !!s.byline && s.rail.left > s.byline.left, `${name}: byline left, actions right`);
  }

  // 3. the end shows it
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle(page);
  s = await chromeState(page);
  check(s?.hidden === false, `${name}: the END of the document shows the chrome`);

  // 4. LIKE AND COMMENT ARE DOORS for a stranger: the document holds no
  // session, so a press walks through login carrying the ask, and the shell
  // performs it on the way back (lib/intent). Measured: the door, then back.
  const door = async (label, intent) => {
    await revealReaderChrome(page);
    await page.locator(`[aria-label="${label}"]`).click();
    await page.waitForURL(/\/login\?callbackUrl=/, { timeout: 10_000 }).catch(() => {});
    const at = page.url();
    check(at.includes('/login?callbackUrl=') && at.includes(`intent%3D${intent}`), `${name}: ${label} goes through login carrying intent=${intent} (${at})`);
    await page.goto(`${BASE}/a/${long.id}`, { waitUntil: 'load' });
    await page.getByLabel('Page bar',{exact:true}).waitFor();
  };
  await door('Like artifact', 'like');
  await door('Toggle comments', 'comment');

  // 5. share reaches the clipboard, and the toast says so — on the PHONE. A
  // desktop has an address bar; the product owner wants no share button there.
  await revealReaderChrome(page);
  if (viewport === PHONE) {
    await page.getByLabel('Open artifact controls',{exact:true}).click();
    await page.locator('[aria-label="Share"]').click();
    // The clipboard write is a promise; the toast is what resolves it. WAIT for
    // it — `isVisible()` samples, it does not wait, and this is a race by design.
    const toastUp = await page.getByLabel('Share',{exact:true}).filter({hasText:'copied link'}).waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    check(toastUp, `${name}: the toast says the link was copied`);
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    check(copied === page.url(), `${name}: the clipboard holds the document's own address (${copied})`);
    await page.waitForTimeout(2200);
    check(!(await page.getByLabel('Share',{exact:true}).innerText()).includes('copied link'), `${name}: copied feedback clears by itself`);
    await page.keyboard.press('Escape');
  } else {
    check(!(await page.locator('[aria-label="Share"]').isVisible()), `${name}: there is no share button on a desktop`);
    check(await page.locator('[aria-label="Like artifact"]').isVisible(), `${name}: …while the rest of the rail is still there`);
  }

  // 8. the settings panel: appearance + fork, and provenance on a copy
  await revealReaderChrome(page);
  await page.locator('[aria-label="Open artifact controls"]').click();
  await page.waitForSelector('[aria-label="Artifact controls"]', { timeout: 10_000 });
  check(await page.locator('[aria-label="Light mode"]').isVisible(), `${name}: the settings panel offers light`);
  check(await page.locator('[aria-label="Dark mode"]').isVisible(), `${name}: …and dark`);
  check(await page.locator('[aria-label="Fork artifact"]').isVisible(), `${name}: …and fork`);
  check((await page.locator('[data-mx-forked-from]').count()) === 0, `${name}: a document nobody forked says nothing about provenance`);
  await page.keyboard.press('Escape');

  // 9. the credits footer is retired
  s = await chromeState(page);
  check(s?.credits === 0, `${name}: no credits footer anywhere`);

  // 6. the byline links the author; the logo is home, and home goes there
  const links = await page.locator('[data-trusted-ui-root]').evaluate(root => ({
    author: root.querySelector('[aria-label="Artifact author"] a')?.getAttribute('href') ?? null,
    logo: root.querySelector('[aria-label="Home"]')?.getAttribute('href') ?? null,
    title: root.querySelector('[aria-label="Page bar"]')?.textContent ?? null,
  }));
  check(links.author === `/@${handle}`, `${name}: the byline links the author (${links.author})`);
  check(links.logo === '/', `${name}: the logo is home (${links.logo})`);
  check(links.title.includes('Reader chrome gate'), `${name}: and the title reads as stored (${links.title})`);

  // 6c. FOLLOW sits in the byline, and for a stranger it is a door like Like.
  await revealReaderChrome(page);
  check(await page.locator('[aria-label="Follow author"]').isVisible(), `${name}: the byline offers Follow`);
  await door('Follow author', 'follow');

  // 10. HOVER TIPS, on a desktop — a phone has no hover, its words sit under the glyphs
  if (viewport === DESKTOP) {
    // The doors above reloaded the document; its chrome arrives hidden again.
    await revealReaderChrome(page);
    const tip = async (sel) => {
      await page.hover(sel);
      await page.waitForTimeout(500);
      return page.getByRole('tooltip').textContent();
    };
    check(/like/i.test(await tip('[aria-label="Like artifact"]')), `${name}: hovering Like shows its tip`);
    check(/artifact controls/i.test(await tip('[aria-label="Open artifact controls"]')), `${name}: hovering settings shows its tip`);
    check(/menu/i.test(await tip('[aria-label="Open menu"]')), `${name}: hovering profile shows its tip`);
    await page.mouse.move(5, 400);
    await page.waitForTimeout(200);
    const gone = await page.getByRole('tooltip').count();
    check(gone === 0, `${name}: and the tip goes when the cursor leaves (${gone})`);
  }

  // 11. the PROFILE menu is a popover like the settings panel, never a drawer
  await revealReaderChrome(page);
  await page.locator('[aria-label="Open menu"]').click();
  await page.getByLabel('Menu',{exact:true}).waitFor();
  // The panel rises into place over 140ms; measure where it lands, not where it starts.
  await settle(page);
  const menu = await page.getByLabel('Menu',{exact:true}).evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: window.innerWidth, height: window.innerHeight };
  });
  if (viewport === DESKTOP) {
    check(menu.top >= 44 && menu.bottom < menu.height - 100 && menu.left > menu.width / 2,
      `${name}: the profile menu drops under the bar at the right (${JSON.stringify(menu)})`);
  } else {
    check(menu.bottom >= menu.height - 2 && menu.top > menu.height / 3,
      `${name}: the profile menu is a bottom sheet, not a drawer (${JSON.stringify(menu)})`);
  }
  check(await page.locator('[aria-label="Menu"] a[href="/account"]').isVisible(), `${name}: …holding Account`);
  await page.keyboard.press('Escape');

  // 8b. the COPY names where it came from, inside the same panel
  const copyPage = await ctx.newPage();
  await copyPage.goto(`${BASE}/a/${copy.id}`, { waitUntil: 'load' });
  await copyPage.getByLabel('Page bar',{exact:true}).waitFor();
  await revealReaderChrome(copyPage);
  await copyPage.locator('[aria-label="Open artifact controls"]').click();
  await copyPage.waitForSelector('[aria-label="Artifact controls"]', { timeout: 10_000 });
  const provenance = copyPage.locator('[data-mx-forked-from]');
  check(await provenance.isVisible(), `${name}: a forked copy states its provenance in the settings panel`);
  const line = (await provenance.innerText()).trim();
  check(line.toLowerCase().startsWith('forked from') && line.includes(long.id),
    `${name}: …naming the public source by its address ("${line}")`);
  await copyPage.close();

  // 7. a document that cannot scroll shows the chrome outright
  const shortPage = await ctx.newPage();
  await shortPage.goto(`${BASE}/a/${short.id}`, { waitUntil: 'load' });
  await shortPage.getByLabel('Page bar',{exact:true}).waitFor();
  await settle(shortPage);
  const shortState = await chromeState(shortPage);
  check(shortState?.hidden === false, `${name}: a document that cannot scroll shows the chrome on load (${shortState?.state})`);
  check(await shortPage.locator('[aria-label="Like artifact"]').isVisible(), `${name}: …and its rail is pressable straight away`);
  await shortPage.close();

  /*
   * 6b. THE LOGO ACTUALLY GOES HOME (last on this page — it leaves the
   * document). The reader's journey is staged as the real one: they arrived
   * from the app, so the logo returns them there — which is also where its
   * href points, and both branches land on `/`. A Playwright page cannot stage
   * the other case: `newPage()` already has about:blank in its history, so
   * "nothing to go back to" is not a state this harness can produce, and the
   * jsdom test beside this one is where that branch is pinned.
   */
  const trip = await ctx.newPage();
  await trip.goto(`${BASE}/`, { waitUntil: 'load' });
  await trip.goto(`${BASE}/a/${long.id}`, { waitUntil: 'load' });
  await trip.getByLabel('Page bar',{exact:true}).waitFor();
  await trip.getByLabel('Page bar',{exact:true}).evaluate(el=>{window.__gateTrustedHost=el.getRootNode().host;});
  await revealReaderChrome(trip);
  await Promise.all([
    trip.waitForURL((u) => u.pathname === '/', { timeout: 20_000 }),
    trip.getByLabel('Home',{exact:true}).click(),
  ]).then(() => check(true, `${name}: pressing the logo takes the reader home`))
    .catch(() => check(false, `${name}: pressing the logo takes the reader home (stayed at ${trip.url()})`));
  check(await trip.getByLabel('Page bar',{exact:true}).evaluate(el=>el.getRootNode().host===window.__gateTrustedHost),`${name}: shared chrome host survives route navigation`);
  await trip.close();

  await ctx.close();
}

await ownerCtx.close();
await browser.close();
await sink.close?.();

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall reader-chrome checks passed');
process.exit(failures.length ? 1 : 0);

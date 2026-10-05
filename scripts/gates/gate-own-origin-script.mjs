/**
 * Gate: A SCRIPT DOCUMENT ON ITS OWN ORIGIN — framed, queried, edited, commented, consented to and exported, as one
 * journey on one server that serves every document on its own origin (APP__PAGES_HOST=lvh.me).
 *
 *   1. ORIGIN: a signed-in owner opens a PRIVATE document; the app page (strict policy, framing only the pages
 *      origins) frames it on `<hex(id)>.lvh.me` through the pages cookie (HttpOnly, Lax, `.lvh.me`); the document
 *      carries its own policy (framed by the app alone, no sandbox); its script moves a Value and the query re-runs
 *      through a DIRECT call to its own door, answered with an ACAO naming exactly its origin; the same frame asking
 *      a second document's door or an app route is stopped by its policy before anything leaves.
 *   2. SCRIPT: a second private document's Helmet module binds a Value and a Query, writes an effect and mounts a
 *      component that re-renders with the re-run query; the call is direct, with the pages cookie.
 *   3. TRUST: that module also forges every message it can reach (bridge envelopes with guessed keys and nonces,
 *      bare flow edits, `mx:text-edit` to the top) on a loop; entering edit mode writes nothing and spends no
 *      version, and its listeners never hear a bridge envelope.
 *   4. EDIT: the owner types in the frame, bolds a word from the PAGE's toolbar, undoes it with Mod-Z pressed in the
 *      frame; the mount's "Edit script" badge opens the source editor on the component's export line; Done saves
 *      with every node id unchanged and the component mounts again.
 *   5. COMMENT: a paragraph selected in the frame gets a comment whose pin lands on it.
 *   6. CONSENT: another reader of an unlisted copy is asked on the consent bar above the frame; `proxy()` to the
 *      declared host is 403 before consent and accepted after Allow once.
 *   7. EXPORT: `afbin export <id> --format png` photographs the mounted component (its magenta block).
 *
 * Absorbs gate-pages-origin, gate-frame-editor, gate-native-scripts and gate-inplace-edit's hostile-script section
 * (its 207–218; the rest of gate-inplace-edit is unchanged). What left, and where it lives now:
 *   - the server's own refusal of a forged second-door / app-route call (pages-origin 128/130) →
 *     services/app/__tests__/pages-origin-host.test.ts ("the origin gate"); the browser-enforced block stays here;
 *   - native-scripts' second edit leg (typing, Done, ids, version: native 155–163, 171–177) and its second comment
 *     leg (181–203), which repeated frame-editor's legs on a script document — they now run ONCE, on the script
 *     document, so the badge and the remount are asserted inside the one edit leg.
 *
 * A base that serves pages (the gate runner's servers, a `npm run setup -- --pages-host` dev server) is driven as it
 * is; otherwise this gate boots its own production server with the setting on (./lib/pages-server).
 *
 *   node scripts/gates/gate-own-origin-script.mjs [base]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/browser.mjs';
import { createChecker } from './lib/assert.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';
import { connectAgent, connectionBrowserCookie } from './lib/cli-connection.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { DOCUMENT_FRAME, documentFrame, documentLocator } from './lib/page-facts.mjs';
import { PAGES_HOST, pagesServer } from './lib/pages-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const check = createChecker('own-origin-script');
const pages = await pagesServer(process.argv[2], 'own-origin-script');
const APP = pages.app;
const pagesOrigin = pages.origin;
check.note(`driving ${APP} (pages at *.${PAGES_HOST}:${pages.port}${pages.booted ? ', booted by this gate' : ''})`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (probe, ok, timeout) => {
  const end = Date.now() + timeout;
  let value = await probe().catch(() => undefined);
  while (!ok(value) && Date.now() < end) { await sleep(150); value = await probe().catch(() => undefined); }
  return value;
};
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
/** One leg's failure is reported and the journey goes on, so a run names every broken leg at once. */
const section = async (name, run) => {
  console.log(`█ ${name}`);
  try { await run(); } catch (error) { check(false, `${name}: the leg threw (${String(error?.message ?? error).split('\n')[0].slice(0, 300)})`); }
};

/*
 * The script document. No backticks or `${` inside: the script is a template literal in the markup. It binds a Value
 * and a Query and mounts a component (native scripts), and it is HOSTILE: it listens for every message the frame
 * gets and forges, on a loop, what a bridge reply and an edit look like (frame-editor), plus the `mx:text-edit`
 * messages a script in the editor's realm could send the top window (inplace-edit).
 */
const SCRIPT = `
  import { signal, query, proxy } from 'page';
  import { createEffect } from 'solid-js';
  const [region, setRegion] = signal('$region');
  const total = query('$total');
  createEffect(() => { document.querySelector('#effect').textContent = 'Region is ' + region(); });
  window.__mxSetRegion = setRegion;
  window.__mxProxy = (url) => fetch(proxy(url)).then((r) => r.status, () => 'failed');
  window.__mxRows = () => total().length;
  window.__mxHeardEnvelopes = 0;
  window.addEventListener('message', function (e) { if (e.data && e.data.type === 'mx:frame-bridge') window.__mxHeardEnvelopes++; }, true);
  window.addEventListener('message', function (e) { if (e.data && e.data.type === 'mx:frame-bridge') window.__mxHeardEnvelopes++; });
  function forge() {
    var edit = { type: 'mx:flow-edit', nonce: 'guessed', path: '0.1', expected: 'The lede paragraph.', replacement: 'FORGED BY THE SCRIPT' };
    try { window.parent.postMessage({ type: 'mx:frame-bridge', payload: { kind: 'ready', nonce: 'guessed' } }, '*'); } catch (e) {}
    try { window.parent.postMessage({ type: 'mx:frame-bridge', key: 'guessed-guessed-guessed', payload: { kind: 'event', event: edit } }, '*'); } catch (e) {}
    try { window.parent.postMessage({ type: 'mx:frame-bridge', key: 'guessed-guessed-guessed', payload: { kind: 'fetch', call: 1, path: '/api/my/artifacts', method: 'GET', headers: {}, body: null } }, '*'); } catch (e) {}
    try { window.parent.postMessage(edit, '*'); } catch (e) {}
    try { window.top.postMessage({ type: 'mx:text-edit', path: '0.1', innerHtml: 'FORGED BY THE SCRIPT' }, '*'); } catch (e) {}
    try { window.top.postMessage({ type: 'mx:text-edit', nonce: 'guessed', path: '0.1', innerHtml: 'FORGED WITH A GUESS' }, '*'); } catch (e) {}
  }
  forge();
  setInterval(forge, 1500);
  setTimeout(function () {
    try { window.top.postMessage({ type: 'mx:text-edit', path: '0.1', innerHtml: 'FORGED LATE' }, '*'); } catch (e) {}
  }, 2500);
  export function Total(props) {
    const row = () => props.rows[0];
    return <div id="total-out" style={{ background: '#ff00ff', color: '#ffffff', padding: '32px', 'font-size': '22px' }}>Total {row() ? row().amount : '...'} for {row() ? row().region : '...'}</div>;
  }
`;
const SCRIPT_DOC = '<Helmet>'
  + '<meta name="csp-connect" content="https://esm.sh" />'
  + '<Value name="region" type="string" default="east" />'
  + '<Value name="sales" type="table" value={[{region: "east", amount: 5}, {region: "west", amount: 7}, {region: "west", amount: 30}]} />'
  + '<Query name="total">{`select region, sum(amount) as amount from sales where region = $region group by region`}</Query>'
  + `<script>{\`${SCRIPT}\`}</script>`
  + '</Helmet>'
  + '<div data-design="tw" className="p-10">'
  + '<h1 id="intro" className="text-3xl">Native scripts</h1>'
  + '<p id="lede">The lede paragraph.</p>'
  + '<p id="second">A second paragraph that stays put.</p>'
  + '<p id="effect">Loading…</p>'
  + '<Total rows={$total}><p>Loading total…</p></Total>'
  + '<p id="third">A paragraph to comment on.</p>'
  + '<p id="after">A paragraph after.</p></div>';

const stamp = Date.now().toString(36);
const sink = await startMailSink();
const browser = await launchChromium({ args: pages.browserArgs });
const scratch = mkdtempSync(path.join(os.tmpdir(), 'gate-own-origin-script-'));

/** A browser context holding a connection's cookie on the app origin (another reader). */
async function contextFor(token) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const cookie = connectionBrowserCookie(APP, token);
  await ctx.addCookies(cookie.split('; ').map((pair) => {
    const at = pair.indexOf('=');
    return { name: pair.slice(0, at), value: pair.slice(at + 1), url: APP, httpOnly: true, sameSite: 'Lax' };
  }));
  return ctx;
}
const idsOf = (source) => [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);

try {
  // ── the owner: signed in, holding a guest connection its account adopted; that token publishes everything ──
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const login = await ctx.newPage();
  await loginViaEmail(login, APP, sink, `mxmx_test_pages_${stamp}@example.com`);
  const anon = await connectAgent(APP);
  const guestCookie = connectionBrowserCookie(APP, anon.token);
  await ctx.addCookies(guestCookie.split('; ').map((pair) => {
    const at = pair.indexOf('=');
    return { name: pair.slice(0, at), value: pair.slice(at + 1), url: APP, httpOnly: true, sameSite: 'Lax' };
  }));
  const adopted = await login.evaluate(async () => (await (await fetch('/api/page/session')).json()).kind);
  check(adopted === 'account', `the account adopts the guest connection (${adopted})`);
  await login.close();
  const api = (pathname, init = {}) => fetch(`${APP}${pathname}`, {
    ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${anon.token}`, ...(init.headers ?? {}) },
  });
  const publish = async (body) => {
    const res = await api('/api/artifacts', { method: 'POST', body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const head = async (id) => (await api(`/api/artifacts/${id}`)).json();

  await section('YouTube referrer in reader and editor', async () => {
    const result = await publish({title:'YouTube referrer fixture', visibility:'unlisted', markup:'<div id="root"><iframe id="youtube" src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ" title="Video" /></div>'});
    check(result.status === 201, 'YouTube fixture publishes');
    const id = result.body.id, page = await ctx.newPage(), refs = [];
    await page.route('https://www.youtube-nocookie.com/embed/**', async route => {
      refs.push((await route.request().allHeaders()).referer ?? '');
      await route.fulfill({contentType:'text/html',body:'<!doctype html><p>Player fixture</p>'});
    });
    try {
      await page.goto(`${APP}/a/${id}`, {waitUntil:'load'});
      const seen = await until(() => refs.length, n => n > 0, 10000);
      check(seen > 0 && refs.every(ref => ref === `${pagesOrigin(id)}/`), `reader sends document origin only (${JSON.stringify(refs)})`);
      const frame = documentLocator(page);
      check(await frame.locator('#youtube').getAttribute('referrerpolicy') === 'strict-origin-when-cross-origin', 'reader retains YouTube referrer policy');
      await openArtifactControls(page);
      await page.locator('[aria-label="Edit artifact"]').click();
      await page.locator('[aria-label="Exit edit mode"]').waitFor({timeout:20000});
      check(await frame.locator('#youtube').getAttribute('referrerpolicy') === 'strict-origin-when-cross-origin', 'editor retains YouTube referrer policy');
    } finally { await page.close(); await api(`/api/artifacts/${id}`, {method:'DELETE'}); }
  });

  // ── 1. the app page frames a private document on its own origin (was gate-pages-origin) ──
  await section('origin', async () => {
    const dataset = await publish({ dataset: [{ region: 'east', amount: 5 }, { region: 'west', amount: 7 }, { region: 'west', amount: 30 }], visibility: 'private', title: 'Pages origin sales' });
    check(dataset.status === 201, `a private dataset is published (${dataset.status} ${dataset.body?.id ?? JSON.stringify(dataset.body)})`);
    const DOC = '<Helmet>'
      + `<Import name="sales" src="ref:${dataset.body?.id}" />`
      + '<Value name="region" type="string" default="east" />'
      + '<Query name="total">{`select region, sum(amount) as amount from sales.rows where region = $region group by region`}</Query>'
      + '<script>{`import { signal } from "page"; const [, setRegion] = signal("$region"); setTimeout(() => setRegion("west"), 1500);`}</script>'
      + '</Helmet><h1 id="intro">Pages origin</h1><DataTable data="$total" />';
    const first = await publish({ markup: DOC, title: 'Pages origin gate', visibility: 'private' });
    const second = await publish({ markup: '<h1>Another private document</h1>', title: 'Second document', visibility: 'private' });
    check(first.status === 201 && second.status === 201, `two private documents are published (${first.body?.id ?? JSON.stringify(first.body)}, ${second.body?.id})`);
    if (first.status !== 201 || second.status !== 201) throw new Error('the origin leg has no documents');
    const A = first.body.id;
    const B = second.body.id;
    const selfA = pagesOrigin(A);

    const page = await ctx.newPage();
    const violations = [];
    page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()); else if (m.type() === 'error') check.note(`console: ${m.text().slice(0, 200)}`); });
    page.on('pageerror', (e) => check.note(`page error: ${String(e?.message ?? e).slice(0, 200)}`));
    // Watch the frame's calls: the request's Origin, the answer's ACAO.
    const doorCalls = [];
    page.on('response', async (res) => {
      const url = new URL(res.url());
      if (!/\/a\/[^/]+\/(query|mutate|viewer|events)$/.test(url.pathname) && !url.pathname.startsWith('/api/')) return;
      const headers = await res.allHeaders().catch(() => ({}));
      doorCalls.push({ url: res.url(), method: res.request().method(), status: res.status(), origin: (await res.request().allHeaders().catch(() => ({}))).origin ?? null, acao: headers['access-control-allow-origin'] ?? null, frame: res.frame()?.url() ?? '' });
    });

    const appResponse = await page.goto(`${APP}/a/${A}`, { waitUntil: 'load' });
    const appCsp = appResponse.headers()['content-security-policy'] ?? '';
    const scriptSrc = appCsp.split('; ').find((d) => d.startsWith('script-src')) ?? '';
    check(!/\bblob:|\bhttps:/.test(scriptSrc), `the app page carries the strict policy: ${scriptSrc.slice(0, 60)}…`);
    check((appCsp.split('; ').find((d) => d.startsWith('frame-src')) ?? '') === `frame-src 'self' http://${PAGES_HOST}:${pages.port} http://*.${PAGES_HOST}:${pages.port}`, 'the app page frames only the pages origins');
    check(await page.locator(DOCUMENT_FRAME).count() === 1, 'the app page holds exactly one document frame');
    const frame = documentLocator(page);
    await frame.locator('#intro').waitFor({ timeout: 30_000 }).catch(() => {});
    const docFrame = await documentFrame(page).catch(() => null);
    check(!!docFrame && docFrame.url().startsWith(selfA), `the frame is the document's own origin (${docFrame?.url() ?? page.frames().map((f) => f.url()).join(', ')})`);
    check(await frame.locator('#intro').textContent().catch(() => null) === 'Pages origin', 'the private document renders in the frame for its signed-in owner');
    const cookies = await ctx.cookies(selfA);
    const pagesCookie = cookies.find((c) => c.name === 'afbin_pages');
    check(!!pagesCookie && pagesCookie.httpOnly && pagesCookie.domain === `.${PAGES_HOST}` && pagesCookie.sameSite === 'Lax', `the pages cookie is HttpOnly, Lax, for .${PAGES_HOST} (${JSON.stringify(pagesCookie && { domain: pagesCookie.domain, httpOnly: pagesCookie.httpOnly, sameSite: pagesCookie.sameSite })})`);
    const docHead = await ctx.request.get(`${selfA}/`, { headers: { cookie: `afbin_pages=${pagesCookie?.value ?? ''}` } }).catch(() => null);
    const docCsp = docHead?.headers()['content-security-policy'] ?? '';
    check(docHead?.status() === 200 && !/(^|; )sandbox/.test(docCsp) && docCsp.includes(`frame-ancestors ${APP}`), `the document carries its own policy, framed by the app alone, no sandbox (${docHead?.status()})`);

    // The script moves the value; the query re-runs through a direct call to its own door.
    await frame.getByText('west', { exact: true }).first().waitFor({ timeout: 20_000 }).catch(() => {});
    const shown = (await frame.locator('table').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    check(/\bwest 37\b/.test(shown), `the script's re-query reached the frame (west 37): ${shown.slice(0, 120)}`);
    const direct = doorCalls.filter((c) => c.url.startsWith(`${selfA}/a/${A}/query`) && c.method === 'POST');
    check(direct.length > 0, `the frame called its own query door directly (${direct.length} POST${direct.length === 1 ? '' : 's'})`);
    check(direct.some((c) => c.status === 200 && c.origin === selfA && c.acao === selfA), `…with Origin ${selfA} and Access-Control-Allow-Origin naming exactly it (${JSON.stringify(direct.map(({ status, origin, acao }) => ({ status, origin, acao })))})`);

    // The same frame asking a second document's door, or an app route: the document's own policy stops both before
    // they leave (connect-src is its own doors). The server's refusal of a forged call is pages-origin-host.test.ts'.
    const probes = [`${pagesOrigin(B)}/a/${B}/query`, `${APP}/api/my/artifacts`];
    const refused = await docFrame?.evaluate(async ([otherDoor, appRoute]) => {
      const ask = async (url, init) => { try { const r = await fetch(url, init); return r.status; } catch { return 'blocked'; } };
      return {
        otherDoor: await ask(otherDoor, { method: 'POST', credentials: 'include', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ values: {} }) }),
        appRoute: await ask(appRoute, { credentials: 'include' }),
      };
    }, probes).catch((e) => ({ error: String(e) }));
    check(refused?.otherDoor === 'blocked' && refused?.appRoute === 'blocked', `the document's policy stops its script reaching a second document's door or an app route (${JSON.stringify(refused)})`);
    check(!doorCalls.some((c) => c.frame.startsWith(selfA) && probes.some((url) => c.url.startsWith(url))), '…so neither request from the frame ever reached the server');
    const unexpected = violations.filter((text) => !probes.some((url) => text.includes(url)));
    check(unexpected.length === 0, `no other CSP violation on either page${unexpected.length ? `: ${unexpected.slice(0, 3).join(' | ')}` : ''}`);
    await page.close();
  });

  // ── 2–5. the script document: runs, is trusted with nothing, is edited and commented (frame-editor + native) ──
  const scripted = await publish({ markup: SCRIPT_DOC, title: 'Native scripts (private)', visibility: 'private' });
  check(scripted.status === 201, `a private script document is published (${scripted.status} ${scripted.body?.id ?? JSON.stringify(scripted.body)})`);
  const ID = scripted.body?.id;
  const SELF = pagesOrigin(ID);
  await section('script document', async () => {
    if (!ID) throw new Error('no script document');
    const before = await head(ID);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console ${m.location()?.url ?? ''}] ${m.text()}`.slice(0, 300)); });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e?.message ?? e)}`.slice(0, 300)));
    const doorCalls = [];
    page.on('response', async (res) => {
      const url = new URL(res.url());
      if (!/\/a\/[^/]+\/(query|fetch)$/.test(url.pathname)) return;
      const sent = await res.request().allHeaders().catch(() => ({}));
      const got = await res.allHeaders().catch(() => ({}));
      doorCalls.push({ url: res.url(), method: res.request().method(), status: res.status(), origin: sent.origin ?? null, cookie: sent.cookie ?? '', acao: got['access-control-allow-origin'] ?? null });
    });
    const frame = documentLocator(page);
    const doc = () => documentFrame(page);

    // ── 2. framed on its own origin, the script runs ──
    await page.goto(`${APP}/a/${ID}`, { waitUntil: 'load' });
    await frame.locator('#intro').waitFor({ timeout: 30_000 }).catch(() => {});
    const framed = await doc().catch(() => null);
    check(!!framed && framed !== page.mainFrame() && framed.url().startsWith(SELF), `the app page frames the document on its own origin (${framed?.url() ?? page.frames().map((f) => f.url()).join(', ')})`);
    check(await page.locator('[aria-label="Artifact viewport"] #lede').count() === 0, 'and holds no adopted copy of its story');
    check(await (await doc()).evaluate(() => window.origin) === SELF, `the framed document runs on its own origin (${SELF})`);
    const effect = await until(() => frame.locator('#effect').textContent(), (t) => t === 'Region is east', 20_000);
    check(effect === 'Region is east', `the script's effect writes the Value (${effect})`);
    const shown = await until(() => frame.locator('#total-out').textContent(), (t) => /Total 5 for east/.test(t ?? ''), 20_000);
    check(/Total 5 for east/.test(shown ?? ''), `the mounted component renders the Query (${shown})`);
    await (await doc()).evaluate(() => window.__mxSetRegion('west'));
    const moved = await until(() => frame.locator('#effect').textContent(), (t) => t === 'Region is west', 10_000);
    check(moved === 'Region is west', `the effect follows the Value change (${moved})`);
    const rerendered = await until(() => frame.locator('#total-out').textContent(), (t) => /Total 37 for west/.test(t ?? ''), 15_000);
    check(/Total 37 for west/.test(rerendered ?? ''), `the component re-renders with the re-run query (${rerendered})`);
    // The re-run is a direct call to the document's own door, with the pages cookie and its ACAO.
    const direct = doorCalls.filter((c) => c.url.startsWith(`${SELF}/a/${ID}/query`) && c.method === 'POST');
    check(direct.length > 0, `the frame queried its own door directly (${direct.length} POST)`);
    check(direct.some((c) => c.status === 200 && c.origin === SELF && /(^|;\s*)afbin_pages=/.test(c.cookie) && c.acao === SELF),
      `…from Origin ${SELF}, with the pages cookie, answered with Access-Control-Allow-Origin naming it (${JSON.stringify(direct.map(({ status, origin, acao, cookie }) => ({ status, origin, acao, pagesCookie: /afbin_pages=/.test(cookie) })))})`);
    check(await page.getByRole('region', { name: 'Document network access' }).count() === 0, 'the publisher of the declared host is not asked about it');

    // ── 3. ENTER edit mode while the script forges: nothing it sends writes, or spends a version ──
    const at = await head(ID);
    await openArtifactControls(page);
    await page.click('[aria-label="Edit artifact"]');
    await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 20000 });
    const editable = await until(async () => (await doc()).evaluate(() => !!document.querySelector('#lede')?.closest('.ProseMirror[contenteditable="true"]')), (v) => v === true, 20000);
    check(editable === true, 'edit mode attaches ProseMirror to the compiled DOM inside the frame');
    // Past two rounds of the forging loop and its late shot, with the editor listening.
    await sleep(3500);
    const now = await head(ID);
    // The PARAGRAPH, not the absence of the word: the forged payloads are in the author script's own source.
    const ledeNow = /<p id="lede">([^<]*)<\/p>/.exec(now.markup)?.[1] ?? '(gone)';
    check(ledeNow === 'The lede paragraph.', `nothing the author script forged reached the document ("${ledeNow}")`);
    check(now.version === at.version, `and it spent no versions trying (v${at.version} → v${now.version})`);

    // ── 4. TYPE inside the frame ──
    const lede = frame.locator('#lede');
    await lede.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Typed in the frame.', { delay: 15 });
    const typed = await until(async () => (await head(ID)).markup, (source) => (source ?? '').includes('The lede paragraph. Typed in the frame.'), 15000);
    check((typed ?? '').includes('<p id="lede">The lede paragraph. Typed in the frame.</p>'), 'the typing is saved by the page, in place, with the paragraph\'s id');

    // BOLD a word from the page's toolbar: select "second" inside the frame (a Selection only the document can make).
    const second = frame.locator('#second');
    await second.click();
    await (await doc()).evaluate(() => {
      const text = document.querySelector('#second').firstChild;
      const range = document.createRange();
      range.setStart(text, 2);
      range.setEnd(text, 8);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await sleep(300);
    const bold = page.locator('[aria-label="Toggle bold"]').first();
    await bold.waitFor({ timeout: 10000 });
    await bold.click();
    const bolded = await until(() => second.evaluate((el) => el.innerHTML), (html) => /<strong[^>]*>second<\/strong>/.test(html ?? ''), 8000);
    check(/<strong[^>]*>second<\/strong>/.test(bolded ?? ''), `the page's toolbar bolds the word selected in the frame (${bolded})`);
    const boldSaved = await until(async () => (await head(ID)).markup, (source) => /<p id="second">A <strong[^>]*>second<\/strong> paragraph/.test(source ?? ''), 15000);
    check(/<p id="second">A <strong[^>]*>second<\/strong> paragraph/.test(boldSaved ?? ''), 'and the bold is saved');

    // UNDO with Mod-Z pressed inside the frame.
    await second.click({ position: { x: 120, y: 8 } });
    await page.keyboard.press(`${MOD}+z`);
    const undone = await until(() => second.evaluate((el) => el.innerHTML), (html) => !/<strong\b/.test(html ?? '<strong'), 8000);
    check(!/<strong\b/.test(undone ?? '<strong'), `Mod-Z inside the frame undoes the bold through the page's history (${undone})`);
    const undoSaved = await until(async () => (await head(ID)).markup, (source) => (source ?? '').includes('<p id="second">A second paragraph that stays put.</p>'), 15000);
    check((undoSaved ?? '').includes('<p id="second">A second paragraph that stays put.</p>'), 'and the undo is saved');

    // The mount's badge opens the script at its export.
    const badge = frame.getByRole('button', { name: 'Edit script' });
    const badged = await until(() => badge.count(), (n) => n === 1, 15_000);
    check(badged === 1, 'the script mount carries an "Edit script" badge in edit mode');
    await badge.click();
    const pane = page.locator('[aria-label="Source pane"]');
    await pane.waitFor({ timeout: 15_000 }).catch(() => {});
    check(await pane.count() === 1, 'the badge opens the source editor on the app page');
    const activeLine = await until(() => pane.locator('.cm-activeLine').first().textContent(), (t) => /export function Total/.test(t ?? ''), 15_000);
    check(/export function Total/.test(activeLine ?? ''), `…with the caret on the component's export line (${(activeLine ?? '').trim().slice(0, 60)})`);

    // ── LEAVE ──
    await page.click('[aria-label="Exit edit mode"]');
    const reading = await until(async () => (await doc()).evaluate(() => !document.querySelector('.ProseMirror')), (v) => v === true, 20000);
    check(reading === true, 'Done returns the frame to reading (no editor left in it)');
    const after = await head(ID);
    check(after.version > before.version, `the stored version advanced (v${before.version} → v${after.version})`);
    check(after.markup.includes('<p id="lede">The lede paragraph. Typed in the frame.</p>'), 'the stored source changed as typed');
    check(/<p id="lede">([^<]*)<\/p>/.exec(after.markup)?.[1] === 'The lede paragraph. Typed in the frame.', 'nothing the author\'s script forged reached the paragraph it aimed at');
    check(JSON.stringify(idsOf(after.markup)) === JSON.stringify(idsOf(before.markup)), `node ids unchanged (${idsOf(after.markup).join(',')})`);
    check(await (await doc()).evaluate(() => document.querySelector('#lede')?.textContent) === 'The lede paragraph. Typed in the frame.', 'the frame reads the saved text in place');
    const heard = await (await doc()).evaluate(() => window.__mxHeardEnvelopes);
    check(heard === 0, `the author's listeners never heard a bridge envelope (heard ${heard})`);
    const remounted = await until(() => frame.locator('#total-out').count(), (n) => n === 1, 15_000);
    check(remounted === 1, 'the component mounts again after editing');

    // ── 5. COMMENT on a paragraph through the page's layer ──
    const third = frame.locator('#third');
    const bubble = frame.locator('[aria-label="Comment on selected text"]');
    const offered = await until(async () => {
      await third.click({ clickCount: 3, timeout: 2000 }).catch(() => {});
      return bubble.isVisible().catch(() => false);
    }, (v) => v === true, 15000);
    check(offered === true, 'selecting a paragraph inside the frame offers the comment action');
    await bubble.click();
    const composer = page.locator('[aria-label="Annotation comment"]');
    await composer.waitFor({ timeout: 10000 });
    check(true, 'the page opens its composer for the paragraph selected in the frame');
    await composer.fill('Framed comment');
    await page.locator('[aria-label="Save annotation"]').click();
    const tinted = await until(() => third.evaluate((el) => el.hasAttribute('data-mx-annotated')), (v) => v === true, 10000);
    check(tinted === true, 'the commented paragraph is marked inside the frame');
    const marker = page.locator('[aria-label^="Open annotation conversation by"]').first();
    await marker.waitFor({ timeout: 10000 });
    const iframe = page.locator(DOCUMENT_FRAME);
    const pin = await until(async () => {
      const box = await marker.boundingBox();
      const frameBox = await iframe.boundingBox();
      const rect = await third.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      return box && frameBox ? { pin: box.y, top: frameBox.y + rect.top, bottom: frameBox.y + rect.bottom } : null;
    }, (value) => !!value && value.pin >= value.top - 8 && value.pin <= value.bottom + 8, 8000);
    check(!!pin && pin.pin >= pin.top - 8 && pin.pin <= pin.bottom + 8,
      `the comment's pin lands on the paragraph inside the frame (pin ${pin?.pin?.toFixed(1)}, paragraph ${pin?.top?.toFixed(1)}–${pin?.bottom?.toFixed(1)})`);
    const stored = await (await api(`/api/artifacts/${ID}/annotations`)).json().catch(() => null);
    const anchored = JSON.stringify(stored ?? {});
    check(anchored.includes('Framed comment') && anchored.includes('third'), 'the stored comment is anchored on that paragraph');

    check(errors.length === 0, `no console errors on the owner's pages${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
    await page.close();
  });

  // ── 6. another reader is asked; proxy() waits on their consent (was gate-native-scripts §3) ──
  await section('consent', async () => {
    const unlisted = await publish({ markup: SCRIPT_DOC, title: 'Native scripts (unlisted)', visibility: 'unlisted' });
    check(unlisted.status === 201, `a unlisted script document is published (${unlisted.status} ${unlisted.body?.id ?? JSON.stringify(unlisted.body)})`);
    const UNLISTED = unlisted.body.id;
    const reader = await connectAgent(APP);
    const rctx = await contextFor(reader.token);
    const rpage = await rctx.newPage();
    await rpage.goto(`${APP}/a/${UNLISTED}`, { waitUntil: 'load' });
    const rframe = documentLocator(rpage);
    await rframe.locator('#intro').waitFor({ timeout: 30_000 }).catch(() => {});
    const bar = rpage.getByRole('region', { name: 'Document network access' });
    await bar.waitFor({ timeout: 15_000 }).catch(() => {});
    check(await bar.count() === 1, `another reader is asked on the consent bar (${(await bar.textContent().catch(() => '')).slice(0, 80)})`);
    const barBox = await bar.boundingBox();
    const frameBox = await rpage.locator(DOCUMENT_FRAME).boundingBox();
    check(!!barBox && !!frameBox && frameBox.y >= barBox.y + barBox.height - 1, `the bar sits above the frame, not over it (bar ${barBox?.y}+${barBox?.height}, frame ${frameBox?.y})`);
    // Re-resolved on every call: Allow once loads the frame again.
    const rdoc = () => documentFrame(rpage);
    await until(async () => (await rdoc()).evaluate(() => typeof window.__mxProxy), (t) => t === 'function', 15_000);
    const refused = await (await rdoc()).evaluate(() => window.__mxProxy('https://esm.sh/'));
    check(refused === 403, `before consent the document's fetch door refuses the declared host (${refused})`);
    await (await rdoc()).evaluate(() => { window.__mxBefore = true; });
    await bar.getByRole('button', { name: 'Allow once' }).click();
    const reloaded = await until(async () => (await rdoc()).evaluate(() => !window.__mxBefore && typeof window.__mxProxy === 'function'), (v) => v === true, 20_000);
    check(reloaded === true, 'Allow once loads the frame again');
    check(await bar.count() === 0, 'and the bar is gone');
    const accepted = await (await rdoc()).evaluate(() => window.__mxProxy('https://esm.sh/'));
    check(accepted !== 403 && accepted !== 'failed', `after consent the fetch door accepts the declared host (${accepted}${accepted === 200 ? '' : ': the upstream itself was unreachable from here'})`);
    await rctx.close();
  });

  // ── 7. afbin export photographs the mounted component (was gate-native-scripts §6) ──
  await section('export', async () => {
    const cli = path.join(ROOT, 'services/cli/dist/afbin.mjs');
    if (!existsSync(cli)) { check(false, 'the CLI is built (services/cli/dist/afbin.mjs): run `npm run build -w services/cli`'); return; }
    const out = path.join(scratch, 'export.png');
    // The CLI talks to an https server or to http on localhost: the same server, addressed as localhost.
    const server = `http://localhost:${pages.port}`;
    const child = spawn(process.execPath, [cli, 'export', ID, '--format', 'png', '--output', 'export.png', '--server', server, '--json'], {
      cwd: scratch, env: { ...process.env, HOME: scratch, ARTIFACTBIN_TOKEN: anon.token, ARTIFACTBIN_URL: server, ARTIFACTBIN_SKILLS: 'off' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => { child.once('exit', resolve); child.once('error', () => resolve(-1)); });
    check(code === 0 && existsSync(out), `afbin export writes the PNG (exit ${code}${code === 0 ? '' : `: ${stderr.slice(-300)}`})`);
    if (code === 0 && existsSync(out)) {
      const shot = await browser.newPage();
      const magenta = await shot.evaluate(async (dataUrl) => {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let hits = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] > 230 && data[i + 1] < 40 && data[i + 2] > 230) hits++;
        return hits;
      }, `data:image/png;base64,${readFileSync(out).toString('base64')}`);
      check(magenta > 2000, `the export shows the mounted component, not its fallback (${magenta} magenta px)`);
      await shot.close();
    }
  });
  await ctx.close();
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
  sink.close();
  pages.stop();
}
check.done();

/**
 * Gate: EVERY DOCUMENT ON ITS OWN ORIGIN (APP__PAGES_HOST, services/app/server/pages-host).
 *
 * What only a browser can prove about the framed document:
 *
 *   1. a PRIVATE document opened on the app page loads inside a frame on its own origin
 *      (`<hex(id)>.lvh.me`), through the one-time ticket the app page minted for its signed-in owner;
 *   2. the app page carries the strict app policy (no `blob:`/`https:` script), framing only the pages
 *      origins, and the document carries the document policy (no `sandbox`, framed by the app alone);
 *   3. the document's own script moves a value and the query re-runs through a DIRECT call to the
 *      document's own door — the request's Origin is the document's origin and the answer's
 *      `Access-Control-Allow-Origin` names exactly it — and the new rows reach the frame;
 *   4. the same frame asking a SECOND document's door (or any app route) is refused: 403 `forbidden_origin`.
 *
 * The gate runner's servers boot without the setting, so this gate boots its own production server
 * (dist/server.mjs, as scripts/gates.mjs does) with `APP__PAGES_HOST=lvh.me` and the app at
 * `http://app.lvh.me:<port>` — unless the base it is handed already serves pages (a developer's
 * `npm run setup -- --pages-host` dev server), which it then drives. `*.lvh.me` is mapped to loopback
 * in Chromium (`--host-resolver-rules`) and in this process, so no DNS is needed.
 *
 *   node scripts/gates/gate-pages-origin.mjs [base]
 */
import { spawn } from 'node:child_process';
import dns from 'node:dns';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createChecker } from './lib/assert.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';
import { connectAgent, connectionBrowserCookie } from './lib/cli-connection.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const check = createChecker('pages-origin');
const PAGES_HOST = 'lvh.me';

// ── *.lvh.me is loopback, in this process too (the container may have no DNS) ──
const originalLookup = dns.lookup;
dns.lookup = function lookup(hostname, options, callback) {
  if (typeof hostname === 'string' && (hostname === PAGES_HOST || hostname.endsWith(`.${PAGES_HOST}`))) {
    const cb = typeof options === 'function' ? options : callback;
    const all = typeof options === 'object' && options?.all;
    process.nextTick(() => (all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)));
    return {};
  }
  return originalLookup.call(this, hostname, options, callback);
};

const label = (id) => Buffer.from(id, 'utf8').toString('hex');
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

/** Does the server on this port serve pages at lvh.me? Its apex answers `invalid_next` to a bare exchange. */
async function servesPages(port) {
  try {
    const res = await fetch(`http://${PAGES_HOST}:${port}/pages-session?next=x`, { signal: AbortSignal.timeout(3000) });
    return res.status === 400 && (await res.json().catch(() => ({}))).error === 'invalid_next';
  } catch { return false; }
}

let child = null;
let scratch = null;
async function bootOwnServer() {
  const bundle = path.join(ROOT, 'dist/server.mjs');
  if (!existsSync(bundle)) throw new Error('the pages-origin gate boots its own server from dist/server.mjs: run `npm run build` first');
  const port = await freePort();
  scratch = mkdtempSync(path.join(os.tmpdir(), 'gate-pages-origin-'));
  const objects = path.join(scratch, 'objects');
  mkdirSync(objects, { recursive: true });
  // The login code is read from the outbox this server writes: the runner's, or our own.
  process.env.EMAIL__DEV_OUTBOX_PATH ??= path.join(scratch, 'dev-mail.jsonl');
  const app = `http://app.${PAGES_HOST}:${port}`;
  child = spawn(process.execPath, [bundle], {
    cwd: path.join(ROOT, 'services/app'),
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      APP__PORT: String(port),
      APP__PUBLIC_BASE_URL: app,
      APP__PAGES_HOST: PAGES_HOST,
      APP__ASSETS_ORIGIN: '',
      AUTH__SECRET: process.env.AUTH__SECRET || `gate-pages-origin-${Date.now()}`,
      DATABASE_URL: 'pglite://memory',
      SQL__SERVICE_URL: '', BROWSER__SERVICE_URL: '', EVENTS__SERVICE_URL: '',
      EXPORT__INTERNAL_ORIGIN: `http://127.0.0.1:${port}`,
      OBJECT_STORE__LOCAL_DIR: objects,
      ARTIFACTS__ALLOW_PUBLIC: '1',
      EMAIL__DEV_OUTBOX_PATH: process.env.EMAIL__DEV_OUTBOX_PATH,
    },
  });
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`the pages-origin server exited with ${child.exitCode}`);
    if (await servesPages(port)) return port;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the pages-origin server never answered');
}
const stop = () => { if (child && child.exitCode === null) child.kill('SIGKILL'); if (scratch) rmSync(scratch, { recursive: true, force: true }); };
process.on('exit', stop);

const given = process.argv[2] ? new URL(process.argv[2]) : null;
const givenPort = given ? Number(given.port || (given.protocol === 'https:' ? 443 : 80)) : null;
const port = givenPort && await servesPages(givenPort) ? givenPort : await bootOwnServer();
const APP = `http://app.${PAGES_HOST}:${port}`;
const pagesOrigin = (id) => `http://${label(id)}.${PAGES_HOST}:${port}`;
check.note(`driving ${APP} (pages at *.${PAGES_HOST}:${port}${child ? ', booted by this gate' : ''})`);

const stamp = Date.now().toString(36);
const EMAIL = `mxmx_test_pages_${stamp}@example.com`;
const sink = await startMailSink();
const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP *.${PAGES_HOST} 127.0.0.1, MAP ${PAGES_HOST} 127.0.0.1`] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const violations = [];
  ctx.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()); else if (m.type() === 'error') check.note(`console: ${m.text().slice(0, 200)}`); });
  ctx.on('weberror', (e) => check.note(`page error: ${String(e.error()?.message ?? e.error()).slice(0, 200)}`));
  await loginViaEmail(page, APP, sink, EMAIL);

  // ── the owner's token, guest-owned and adopted by their session; it publishes everything below ──
  // The guest's browser cookie rides into this browser, where the signed-in account adopts it.
  const anon = await connectAgent(APP);
  const guestCookie = connectionBrowserCookie(APP, anon.token);
  await ctx.addCookies(guestCookie.split('; ').map((pair) => {
    const at = pair.indexOf('=');
    return { name: pair.slice(0, at), value: pair.slice(at + 1), url: APP, httpOnly: true, sameSite: 'Lax' };
  }));
  const adopted = await page.evaluate(async () => (await (await fetch('/api/page/session')).json()).kind);
  check(adopted === 'account', `the account adopts the guest connection (${adopted})`);
  const api = async (body) => {
    const res = await fetch(`${APP}/api/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${anon.token}` }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const dataset = await api({ dataset: [{ region: 'east', amount: 5 }, { region: 'west', amount: 7 }, { region: 'west', amount: 30 }], visibility: 'private', title: 'Pages origin sales' });
  check(dataset.status === 201, `a private dataset is published (${dataset.status} ${dataset.body?.id ?? JSON.stringify(dataset.body)})`);
  const DOC = '<Helmet>'
    + `<Import name="sales" src="ref:${dataset.body?.id}" />`
    + '<Value name="region" type="string" default="east" />'
    + '<Query name="total">{`select region, sum(amount) as amount from sales.rows where region = $region group by region`}</Query>'
    + '<script>{`import { signal } from "page"; const [, setRegion] = signal("$region"); setTimeout(() => setRegion("west"), 1500);`}</script>'
    + '</Helmet><h1 id="intro">Pages origin</h1><DataTable data="$total" />';
  const first = await api({ markup: DOC, title: 'Pages origin gate', visibility: 'private' });
  const second = await api({ markup: '<h1>Another private document</h1>', title: 'Second document', visibility: 'private' });
  check(first.status === 201 && second.status === 201, `two private documents are published (${first.body?.id ?? JSON.stringify(first.body)}, ${second.body?.id})`);
  if (first.status !== 201 || second.status !== 201) check.done();
  const A = first.body?.id;
  const B = second.body?.id;
  const selfA = pagesOrigin(A);

  // ── watch the frame's calls: the request's Origin, the answer's ACAO ──
  const doorCalls = [];
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (!/\/a\/[^/]+\/(query|mutate|viewer|events)$/.test(url.pathname) && !url.pathname.startsWith('/api/')) return;
    const headers = await res.allHeaders().catch(() => ({}));
    doorCalls.push({ url: res.url(), method: res.request().method(), status: res.status(), origin: (await res.request().allHeaders().catch(() => ({}))).origin ?? null, acao: headers['access-control-allow-origin'] ?? null, frame: res.frame()?.url() ?? '' });
  });

  // ── 1 + 2. the app page frames the private document on its own origin ──
  const appResponse = await page.goto(`${APP}/a/${A}`, { waitUntil: 'load' });
  const appCsp = appResponse.headers()['content-security-policy'] ?? '';
  const scriptSrc = appCsp.split('; ').find((d) => d.startsWith('script-src')) ?? '';
  check(!/\bblob:|\bhttps:/.test(scriptSrc), `the app page carries the strict policy: ${scriptSrc.slice(0, 60)}…`);
  check((appCsp.split('; ').find((d) => d.startsWith('frame-src')) ?? '') === `frame-src 'self' http://${PAGES_HOST}:${port} http://*.${PAGES_HOST}:${port}`, 'the app page frames only the pages origins');
  const frameEl = page.locator('iframe[data-mx-document-frame]');
  check(await frameEl.count() === 1, 'the app page holds exactly one document frame');
  const frame = page.frameLocator('iframe[data-mx-document-frame]');
  await frame.locator('#intro').waitFor({ timeout: 30_000 }).catch(() => {});
  const docFrame = page.frames().find((f) => f.url().startsWith(selfA));
  check(!!docFrame, `the frame is the document's own origin (${docFrame?.url() ?? page.frames().map((f) => f.url()).join(', ')})`);
  check(await frame.locator('#intro').textContent().catch(() => null) === 'Pages origin', 'the private document renders in the frame for its signed-in owner');
  const cookies = await ctx.cookies(selfA);
  const pagesCookie = cookies.find((c) => c.name === 'afbin_pages');
  check(!!pagesCookie && pagesCookie.httpOnly && pagesCookie.domain === `.${PAGES_HOST}` && pagesCookie.sameSite === 'Lax', `the pages cookie is HttpOnly, Lax, for .${PAGES_HOST} (${JSON.stringify(pagesCookie && { domain: pagesCookie.domain, httpOnly: pagesCookie.httpOnly, sameSite: pagesCookie.sameSite })})`);
  const docHead = await ctx.request.get(`${selfA}/`, { headers: { cookie: `afbin_pages=${pagesCookie?.value ?? ''}` } }).catch(() => null);
  const docCsp = docHead?.headers()['content-security-policy'] ?? '';
  check(docHead?.status() === 200 && !/(^|; )sandbox/.test(docCsp) && docCsp.includes(`frame-ancestors ${APP}`), `the document carries its own policy, framed by the app alone, no sandbox (${docHead?.status()})`);

  // ── 3. the script moves the value; the query re-runs through a direct call to its own door ──
  await frame.getByText('west', { exact: true }).first().waitFor({ timeout: 20_000 }).catch(() => {});
  const shown = (await frame.locator('table').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(/\bwest 37\b/.test(shown), `the script's re-query reached the frame (west 37): ${shown.slice(0, 120)}`);
  const direct = doorCalls.filter((c) => c.url.startsWith(`${selfA}/a/${A}/query`) && c.method === 'POST');
  check(direct.length > 0, `the frame called its own query door directly (${direct.length} POST${direct.length === 1 ? '' : 's'})`);
  check(direct.some((c) => c.status === 200 && c.origin === selfA && c.acao === selfA), `…with Origin ${selfA} and Access-Control-Allow-Origin naming exactly it (${JSON.stringify(direct.map(({ status, origin, acao }) => ({ status, origin, acao })))})`);

  // ── 4. the same frame asking a second document's door, or an app route, is refused ──
  // In the browser the document's own policy stops both before they leave (connect-src is its own doors)…
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
  // …and the server refuses them anyway, whoever carries the document's origin and its cookie.
  const pagesCookieHeader = `afbin_pages=${pagesCookie?.value ?? ''}`;
  const forged = await fetch(probes[0], { method: 'POST', headers: { origin: selfA, 'content-type': 'text/plain', cookie: pagesCookieHeader }, body: JSON.stringify({ values: {} }) });
  check(forged.status === 403 && (await forged.json().catch(() => ({}))).error === 'forbidden_origin' && !forged.headers.get('access-control-allow-origin'), `a second document's door answers this document's origin 403 forbidden_origin, without CORS (${forged.status})`);
  const appForged = await fetch(probes[1], { headers: { origin: selfA, 'sec-fetch-site': 'same-site', cookie: pagesCookieHeader } });
  check(appForged.status === 403, `an app route answers a document origin 403 (${appForged.status})`);
  const unexpected = violations.filter((text) => !probes.some((url) => text.includes(url)));
  check(unexpected.length === 0, `no other CSP violation on either page${unexpected.length ? `: ${unexpected.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
} finally {
  await browser.close();
  stop();
}
check.done();

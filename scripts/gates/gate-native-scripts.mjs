/**
 * Gate: A SCRIPT DOCUMENT ON ITS OWN ORIGIN, END TO END (APP__PAGES_HOST: brief A's frame, B's bridge, C's consent,
 * D's badge and export).
 *
 * A private document whose Helmet script binds a Value and a Query, mounts a component and declares
 * `<meta name="csp-connect" content="https://esm.sh">`:
 *
 *   1. the app page frames it on `<hex(id)>.lvh.me` and the script runs there: an effect's text follows a Value
 *      change and the mounted component re-renders with the re-run query;
 *   2. that re-run is a direct call to the document's own query door, with the pages cookie, answered with
 *      `Access-Control-Allow-Origin` naming exactly the document's origin;
 *   3. another reader (a second connection, the document unlisted) is asked on the consent bar, which sits above the
 *      frame; `proxy()` to the declared host is refused (403) before consent, and after Allow once the frame loads
 *      again and the fetch door accepts it (200 when this host has egress; the upstream's own failure otherwise);
 *   4. the owner enters edit mode, types into a paragraph inside the frame, the mount's "Edit script" badge opens the
 *      source editor on the component's export line, and Done saves with every node id unchanged;
 *   5. a comment made on a paragraph inside the frame pins on that paragraph;
 *   6. `afbin export <id> --format png` photographs the mounted component (its magenta block), not its fallback.
 *
 *   node scripts/gates/gate-native-scripts.mjs [base]
 *
 * A base that serves pages (a `npm run setup -- --pages-host` dev server) is driven as it is; otherwise this gate
 * boots its own production server with the setting on (./lib/pages-server).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/browser.mjs';
import { createChecker } from './lib/assert.mjs';
import { connectAgent, connectionBrowserCookie } from './lib/cli-connection.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { PAGES_HOST, pagesServer } from './lib/pages-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const check = createChecker('native-scripts');
const pages = await pagesServer(process.argv[2], 'native-scripts');
const APP = pages.app;
check.note(`driving ${APP} (pages at *.${PAGES_HOST}:${pages.port}${pages.booted ? ', booted by this gate' : ''})`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (probe, ok, timeout) => {
  const end = Date.now() + timeout;
  let value = await probe().catch(() => undefined);
  while (!ok(value) && Date.now() < end) { await sleep(150); value = await probe().catch(() => undefined); }
  return value;
};

// No backticks or `${` inside: the script is a template literal in the markup.
const SCRIPT = `
  import { signal, query, proxy } from 'page';
  import { createEffect } from 'solid-js';
  const [region, setRegion] = signal('$region');
  const total = query('$total');
  createEffect(() => { document.querySelector('#effect').textContent = 'Region is ' + region(); });
  window.__mxSetRegion = setRegion;
  window.__mxProxy = (url) => fetch(proxy(url)).then((r) => r.status, () => 'failed');
  window.__mxRows = () => total().length;
  export function Total(props) {
    const row = () => props.rows[0];
    return <div id="total-out" style={{ background: '#ff00ff', color: '#ffffff', padding: '32px', 'font-size': '22px' }}>Total {row() ? row().amount : '...'} for {row() ? row().region : '...'}</div>;
  }
`;
const DOC = '<Helmet>'
  + '<meta name="csp-connect" content="https://esm.sh" />'
  + '<Value name="region" type="string" default="east" />'
  + '<Value name="sales" type="table" value={[{region: "east", amount: 5}, {region: "west", amount: 7}, {region: "west", amount: 30}]} />'
  + '<Query name="total">{`select region, sum(amount) as amount from sales where region = $region group by region`}</Query>'
  + `<script>{\`${SCRIPT}\`}</script>`
  + '</Helmet>'
  + '<h1 id="intro">Native scripts</h1>'
  + '<p id="lede">The lede paragraph.</p>'
  + '<p id="effect">Loading…</p>'
  + '<Total rows={$total}><p>Loading total…</p></Total>'
  + '<p id="third">A paragraph to comment on.</p>'
  + '<p id="after">A paragraph after.</p>';

const owner = await connectAgent(APP);
const api = (pathname, init = {}) => fetch(`${APP}${pathname}`, {
  ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}`, ...(init.headers ?? {}) },
});
const publish = async (visibility) => {
  const res = await api('/api/artifacts', { method: 'POST', body: JSON.stringify({ markup: DOC, title: `Native scripts (${visibility})`, visibility }) });
  const body = await res.json().catch(() => null);
  check(res.status === 201, `a ${visibility} script document is published (${res.status} ${body?.id ?? JSON.stringify(body)})`);
  if (res.status !== 201) check.done();
  return body.id;
};
const head = async (id) => (await api(`/api/artifacts/${id}`)).json();
const idsOf = (source) => [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);

const ID = await publish('private');
const SELF = pages.origin(ID);
const before = await head(ID);

/** A browser context holding a connection's cookie on the app origin (the owner, or another reader). */
async function contextFor(token) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const cookie = connectionBrowserCookie(APP, token);
  await ctx.addCookies(cookie.split('; ').map((pair) => {
    const at = pair.indexOf('=');
    return { name: pair.slice(0, at), value: pair.slice(at + 1), url: APP, httpOnly: true, sameSite: 'Lax' };
  }));
  return ctx;
}
const docFrameOf = (page, self) => page.frames().find((f) => f.url().startsWith(self));

const browser = await launchChromium({ args: pages.browserArgs });
const errors = [];
const scratch = mkdtempSync(path.join(os.tmpdir(), 'gate-native-scripts-'));
try {
  const ctx = await contextFor(owner.token);
  const page = await ctx.newPage();
  ctx.on('console', (m) => { if (m.type() === 'error') errors.push(`[console ${m.location()?.url ?? ''}] ${m.text()}`.slice(0, 300)); });
  ctx.on('weberror', (e) => errors.push(`[pageerror] ${String(e.error()?.message ?? e.error())}`.slice(0, 300)));
  const doorCalls = [];
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (!/\/a\/[^/]+\/(query|fetch)$/.test(url.pathname)) return;
    const sent = await res.request().allHeaders().catch(() => ({}));
    const got = await res.allHeaders().catch(() => ({}));
    doorCalls.push({ url: res.url(), method: res.request().method(), status: res.status(), origin: sent.origin ?? null, cookie: sent.cookie ?? '', acao: got['access-control-allow-origin'] ?? null });
  });

  // ── 1. framed on its own origin, the script runs ──
  await page.goto(`${APP}/a/${ID}`, { waitUntil: 'load' });
  const frame = page.frameLocator('iframe[data-mx-document-frame]');
  await frame.locator('#intro').waitFor({ timeout: 30_000 }).catch(() => {});
  const doc = () => docFrameOf(page, SELF);
  check(!!doc(), `the app page frames the document on its own origin (${doc()?.url() ?? page.frames().map((f) => f.url()).join(', ')})`);
  const effect = await until(() => frame.locator('#effect').textContent(), (t) => t === 'Region is east', 20_000);
  check(effect === 'Region is east', `the script's effect writes the Value (${effect})`);
  const shown = await until(() => frame.locator('#total-out').textContent(), (t) => /Total 5 for east/.test(t ?? ''), 20_000);
  check(/Total 5 for east/.test(shown ?? ''), `the mounted component renders the Query (${shown})`);
  await doc().evaluate(() => window.__mxSetRegion('west'));
  const moved = await until(() => frame.locator('#effect').textContent(), (t) => t === 'Region is west', 10_000);
  check(moved === 'Region is west', `the effect follows the Value change (${moved})`);
  const rerendered = await until(() => frame.locator('#total-out').textContent(), (t) => /Total 37 for west/.test(t ?? ''), 15_000);
  check(/Total 37 for west/.test(rerendered ?? ''), `the component re-renders with the re-run query (${rerendered})`);

  // ── 2. the re-run is a direct call to the document's own door, with the pages cookie and its ACAO ──
  const direct = doorCalls.filter((c) => c.url.startsWith(`${SELF}/a/${ID}/query`) && c.method === 'POST');
  check(direct.length > 0, `the frame queried its own door directly (${direct.length} POST)`);
  check(direct.some((c) => c.status === 200 && c.origin === SELF && /(^|;\s*)afbin_pages=/.test(c.cookie) && c.acao === SELF),
    `…from Origin ${SELF}, with the pages cookie, answered with Access-Control-Allow-Origin naming it (${JSON.stringify(direct.map(({ status, origin, acao, cookie }) => ({ status, origin, acao, pagesCookie: /afbin_pages=/.test(cookie) })))})`);
  const ownerBar = await page.getByRole('region', { name: 'Document network access' }).count();
  check(ownerBar === 0, 'the publisher of the declared host is not asked about it');

  // ── 4. edit in the frame: type, the mount's badge opens the script at its export, Done ──
  await openArtifactControls(page);
  await page.click('[aria-label="Edit artifact"]');
  await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 20_000 });
  const editable = await until(() => doc().evaluate(() => !!document.querySelector('#lede')?.closest('.ProseMirror[contenteditable="true"]')), (v) => v === true, 20_000);
  check(editable === true, 'edit mode attaches the editor to the document inside the frame');
  const lede = frame.locator('#lede');
  await lede.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Typed in the frame.', { delay: 15 });
  const typed = await until(async () => (await head(ID)).markup, (source) => (source ?? '').includes('The lede paragraph. Typed in the frame.'), 15_000);
  check((typed ?? '').includes('<p id="lede">The lede paragraph. Typed in the frame.</p>'), 'the typing is saved in place, with the paragraph\'s id');
  const badge = frame.getByRole('button', { name: 'Edit script' });
  const badged = await until(() => badge.count(), (n) => n === 1, 15_000);
  check(badged === 1, 'the script mount carries an "Edit script" badge in edit mode');
  await badge.click();
  const pane = page.locator('[aria-label="Source pane"]');
  await pane.waitFor({ timeout: 15_000 }).catch(() => {});
  check(await pane.count() === 1, 'the badge opens the source editor on the app page');
  const activeLine = await until(() => pane.locator('.cm-activeLine').first().textContent(), (t) => /export function Total/.test(t ?? ''), 15_000);
  check(/export function Total/.test(activeLine ?? ''), `…with the caret on the component's export line (${(activeLine ?? '').trim().slice(0, 60)})`);
  await page.click('[aria-label="Exit edit mode"]');
  const reading = await until(() => doc().evaluate(() => !document.querySelector('.ProseMirror')), (v) => v === true, 20_000);
  check(reading === true, 'Done returns the frame to reading');
  const after = await head(ID);
  check(after.version > before.version, `the stored version advanced (v${before.version} → v${after.version})`);
  check(JSON.stringify(idsOf(after.markup)) === JSON.stringify(idsOf(before.markup)), `node ids unchanged (${idsOf(after.markup).join(',')})`);
  const remounted = await until(() => frame.locator('#total-out').count(), (n) => n === 1, 15_000);
  check(remounted === 1, 'the component mounts again after editing');

  // ── 5. a comment on a paragraph inside the frame pins on it ──
  const third = frame.locator('#third');
  const bubble = frame.locator('[aria-label="Comment on selected text"]');
  const offered = await until(async () => {
    await third.click({ clickCount: 3, timeout: 2000 }).catch(() => {});
    return bubble.isVisible().catch(() => false);
  }, (v) => v === true, 15_000);
  check(offered === true, 'selecting a paragraph inside the frame offers the comment action');
  await bubble.click().catch(() => {});
  const composer = page.locator('[aria-label="Annotation comment"]');
  await composer.waitFor({ timeout: 10_000 }).catch(() => {});
  await composer.fill('Framed comment').catch(() => {});
  await page.locator('[aria-label="Save annotation"]').click().catch(() => {});
  const marker = page.locator('[aria-label^="Open annotation conversation by"]').first();
  await marker.waitFor({ timeout: 10_000 }).catch(() => {});
  const iframe = page.locator('iframe[data-mx-document-frame]');
  const pin = await until(async () => {
    const box = await marker.boundingBox();
    const frameBox = await iframe.boundingBox();
    const rect = await third.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    return box && frameBox ? { pin: box.y, top: frameBox.y + rect.top, bottom: frameBox.y + rect.bottom } : null;
  }, (v) => !!v && v.pin >= v.top - 8 && v.pin <= v.bottom + 8, 10_000);
  check(!!pin && pin.pin >= pin.top - 8 && pin.pin <= pin.bottom + 8,
    `the comment's pin lands on the paragraph inside the frame (pin ${pin?.pin?.toFixed(1)}, paragraph ${pin?.top?.toFixed(1)}–${pin?.bottom?.toFixed(1)})`);
  check(errors.length === 0, `no console errors on the owner's pages${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();

  // ── 3. another reader is asked; proxy() waits on their consent ──
  const UNLISTED = await publish('unlisted');
  const SELF2 = pages.origin(UNLISTED);
  const reader = await connectAgent(APP);
  const rctx = await contextFor(reader.token);
  const rpage = await rctx.newPage();
  await rpage.goto(`${APP}/a/${UNLISTED}`, { waitUntil: 'load' });
  const rframe = rpage.frameLocator('iframe[data-mx-document-frame]');
  await rframe.locator('#intro').waitFor({ timeout: 30_000 }).catch(() => {});
  const bar = rpage.getByRole('region', { name: 'Document network access' });
  await bar.waitFor({ timeout: 15_000 }).catch(() => {});
  check(await bar.count() === 1, `another reader is asked on the consent bar (${(await bar.textContent().catch(() => '')).slice(0, 80)})`);
  const barBox = await bar.boundingBox();
  const frameBox = await rpage.locator('iframe[data-mx-document-frame]').boundingBox();
  check(!!barBox && !!frameBox && frameBox.y >= barBox.y + barBox.height - 1, `the bar sits above the frame, not over it (bar ${barBox?.y}+${barBox?.height}, frame ${frameBox?.y})`);
  const rdoc = () => docFrameOf(rpage, SELF2);
  await until(() => rdoc().evaluate(() => typeof window.__mxProxy), (t) => t === 'function', 15_000);
  const refused = await rdoc().evaluate(() => window.__mxProxy('https://esm.sh/'));
  check(refused === 403, `before consent the document's fetch door refuses the declared host (${refused})`);
  await rdoc().evaluate(() => { window.__mxBefore = true; });
  await bar.getByRole('button', { name: 'Allow once' }).click();
  const reloaded = await until(() => rdoc().evaluate(() => !window.__mxBefore && typeof window.__mxProxy === 'function'), (v) => v === true, 20_000);
  check(reloaded === true, 'Allow once loads the frame again');
  check(await bar.count() === 0, 'and the bar is gone');
  const accepted = await rdoc().evaluate(() => window.__mxProxy('https://esm.sh/'));
  check(accepted !== 403 && accepted !== 'failed', `after consent the fetch door accepts the declared host (${accepted}${accepted === 200 ? '' : ': the upstream itself was unreachable from here'})`);
  await rctx.close();

  // ── 6. afbin export photographs the mounted component ──
  const cli = path.join(ROOT, 'services/cli/dist/afbin.mjs');
  if (!existsSync(cli)) check(false, 'the CLI is built (services/cli/dist/afbin.mjs): run `npm run build -w services/cli`');
  else {
    const out = path.join(scratch, 'export.png');
    // The CLI talks to an https server or to http on localhost: the same server, addressed as localhost.
    const server = `http://localhost:${pages.port}`;
    const child = spawn(process.execPath, [cli, 'export', ID, '--format', 'png', '--output', 'export.png', '--server', server, '--json'], {
      cwd: scratch, env: { ...process.env, HOME: scratch, ARTIFACTBIN_TOKEN: owner.token, ARTIFACTBIN_URL: server, ARTIFACTBIN_SKILLS: 'off' },
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
  }
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
  pages.stop();
}
check.done();

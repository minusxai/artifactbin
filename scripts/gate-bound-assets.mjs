/**
 * Gate: an image URL that only exists in the READER'S BROWSER.
 *
 * Publish imports every URL it can see. `<img src="$pick">` names one it
 * cannot: the picture is chosen while somebody is reading. Five facts here are
 * about a real browser and a real server, and nothing below the browser can
 * see any of them:
 *
 *  1. The document's own endpoint imports the picked URL — ONCE. The count is
 *     read from the source host's own log, so "once" means once for everyone.
 *  2. Coming BACK to a URL costs nothing: the runtime remembers what the
 *     browser loaded, renders `/assets/<hash>` directly, and neither the
 *     endpoint nor the source host is asked again.
 *  3. Zero requests to the source host from the page. The stored markup keeps
 *     the URL, so a mapping that misses a position still paints — from the
 *     third party — and every unit test still passes.
 *  4. A refused URL (here, the cloud metadata address, which no dev switch
 *     admits) shows its alt text and carries `data-mx-asset="refused"`.
 *  5. A PRIVATE document's endpoint is a uniform 404 for a stranger — the
 *     bound that keeps this from being an open image proxy, exercised over
 *     real HTTP by somebody who is not signed in.
 *
 * The reader here is a STRANGER on purpose: a public document is served
 * top-level, so this is the real reading path and not the owner's shell.
 *
 *   usage: node scripts/gate-bound-assets.mjs [base]
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';
import { loginViaEmail, startMailSink } from './lib/mail-login.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

/* A 48×32 PNG — the same one gate-web-assets imports, so "it painted" is a
 * naturalWidth and not a guess. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8dMpruoH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1weeF8xbShDdKgAAAABJRU5ErkJggg==',
  'base64',
);

let hits = [];
const web = createServer((req, res) => {
  hits.push((req.url ?? '').split('?')[0]);
  if ((req.url ?? '').startsWith('/pic')) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
  res.writeHead(404); res.end();
});
// 5820–5829 is this agent's throwaway-server range.
await new Promise((resolve) => web.listen(5824, '127.0.0.1', resolve));
const WEB = 'http://127.0.0.1:5824';

/*
 * A per-run nonce on every URL. The cache is GLOBAL and keyed by the url, so a
 * second run against the same database would import nothing and "asked once"
 * would read zero — the feature working, scored as a failure.
 */
const RUN = Date.now();
const ONE = `${WEB}/pic1.png?run=${RUN}`;
const TWO = `${WEB}/pic2.png?run=${RUN}`;
/* The cloud metadata address: forbidden by lib/web-ingest's guard even under
 * the development switch that admits loopback, which is why it is the refusal
 * this gate picks rather than a merely dead URL. */
const BAD = 'http://169.254.169.254/latest/meta-data/x.png';

const owner = await startDocument(B);
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` };

const markup = `<Helmet><Value name="pick" type="string" default="${ONE}" /></Helmet>`
  + '<div data-design="tw" className="p-10">'
  + '<img src="$pick" alt="the pick" />'
  + '<select value="$pick" aria-label="pick">'
  + `<option value="${ONE}">one</option>`
  + `<option value="${TWO}">two</option>`
  + `<option value="${BAD}">bad</option>`
  + '</select>'
  + '</div>';

const put = await fetch(`${B}/api/artifacts/${owner.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ title: 'bound assets', markup }) });
const wrote = await put.json();
if (put.status !== 200) {
  console.error(`could not publish (${put.status} ${JSON.stringify(wrote)})`);
  process.exit(2);
}
ok((wrote.warnings ?? []).length === 0, `publish fetched nothing and warned about nothing (${JSON.stringify(wrote.warnings ?? [])})`);
ok(hits.length === 0, `the source host was not asked at publish — publish cannot see a bound URL (${hits.length} requests)`);

const stored = await (await fetch(`${B}/api/artifacts/${owner.id}`, { headers: auth })).json();
ok(stored.markup.includes('src="$pick"'), 'the stored markup keeps the binding the author wrote');

const browser = await chromium.launch();
// A STRANGER: no session, no adopted token. A public document is served
// top-level, so this is the reading path a shared link gives someone.
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const outbound = [];
const endpointCalls = [];
page.on('request', (r) => {
  if (r.url().startsWith(WEB)) outbound.push(r.url());
  if (r.url().includes(`/a/${owner.id}/assets`)) endpointCalls.push(r.url());
});
await page.goto(`${B}/a/${owner.id}`, { waitUntil: 'networkidle' });

/**
 * The `<img>` once it has SETTLED on the URL we are asking about — polled by
 * the address in its src, never by a timer: an `<img>` keeps the pixels of its
 * previous source until the new one decodes, so "has it painted" answered too
 * early is the old picture answering for the new one.
 */
const shot = (expect) => page.evaluate(async (want) => {
  const deadline = Date.now() + 8000;
  const read = () => {
    const img = document.querySelector('img[alt="the pick"]');
    return {
      src: img?.getAttribute('src') ?? null,
      mark: img?.getAttribute('data-mx-asset') ?? null,
      natural: img ? [img.naturalWidth, img.naturalHeight] : [-1, -1],
      complete: img ? img.complete : false,
    };
  };
  while (Date.now() < deadline) {
    const s = read();
    if (s.src !== null && s.src.includes(want) && s.complete && s.natural[0] > 0) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  return read();
}, expect);

const first = await shot(encodeURIComponent(ONE));
ok(first.src?.includes(`/a/${owner.id}/assets?u=`) === true, `the first sight of a URL goes through the document's endpoint (${first.src})`);
ok(first.natural[0] === 48 && first.natural[1] === 32, `it paints at the source's size (${first.natural.join('×')})`);
ok(hits.filter((h) => h === '/pic1.png').length === 1, `the source host was asked ONCE for the first picture (${JSON.stringify(hits)})`);

// ── pick the second, then come back to the first ────────────────────────────
await page.selectOption('select[aria-label="pick"]', TWO);
const second = await shot(encodeURIComponent(TWO));
ok(second.src?.includes(encodeURIComponent(TWO)) === true, `picking another URL imports that one (${second.src})`);
ok(second.natural[0] === 48, `it paints too (${second.natural.join('×')})`);
ok(hits.filter((h) => h === '/pic2.png').length === 1, `the source host was asked once for the second (${JSON.stringify(hits)})`);

const beforeReturn = { web: hits.length, endpoint: endpointCalls.length };
await page.selectOption('select[aria-label="pick"]', ONE);
const back = await shot('/assets/');
ok(/^\/assets\/[0-9a-f]{64}$/.test(back.src ?? ''), `coming back renders our copy directly (${back.src})`);
ok(back.natural[0] === 48, `and it still paints (${back.natural.join('×')})`);
ok(hits.length === beforeReturn.web, `the source host was not asked again (${hits.length - beforeReturn.web} new requests)`);
ok(endpointCalls.length === beforeReturn.endpoint, `nor was the endpoint (${endpointCalls.length - beforeReturn.endpoint} new calls)`);

// ── a refused URL ───────────────────────────────────────────────────────────
await page.selectOption('select[aria-label="pick"]', BAD);
const refused = await page.evaluate(async () => {
  const deadline = Date.now() + 8000;
  const read = () => {
    const img = document.querySelector('img[alt="the pick"]');
    return { src: img?.getAttribute('src') ?? null, mark: img?.getAttribute('data-mx-asset') ?? null, alt: img?.getAttribute('alt') ?? null };
  };
  while (Date.now() < deadline) {
    const s = read();
    if (s.mark === 'refused') return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  return read();
});
ok(refused.mark === 'refused', `a refused URL is marked (data-mx-asset=${refused.mark})`);
ok(refused.src === null, 'it carries no src, so the browser draws the alt text');
ok(refused.alt === 'the pick', 'the alt text is still the author\'s');

// THE HEADLINE: the page never reached the source host itself.
ok(outbound.length === 0, `zero requests from the page to the source host (${outbound.length})`);

// ── the ACL: a PRIVATE document's endpoint is a stranger's 404 ──────────────
const sink = await startMailSink();
const email = `mxmx_test_boundassets_${Date.now()}@example.com`;
const holder = await browser.newPage();
await loginViaEmail(holder, B, sink, email);
const mine = await holder.evaluate(async (u) => {
  const created = await fetch('/api/my/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markup: `<Helmet><Value name="pick" type="string" default="${u}" /></Helmet><div><img src="$pick" alt="a" /></div>`, title: 'private' }),
  });
  return { status: created.status, body: await created.json().catch(() => ({})) };
}, ONE);
if (mine.status !== 201) {
  ok(false, `could not create a private document as a signed-in user (${mine.status} ${JSON.stringify(mine.body)})`);
} else {
  const readBack = await holder.evaluate(async (id) => (await fetch(`/api/my/artifacts/${id}`)).json(), mine.body.id);
  ok(readBack.visibility === 'private', `a signed-in user's document is born private (${readBack.visibility})`);
  const asStranger = await fetch(`${B}/a/${mine.body.id}/assets?u=${encodeURIComponent(ONE)}`, { redirect: 'manual' });
  ok(asStranger.status === 404, `a stranger's call to a private document's asset endpoint is the uniform 404 (${asStranger.status})`);
  ok(hits.filter((h) => h === '/pic1.png').length === 1, 'and nothing was fetched on their behalf');

  /*
   * THE BOUNDARY, stated rather than implied. A served document is sandboxed
   * without allow-same-origin, so the `<img>` it loads carries no cookie — the
   * endpoint sees an anonymous caller from inside every document, its OWNER'S
   * framed copy included. On a private document that is the uniform 404, so a
   * bound source there shows its alt text and nothing else. This asserts what
   * actually happens (the refused placeholder, drawn for a failure that landed
   * before hydration) instead of pretending the case works.
   */
  await holder.goto(`${B}/a/${mine.body.id}`, { waitUntil: 'networkidle' });
  const own = await (await holder.waitForSelector('iframe[title="artifact"]', { timeout: 30_000 })).contentFrame();
  const owned = await own.evaluate(async () => {
    const deadline = Date.now() + 8000;
    const read = () => {
      const img = document.querySelector('img[alt="a"]');
      return { src: img?.getAttribute('src') ?? null, mark: img?.getAttribute('data-mx-asset') ?? null, natural: img ? img.naturalWidth : -1 };
    };
    while (Date.now() < deadline) {
      const s = read();
      if (s.mark || s.natural > 0) return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    return read();
  });
  ok(owned.mark === 'refused' && owned.src === null, `a private document's own owner sees the alt placeholder, because the frame presents no session (${JSON.stringify(owned)})`);
}

await browser.close();
web.close();

const failed = out.filter((l) => l.startsWith('FAIL'));
console.log(failed.length ? `\n${failed.length} failed` : '\nall ok');
process.exit(failed.length ? 1 : 0);

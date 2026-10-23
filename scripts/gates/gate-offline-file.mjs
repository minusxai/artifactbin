/** Native offline HTML and the retained screenshot-comment flow in three browser engines.
 * Offline files carry ordinary HTML/CSS/media plus the same core, private local state and explicit
 * offline backend outcomes. No JSX compiler, editor archive, or downloaded reconnect client travels.
 * The screenshot-comment checks below still exercise the hosted original chrome and persistence.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { firefox, webkit } from 'playwright';
import { expect } from 'playwright/test';
import sharp from 'sharp';
import { createChecker } from './lib/assert.mjs';
import { lane } from './lib/lane.mjs';
import { launchChromium, launchWebKit, PAGES_HOST } from './lib/browser.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { documentLocator } from './lib/page-facts.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeOwner } from '../lib/start-doc.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('offline-file');
const ENGINES = [['chromium', { launch: options => launchChromium(options) }], ['firefox', firefox], ['webkit', webkit]];
const work = path.join(os.tmpdir(), `native-html-offline-gate-${process.pid}`);
mkdirSync(work, { recursive: true });
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const token = (await connectAgent(BASE)).token;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function publish(body) {
  const response = await fetch(`${BASE}/api/artifacts`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (response.status !== 201) throw new Error(`publish -> ${response.status}: ${await response.text()}`);
  return (await response.json()).id;
}
const source = `<!doctype html><html><head><title>Portable native page</title>
<style>body{font-family:system-ui;background:#fff;color:#17202b}.status{color:rgb(20,90,40)}</style>
<link rel="af-backend" data-af-name="garden" href="./garden.ts">
<script type="application/json" data-af="state">{"count":3}</script>
<script src="/af/v1/core.js"></script></head><body>
<h1 class="status">Portable native page</h1><output id="count">Starting</output>
<button id="increment">Increment locally</button><button id="shared">Change shared job</button><output id="outcome"></output>
<svg viewBox="0 0 10 10" width="40" height="40"><circle cx="5" cy="5" r="4" fill="#145a28"></circle></svg>
<img alt="Portable pixel" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
<script type="module">
import {client,gql} from '@afbin/apollo';
const count=gql\`{count}\`;
client.watchQuery({query:count}).subscribe(({data})=>document.querySelector('#count').textContent=String(data.count));
document.querySelector('#increment').onclick=()=>client.updateQuery({query:count},({count})=>({count:count+1}));
document.querySelector('#shared').onclick=async()=>{const result=await client.mutate({mutation:gql\`mutation {garden{setDone(id:"mulch",done:true){id done}}}\`});document.querySelector('#outcome').textContent=result.extensions?.outcomes['garden.setDone']??'missing';};
</script></body></html>`;
const id = await publish({ html: source, visibility: 'private', backendSources: { garden: readFileSync(path.join(ROOT, 'services/app/skills/artifactbin/examples/garden.ts'), 'utf8') } });
const response = await fetch(`${BASE}/a/${id}/download`, { headers });
if (response.status !== 200) throw new Error(`download -> ${response.status}: ${await response.text()}`);
const html = await response.text();
check(!html.includes(token), 'download contains no account credential');
check(!html.includes('afbin-file') && !html.includes('afbin-compiled-code'), 'download is native HTML, without a legacy app archive');
const file = path.join(work, 'native.html'); writeFileSync(file, html);
async function reading(engineName, browser) {
  const { step, must, run } = lane(check, `${engineName} native offline HTML`);
  await run(async () => {
    const context = await browser.newContext();
    try {
      // Linux WebKit refuses file navigation while its network process is
      // offline. Block every HTTP request before loading the local file instead,
      // then make the entire context offline before exercising its behavior.
      // Requests are still observed below: an attempted external dependency fails.
      if (engineName === 'webkit') await context.route(/^https?:/, route => route.abort('internetdisconnected'));
      else await context.setOffline(true);
      const page = await context.newPage();
      const outside = [], errors = [];
      page.on('request', request => { if (/^https?:/.test(request.url())) outside.push(request.url()); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(file).href);
      if (engineName === 'webkit') await context.setOffline(true);
      await step('HTML, authored styles and portable media render without a server', async () => {
        await expect(page.getByRole('heading', { name: 'Portable native page' })).toBeVisible();
        await expect(page.locator('h1')).toHaveCSS('color', 'rgb(20, 90, 40)');
        await expect.poll(() => page.getByAltText('Portable pixel').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
        await expect(page.locator('svg circle')).toHaveAttribute('r', '4');
      });
      await step('private local state remains interactive while shared mutations are explicitly offline', async () => {
        await expect(page.locator('#count')).toHaveText('3');
        await page.getByRole('button', { name: 'Increment locally' }).click();
        await expect(page.locator('#count')).toHaveText('4');
        await page.getByRole('button', { name: 'Change shared job' }).click();
        await expect(page.locator('#outcome')).toHaveText('offline');
      });
      must(outside.length === 0, `no outside requests: ${JSON.stringify(outside)}`);
      must(errors.length === 0, `no page errors: ${JSON.stringify(errors)}`);
    } finally { await context.close(); }
  });
}

const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 220, g: 30, b: 30 } } }).png().toBuffer();

/** Real tab capture in Chromium; the upload fallback elsewhere; brush; persisted through a reload. */
async function screenshotComment(engineName, dpr, selectionWidth, selectionHeight) {
  const name = `${engineName} (DPR ${dpr}) screenshot comment`;
  // Chromium captures the tab (a Screenshot); Firefox and WebKit attach an uploaded file (an Image).
  const kind = engineName === 'chromium' ? 'Screenshot' : 'Image';
  const { step, must, run } = lane(check, name);
  let browser;
  await run(async () => {
    // Each case needs an unannotated pixel reference; prior comments paint overlays.
    const seed = { id: await publish({ html: '<!doctype html><html><head><title>Screenshot capture gate</title><style>#capturebox{width:400px;height:240px;background:rgb(220,30,30);margin:100px 40px}</style></head><body><div id="capturebox"><p>Screenshot capture fixture</p></div></body></html>', visibility: 'unlisted' }), token };
    const docHost = `${Buffer.from(seed.id, 'utf8').toString('hex')}.${PAGES_HOST}`;
    // The app is at app.lvh.me and the document on <hex id>.lvh.me (lib/browser.mjs): Chromium is told the mapping by
    // flag, Firefox by its resolver prefs, and WebKit connects through the gate's loopback proxy: none asks DNS.
    const local = [new URL(BASE).hostname, PAGES_HOST, docHost].join(',');
    // Both origins are plain http here, which is not a secure context off localhost: screen capture needs one (as it
    // has in production, over https), so Chromium is told to treat these two as secure.
    const secure = [new URL(BASE).origin, `http://${docHost}:${new URL(BASE).port}`].join(',');
    browser = engineName === 'chromium'
      ? await launchChromium({ channel: 'chromium', args: [`--unsafely-treat-insecure-origin-as-secure=${secure}`, '--enable-usermedia-screen-capturing', '--auto-select-tab-capture-source-by-title=Screenshot capture gate', '--allow-http-screen-capture', '--autoplay-policy=no-user-gesture-required'] })
      : engineName === 'firefox'
        ? await firefox.launch({ firefoxUserPrefs: { 'network.dns.localDomains': local, 'network.dns.forceResolve': '127.0.0.1' } })
        : await launchWebKit();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.addInitScript(() => { window.__captureTrace = []; const native = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices); if (native) navigator.mediaDevices.getDisplayMedia = async (...args) => { try { const stream = await native(...args); window.__captureTrace.push({ event: 'stream', surface: stream.getVideoTracks()[0]?.getSettings().displaySurface }); const reference = document.createElement('video'); reference.muted = true; reference.srcObject = stream; window.__captureReference = reference; void reference.play(); return stream; } catch (e) { window.__captureTrace.push({ event: 'error', message: e.message }); throw e; } }; });
    await becomeOwner(page, BASE, seed.token);
    await page.goto(`${BASE}/a/${seed.id}`);
    // The document is framed on its own origin; the rail, tools and composer are the app page's.
    const doc = documentLocator(page);
    await step('Select is the default comment tool', async () => {
      await doc.locator('#capturebox').waitFor();
      await openArtifactControls(page);
      await page.getByRole('button', { name: 'Toggle comments', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
    check(same(await page.evaluate(() => window.__captureTrace), []), `${name}: Select must not request screen sharing`);
    await step('the Screenshot tool is active', async () => {
      await page.getByRole('button', { name: 'Screenshot', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Screenshot tool active' })).toHaveText(/drag an area/, { timeout: 20000 });
    });
    const box = await doc.locator('#capturebox').boundingBox();
    must(box, 'the capture box has a box');
    let referencePixel = [220, 30, 30];
    if (engineName === 'chromium') {
      await step('the tab capture stream plays', () => expect.poll(() => page.evaluate(() => window.__captureReference?.readyState ?? 0)).toBeGreaterThanOrEqual(2));
      referencePixel = await page.evaluate(({ x, y }) => { const v = window.__captureReference, c = document.createElement('canvas'); c.width = innerWidth; c.height = innerHeight; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); return Array.from(c.getContext('2d').getImageData(x + 35, y + 65, 1, 1).data).slice(0, 3); }, box);
    }
    await page.mouse.move(box.x + 30, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 30 + selectionWidth, box.y + 60 + selectionHeight, { steps: 12 }); await page.mouse.up();
    const selectionFinished = Date.now();
    if (engineName !== 'chromium') {
      await step('without capture, Save waits for an uploaded screenshot', async () => {
        await expect(page.getByLabel('Save annotation', { exact: true })).toBeDisabled();
        await page.getByLabel('Upload screenshot', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: input });
      });
    }
    const editor = page.getByRole('dialog', { name: 'Annotation composer', exact: true });
    const canvas = editor.getByLabel('Screenshot drawing canvas');
    await step('the composer opens on the screenshot', async () => {
      try { await editor.waitFor({ timeout: 20000 }); } catch (error) { console.error(name, { alerts: await page.getByRole('alert').allTextContents(), status: await page.getByRole('status').allTextContents(), trace: await page.evaluate(() => window.__captureTrace), timings: await page.evaluate(() => performance.getEntriesByType('measure').filter(e => e.name.startsWith('comment-screenshot:')).map(e => e.toJSON())), composer: await page.getByRole('dialog', { name: 'Annotation composer' }).count() }); throw error; }
      await expect(canvas).toHaveAttribute('aria-busy', 'false');
      await editor.getByLabel('Annotation comment', { exact: true }).pressSequentially(`Screenshot from ${engineName} at DPR ${dpr}`);
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Use screenshot' })).toHaveCount(0);
    });
    if (engineName === 'chromium') check.note(`chromium (DPR ${dpr}): release-to-editor ${Date.now() - selectionFinished}ms; crop/encode ${await page.evaluate(() => performance.getEntriesByName('comment-screenshot:capture').at(-1)?.duration.toFixed(1))}ms`);
    // Exact crop corner must contain content, not a selection outline or app panel.
    const pixel = await canvas.evaluate(c => Array.from(c.getContext('2d').getImageData(5, 5, 1, 1).data));
    check(pixel.slice(0, 3).every((value, i) => Math.abs(value - referencePixel[i]) <= 3), `${name}: content pixel ${pixel}; unmarked reference ${referencePixel}`);
    await step('the brush paints a stroke', async () => {
      await editor.getByLabel('Custom brush color', { exact: true }).fill('#00ff00');
      await editor.getByLabel('Brush thickness').fill('8');
      const drawing = await canvas.boundingBox();
      if (!drawing) throw new Error('the drawing canvas has no box');
      await page.mouse.move(drawing.x + 30, drawing.y + 30); await page.mouse.down(); await page.mouse.move(drawing.x + 130, drawing.y + 50, { steps: 10 }); await page.mouse.up();
      await expect(editor.getByRole('button', { name: 'Undo stroke' })).toBeEnabled();
      // Strokes paint on requestAnimationFrame; wait for the pixels, not just the undo button.
      await expect.poll(() => canvas.evaluate(c => { const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 30 && pixels[i + 1] > 200 && pixels[i + 2] < 30) count++; return count; })).toBeGreaterThan(100);
      await expect(editor.getByLabel('Annotation comment', { exact: true })).toHaveText(`Screenshot from ${engineName} at DPR ${dpr}`);
    });
    await step('the comment saves and its screenshot persists through a reload', async () => {
      const writes = [];
      const started = Date.now();
      const recordWrite = response => {
        const request = response.request();
        const path = new URL(response.url()).pathname;
        if (request.method() !== 'POST' || !/\/(?:comment-images|annotations)$/.test(path)) return;
        const entry = { path, status: response.status(), elapsedMs: Date.now() - started };
        writes.push(entry);
        if (!response.ok()) void response.json().then(body => {
          entry.error = typeof body.error === 'string' ? body.error : body.error?.code;
        }).catch(() => {});
      };
      const sent = [];
      const recordSent = request => { const path = new URL(request.url()).pathname; if (request.method() === 'POST') sent.push({ path, sentMs: Date.now() - started }); };
      page.on('response', recordWrite);
      page.on('request', recordSent);
      try {
        await page.getByLabel('Save annotation', { exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Annotation composer' })).toHaveCount(0);
        // The save's budget is the 5s above. Times since the click: when the image upload left the page (after the
        // drawing's PNG encode, lib/capture/png), when each write answered, and when the composer closed.
        const at = ({ path, ...time }) => ({ [path.slice(path.lastIndexOf('/') + 1)]: time.sentMs ?? time.elapsedMs });
        check.note(`${name}: saved in ${Date.now() - started}ms; sent ${JSON.stringify(sent.filter(({ path }) => /\/(?:comment-images|annotations)$/.test(path)).map(at))}, answered ${JSON.stringify(writes.map(at))}`);
      } catch (error) {
        const state = async () => ({ elapsedMs: Date.now() - started, writes: [...writes], sent: [...sent],
          alerts: await page.getByRole('alert').allTextContents(), status: await page.getByRole('status').allTextContents(),
          saveDisabled: await page.getByLabel('Save annotation', { exact: true }).isDisabled().catch(() => null),
          composer: await page.getByRole('dialog', { name: 'Annotation composer' }).count() });
        console.error(name, { phase: 'save screenshot comment', ...await state() });
        const closed = await expect(page.getByRole('dialog', { name: 'Annotation composer' })).toHaveCount(0, { timeout: 30000 }).then(() => true, () => false);
        console.error(name, { phase: 'save screenshot comment, later', closed, ...await state() });
        throw error;
      } finally { page.off('response', recordWrite); page.off('request', recordSent); }
      await page.reload();
      await openArtifactControls(page); await page.getByRole('button', { name: 'Toggle comments', exact: true }).click();
      await expect(doc.locator('#capturebox')).toHaveCSS('background-color', 'rgb(220, 30, 30)');
      await page.getByRole('img', { name: `${kind} attached to comment` }).last().waitFor();
    });
    const thumbnail = page.getByRole('img', { name: `${kind} attached to comment` }).last();
    await step('persisted thumbnail', async () => {
      // Visibility precedes image decoding; wait for the persisted bytes, not only the img element.
      await expect.poll(() => thumbnail.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    });
    await step('the screenshot opens', async () => {
      await page.getByRole('button', { name: `Open comment ${kind.toLowerCase()}` }).last().click();
      await expect(page.getByRole('dialog', { name: `Comment ${kind.toLowerCase()}` })).toBeVisible();
    });
  });
  await browser?.close();
}


const SCREENSHOT_CASES = { chromium: [[1, 200, 100], [2.2, 235, 235]], firefox: [[1, 200, 100]], webkit: [[1, 200, 100]] };
await Promise.all(ENGINES.map(async ([name, engine]) => {
  const browser = await engine.launch();
  try { await reading(name, browser); } finally { await browser.close(); }
  for (const [dpr, width, height] of SCREENSHOT_CASES[name]) await screenshotComment(name, dpr, width, height);
}));
check.done();

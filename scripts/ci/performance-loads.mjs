/** CI-only production-build lab. No production credentials or traffic.
 * Usage: node scripts/ci/performance-loads.mjs <built-checkout> <output.json> [--size-only]
 *
 * RUN BY .github/workflows/page-speed.yml — a separate workflow, never a
 * required check and never a dependency of ci.yml, on pull requests that touch
 * the app (or the lab) and on pushes to main. Parallel jobs build the base
 * (the PR's base commit, or main's previous head) and head separately, then
 * run THIS head-side script against each build so both use the same probe.
 * PRs run one unthrottled size pass; manual runs retain full timing mode.
 *
 * HOW TO READ IT. The job summary holds the table (scripts/ci/performance-report.mjs);
 * the `page-speed` artifact holds base.json, head.json and combined.json with
 * every raw sample. No PR comment is ever posted.
 *   - Document views (scripts/lib/document-views.mjs defines every metric): the
 *     fixtures in scripts/fixtures/page-speed — prose, kit, dashboard
 *     (CSV + queries + charts), deck, Mermaid (plain, and in the industry
 *     theme) — each on the reader view and on
 *     /raw, as an anonymous reader with a cold cache under the throttling in
 *     `LAB_THROTTLE`, median of `documentRuns`. `Takeover` is when the app's
 *     rendered document replaces the server copy (view only); `Painted` is when the
 *     charts/diagram are drawn; bytes are response bodies, decoded and gzip.
 *   - App loads: the signed-in home and the anonymous prose reader, cold and
 *     warm cache, median `usefulMs` (first frame showing the content).
 *   Values are head medians with the change from base in brackets. One shared
 *   CI runner is noisy: treat single-digit-percent timing moves as noise and
 *   trust byte and request counts, which are deterministic.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { gzipSync, createGzip } from 'node:zlib';
import { createServer, request as httpRequest } from 'node:http';
import { chromium } from 'playwright';
import { startMailSink } from '../lib/mail-login.mjs';
import { becomeAccountOwner, publishAs } from '../lib/start-doc.mjs';
import { publishPageSpeedFixtures } from '../fixtures/page-speed/index.mjs';
import { documentMeasurementMode, measureDocumentViews, summarizeDocumentViews, waitForStoredDiagrams } from '../lib/document-views.mjs';

assert.equal(process.env.CI, 'true', 'Production builds and browser benchmarks run in CI only');
const sizeOnly = process.argv.includes('--size-only');
const mode = documentMeasurementMode(sizeOnly);
const root = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
const scratch = mkdtempSync(path.join(tmpdir(), 'artifactbin-performance-'));
const base = 'http://localhost:5480';
const outbox = path.join(scratch, 'mail.jsonl');
process.env.EMAIL__DEV_OUTBOX_PATH = outbox;
// A minimal gzip gateway models production compression consistently for both
// builds. HTTP/1.1, loopback storage and PGLite are explicit lab limitations.
const gateway = createServer((request, response) => {
  const upstream = httpRequest({ hostname: '127.0.0.1', port: 5481, path: request.url, method: request.method, headers: request.headers }, source => {
    const headers = { ...source.headers };
    const compress = /gzip/.test(request.headers['accept-encoding'] ?? '') && /javascript|json|text\//.test(headers['content-type'] ?? '') && !String(headers['content-type']).includes('event-stream') && !headers['content-encoding'] && source.statusCode !== 304 && request.method !== 'HEAD';
    if (compress) { delete headers['content-length']; headers['content-encoding'] = 'gzip'; headers.vary = [headers.vary, 'Accept-Encoding'].filter(Boolean).join(', '); }
    response.writeHead(source.statusCode, headers);
    if (compress) source.pipe(createGzip()).pipe(response); else source.pipe(response);
    response.on('close', () => source.destroy());
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  request.pipe(upstream);
});
await new Promise(resolve => gateway.listen(5480, '0.0.0.0', resolve));
const child = spawn(process.execPath, [path.join(root, 'dist/server.mjs')], {
  cwd: path.join(root, 'services/app'), stdio: ['ignore', 'ignore', 'inherit'],
  env: {
    PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production',
    AUTH__SECRET: randomBytes(32).toString('hex'), APP__PORT: '5481', APP__PUBLIC_BASE_URL: base,
    APP__ASSETS_ORIGIN: 'http://assets.localhost:5480', DATABASE_URL: 'pglite://memory',
    SQL__SERVICE_URL: '', BROWSER__SERVICE_URL: '', EVENTS__SERVICE_URL: '',
    EXPORT__INTERNAL_ORIGIN: base, OBJECT_STORE__LOCAL_DIR: path.join(scratch, 'objects'),
    ARTIFACTS__ALLOW_PUBLIC: '1', EMAIL__DEV_OUTBOX_PATH: outbox,
  },
});
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/login`)).ok) break; } catch {}
    assert(attempt < 120 && child.exitCode === null, 'server failed to boot');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Do not send fixture telemetry to any provider. CDP blocking preserves the
  // browser HTTP cache (Playwright route interception would disable it).
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  // Accounts sign in through the real email-code door and publish through the
  // session's own `/api/my/artifacts` (lib/start-doc) — the page's door. A CLI
  // connection's bearer cannot be claimed by an account, so it is not used.
  const email = 'mxmx_test_performance@example.com';
  await becomeAccountOwner(page, base, { sink: await startMailSink(), email });
  const result = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), conditions: { runtime: process.version, browser: browser.version(), gateway: 'HTTP/1.1 with gzip', database: 'in-process PGLite', mode: sizeOnly ? 'size-only' : 'timing' }, loads: [] };
  if (!sizeOnly) {
  const markup = '<h1 id="performance-heading">Performance fixture</h1>' + Array.from({ length: 35 }, (_, i) => `<p id="paragraph-${i}">Section ${i}: A repeatable document for measuring useful content and application loading.</p>`).join('');
  const doc = await publishAs(page, { title: 'Performance fixture', markup, visibility: 'public' });
  for (let i = 0; i < 39; i++) await publishAs(page, { title: `Workspace sample ${String(i).padStart(2, '0')}`, markup, visibility: 'public' });
  // A second synthetic account owns shared documents. This exercises metadata
  // trimming with real generated metadata, not arbitrary inflated JSON.
  const ownerContext = await browser.newContext();
  const other = await ownerContext.newPage();
  await becomeAccountOwner(other, base, { sink: await startMailSink(), email: 'mxmx_test_performance_sharer@example.com' });
  for (let i = 0; i < 20; i++) {
    const shared = await publishAs(other, { title: `Shared sample ${i}`, markup, visibility: 'private' });
    assert.equal(await other.evaluate(async ({ id, email }) => (await fetch(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shares: [{ email, role: 'viewer' }] }) })).status, { id: shared.id, email }), 200);
  }
  await ownerContext.close();
  // Equalize server state before comparing browser cache modes. Otherwise the
  // faster candidate reaches the warm-cache phase while its freshly seeded
  // thumbnail renders still consume the app/browser worker; the slower baseline
  // has had longer to finish them. Cold here means cold BROWSER cache.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Open Workspace sample 38', { exact: true }).waitFor();
  const previews = await page.evaluate(() => [...new Set([...document.images].map(image => image.src).filter(src => src.includes('/export?')))]);
  assert(previews.length > 0, 'library preview fixtures were not discovered');
  console.log(`Preparing ${previews.length} thumbnail cache entries before timed loads`);
  for (const url of previews) {
    const response = await page.request.get(url, { timeout: 120000 });
    assert.equal(response.status(), 200, 'thumbnail preparation failed');
    assert.match(response.headers()['content-type'] ?? '', /^image\//);
    await response.body(); await response.dispose();
  }
  console.log('Thumbnail preparation complete');
  Object.assign(result, {
    conditions: { runtime: process.version, browser: browser.version(), gateway: 'HTTP/1.1 with gzip', database: 'in-process PGLite', store: 'local disk; thumbnail cache prewarmed', viewport: '1440x1000', latencyMs: 80, downloadMbps: 10, uploadMbps: 5, cpuSlowdown: 4, repetitions: 7, owned: 40, shared: 20, paragraphs: 35, analytics: 'real bundle; outbound telemetry blocked' },
    previewsPrepared: previews.length, core: {}, loads: [],
  });
  const core = await page.evaluate(async () => { const response = await fetch('/api/page/home?part=core'); return response.text(); });
  const parsed = JSON.parse(core);
  assert.equal(parsed.artifacts.length, 40); assert.equal(parsed.shared.length, 20);
  result.core = { decodedBytes: Buffer.byteLength(core), gzipBytes: gzipSync(core).length };
  const assetPath = await page.evaluate(() => new URL(document.querySelector('script[type="module"][src]').src).pathname);
  const cookie = (await context.cookies(base)).map(c => c.name + '=' + c.value).join('; ');
  result.staticAsset = { path: assetPath, samplesMs: [] };
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    const response = await fetch(base + assetPath, { headers: { cookie } });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    result.staticAsset.samplesMs.push(performance.now() - start);
  }
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 10e6 / 8, uploadThroughput: 5e6 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // Use a browser-side observer: runner round trips are not part of useful DOM
  // timing. Two animation frames represent a paint opportunity after the commit.
  await page.addInitScript(() => {
    window.__performanceUseful = null;
    const observer = new MutationObserver(() => {
      const home = location.pathname === '/' && [...document.querySelectorAll('a')].some(a => a.textContent?.includes('Workspace sample'));
      const prose = location.pathname !== '/' && [...document.querySelectorAll('h1')].some(h => h.textContent === 'Performance fixture');
      if (!home && !prose) return;
      observer.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(() => { window.__performanceUseful = performance.now(); }));
    });
    observer.observe(document, { subtree: true, childList: true });
  });
  const sessionCookies = await context.cookies(base);
  for (const route of ['home', 'reader']) {
    if (route === 'reader') await context.clearCookies();
    for (const cache of ['cold', 'warm']) {
      for (let repetition = 0; repetition < 7; repetition++) {
        if (cache === 'cold') await cdp.send('Network.clearBrowserCache');
        await page.goto(route === 'home' ? base : `${base}/a/${doc.id}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__performanceUseful !== null, { timeout: 30000 });
        await page.waitForTimeout(1500);
        result.loads.push(await page.evaluate(({ route, cache, repetition }) => {
          const usefulMs = window.__performanceUseful;
          const resources = performance.getEntriesByType('resource');
          const nav = performance.getEntriesByType('navigation')[0];
          const core = resources.find(r => r.name.includes('/api/page/home?part=core'));
          const session = resources.find(r => r.name.includes('/api/page/session'));
          const scripts = resources.filter(r => /\.js(?:\?|$)/.test(r.name));
          return { route, cache, repetition, visible: document.visibilityState, usefulMs, ttfbMs: nav.responseStart, navRequestMs: nav.requestStart, navFetchMs: nav.fetchStart, navResponseEndMs: nav.responseEnd, navTransferredBytes: nav.transferSize,
            coreRequestCount: resources.filter(r => r.name.includes('/api/page/home?part=core')).length,
            coreStartMs: core?.startTime, coreEndMs: core?.responseEnd, sessionStartMs: session?.startTime,
            jsEncodedBytes: scripts.reduce((n, r) => n + r.encodedBodySize, 0),
            jsTransferredBytes: scripts.reduce((n, r) => n + r.transferSize, 0),
            jsBeforeUsefulBytes: scripts.filter(r => r.startTime < usefulMs).reduce((n, r) => n + r.encodedBodySize, 0),
            scripts: scripts.map(r => ({ file: new URL(r.name).pathname, startMs: r.startTime, endMs: r.responseEnd, encodedBytes: r.encodedBodySize, transferredBytes: r.transferSize })),
          };
        }, { route, cache, repetition }));
        assert.equal(result.loads.at(-1).visible, 'visible');
      }
    }
  }
  await context.addCookies(sessionCookies);
  }
  // DOCUMENT VIEWS (scripts/lib/document-views.mjs): cold, throttled, anonymous
  // reader; every fixture on the reader view and on /raw, interleaved per run.
  // Published only now, so the home listing above keeps exactly its 40 owned documents.
  // The session page is back on the app origin with its cookies before it publishes.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const documentFixtures = await publishPageSpeedFixtures(body => publishAs(page, body));
  // The steady state a reader meets: a build that prerenders diagrams has stored them by now (bounded; a no-op wait otherwise).
  const storedDiagrams = sizeOnly ? [] : await waitForStoredDiagrams(base, documentFixtures);
  console.log(`Stored diagram drawings before timing: ${storedDiagrams.join(', ') || 'none'}`);
  const samples = await measureDocumentViews({ browser, base, fixtures: documentFixtures, ...mode, log: line => console.log(line) });
  if (sizeOnly) assert(samples.every(sample => sample.ready && sample.jsBeforeReady !== null), 'size pass needs a ready marker and JS byte count for every view');
  result.documents = { conditions: { ...(mode.throttle ?? {}), mode: sizeOnly ? 'size-only' : 'timing', runs: mode.runs, cache: 'cold', viewer: 'anonymous', viewport: '1440x1000', storedDiagrams }, fixtures: documentFixtures.map(({ key, id, template }) => ({ key, id, template })), summary: summarizeDocumentViews(samples), samples };
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(`Measured ${samples.length} document views and ${result.loads.length} app loads for ${result.revision}; output ${output}`);
} finally {
  console.log('Stopping benchmark app');
  child.kill('SIGTERM');
  const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
  await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', resolve); });
  clearTimeout(kill);
  console.log('Closing benchmark browser');
  await browser?.close();
  console.log('Closing benchmark gateway');
  gateway.closeAllConnections();
  await new Promise(resolve => gateway.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}

// All samples are saved and child resources closed; imported SDK timers must
// not keep this disposable CI CLI alive.
process.exit(0);

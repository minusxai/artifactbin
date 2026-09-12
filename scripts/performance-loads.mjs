/** CI-only paired production-build lab. No production credentials or traffic.
 * Usage: node scripts/performance-loads.mjs <built-checkout> <output.json>
 * The calling workflow builds both refs on one runner and preserves raw samples.
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
import { connectAgent } from './lib/cli-connection.mjs';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';

assert.equal(process.env.CI, 'true', 'Production builds and browser benchmarks run in CI only');
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
const child = spawn(process.execPath, [path.join(root, 'dist/proxy-server.mjs')], {
  cwd: path.join(root, 'services/app'), stdio: ['ignore', 'ignore', 'inherit'],
  env: {
    PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production',
    AUTH__SECRET: randomBytes(32).toString('hex'), APP__PORT: '5481', APP__PUBLIC_BASE_URL: base,
    APP__ASSETS_ORIGIN: 'http://assets.localhost:5480', DATABASE_URL: 'pglite://memory',
    SQL__SERVICE_URL: '', BROWSER__SERVICE_URL: '', EVENTS__SERVICE_URL: '',
    EXPORT__INTERNAL_ORIGIN: base, OBJECT_STORE__LOCAL_DIR: path.join(scratch, 'objects'),
    ARTIFACTS__ALLOW_PUBLIC: '1', EMAIL__DEV_OUTBOX_PATH: outbox,
    PROXY__RATE_LIMIT_CONFIG_FILE: path.join(root, 'services/proxy/dev_rate_limits.yml'),
    MIXPANEL__TOKEN: 'fixture-only-not-a-real-token', MIXPANEL__HOST: 'https://analytics.invalid',
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
  await cdp.send('Network.setBlockedURLs', { urls: ['*analytics.invalid*', '*mixpanel.com*'] });
  const email = 'mxmx_test_performance@example.com';
  await loginViaEmail(page, base, await startMailSink(), email);
  const { token } = await connectAgent(base);
  assert.equal(await page.evaluate(async token => (await fetch('/api/tokens/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })).status, token), 200);
  const api = async (endpoint, body) => {
    const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    assert(response.ok, `fixture ${endpoint}: ${response.status}`);
    return response.json();
  };
  const markup = '<h1 id="performance-heading">Performance fixture</h1>' + Array.from({ length: 35 }, (_, i) => `<p id="paragraph-${i}">Section ${i}: A repeatable document for measuring useful content and application loading.</p>`).join('');
  const doc = await api('/api/artifacts', { title: 'Performance fixture', markup, visibility: 'public' });
  for (let i = 0; i < 39; i++) await api(`/api/artifacts/${doc.id}/fork`, { title: `Workspace sample ${String(i).padStart(2, '0')}`, visibility: 'public' });
  // A second synthetic account owns shared documents. This exercises metadata
  // trimming with real generated metadata, not arbitrary inflated JSON.
  const ownerContext = await browser.newContext();
  const other = await ownerContext.newPage();
  await loginViaEmail(other, base, await startMailSink(), 'mxmx_test_performance_sharer@example.com');
  const sharedToken = (await connectAgent(base)).token;
  assert.equal(await other.evaluate(async token => (await fetch('/api/tokens/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })).status, sharedToken), 200);
  for (let i = 0; i < 20; i++) {
    const made = await fetch(`${base}/api/artifacts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sharedToken}` }, body: JSON.stringify({ title: `Shared sample ${i}`, markup, visibility: 'private' }) });
    assert(made.ok, `shared fixture: ${made.status}`);
    const shared = await made.json();
    assert.equal(await other.evaluate(async ({ id, email }) => (await fetch(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shares: [{ email, role: 'viewer' }] }) })).status, { id: shared.id, email }), 200);
  }
  await ownerContext.close();
  const result = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    conditions: { runtime: process.version, browser: browser.version(), gateway: 'HTTP/1.1 with gzip', database: 'in-process PGLite', store: 'local disk', viewport: '1440x1000', latencyMs: 80, downloadMbps: 10, uploadMbps: 5, cpuSlowdown: 4, repetitions: 7, owned: 40, shared: 20, paragraphs: 35, analytics: 'real bundle; outbound telemetry blocked' },
    core: {}, loads: [],
  };
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
          return { route, cache, repetition, visible: document.visibilityState, usefulMs, ttfbMs: nav.responseStart,
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
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(`Measured ${result.loads.length} loads for ${result.revision}; output ${output}`);
} finally {
  await browser?.close();
  gateway.closeAllConnections();
  await new Promise(resolve => gateway.close(resolve));
  child.kill('SIGTERM');
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  rmSync(scratch, { recursive: true, force: true });
}

/**
 * DOCUMENT VIEWS for the page-speed lab (scripts/ci/performance-loads.mjs).
 *
 * One sample = one fresh tab in a cookie-less context, a cold browser cache,
 * the lab's network/CPU throttling, and one navigation to either the reader
 * view (`view`: where `/a/<id>` lands — a build that redirects it is resolved
 * once, outside timing, to the canonical `/@owner/<id>-slug`; a build that
 * serves it in place is measured at `/a/<id>` itself) or the sandboxed
 * document (`raw`, `/a/<id>/raw`). Every marker is read from the DOM, so the
 * same head-side script measures a base build that knows nothing about it.
 *
 * Metrics (milliseconds are from navigation start; bytes are response BODIES):
 *   html/js/css/other {decoded, gzip} — per CDP resource type (Document,
 *                   Script, Stylesheet, everything else): decoded body bytes and
 *                   body bytes on the wire (the lab's gateway gzips text, so
 *                   `gzip` is the compressed size; response headers excluded)
 *   requests      — every non-`data:` request the tab made
 *   fcp, lcp      — first-contentful-paint; the last largest-contentful-paint
 *                   entry at collection time
 *   takeover      — view only: the first DOM state where the server's
 *                   `[data-mx-initial-story]` copy is gone AND
 *                   `body > #root [data-mx-inline-story]` holds rendered
 *                   content, plus two animation frames (a paint opportunity).
 *                   This is when the app's rendered document replaces the server copy.
 *                   Null on raw, which hydrates the server DOM in place.
 *   painted       — fixtures with charts/diagrams: the first state where the
 *                   expected count of `[data-mx-chart-state=ready]` (none still
 *                   pending) or `[data-mx-mermaid-state=ready]` is on screen
 *                   (after takeover on view), plus two animation frames
 *   scriptMs      — main-thread script execution (CDP ScriptDuration) for the tab
 */

/** Installed before any page script; records paint entries and DOM milestones. */
function documentViewProbe() {
  const state = (window.__documentView = { fcp: null, lcp: null, takeover: null, painted: null, ready: null, want: null, view: false });
  /*
   * READY — when the page is interactive (docs/phase2-architecture.md §11): on the
   * reader view, the takeover (stamped below); on the raw document, the runtime's
   * `mx:ready` after hydration (the former runtime and the compiled islands both fired
   * it), or DOMContentLoaded on a page that loads no module script at all (a compiled
   * prose page: nothing to hydrate). `jsBeforeReady` counts the script bytes that
   * finished before this moment.
   */
  const ready = () => { if (state.ready === null) state.ready = performance.now(); };
  document.addEventListener('mx:ready', ready);
  // The idle SPA and standalone behavior scripts are modules too. A page with
  // no island data has no hydration boot to signal ready; modules have loaded
  // by DOMContentLoaded, so this is the static page's byte boundary.
  document.addEventListener('DOMContentLoaded', () => { if (!document.getElementById('mx-story-data')) ready(); });
  try {
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.name === 'first-contentful-paint') state.fcp = entry.startTime; }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) state.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* unsupported entry types leave the metric null */ }
  let takeoverSeen = false, paintedSeen = false;
  const stamp = key => requestAnimationFrame(() => requestAnimationFrame(() => { state[key] = performance.now(); }));
  const check = () => {
    // Set by a per-tab init script (measureDocumentView), which runs before any page script.
    if (!state.configured && window.__documentViewConfig) { Object.assign(state, window.__documentViewConfig, { configured: true }); }
    if (document.documentElement.hasAttribute('data-mx-ready')) ready();
    if (state.view && !takeoverSeen) {
      const owned = document.querySelector('body > #root [data-mx-inline-story] > :not(style)');
      if (owned && !document.querySelector('[data-mx-initial-story]')) { takeoverSeen = true; stamp('takeover'); requestAnimationFrame(() => requestAnimationFrame(ready)); }
    }
    const want = state.want;
    if (want && !paintedSeen && (!state.view || takeoverSeen)) {
      const charts = document.querySelectorAll('[data-mx-chart-state="ready"]').length;
      const pending = document.querySelectorAll('[data-mx-chart-state="pending"]').length;
      const diagrams = document.querySelectorAll('[data-mx-mermaid-state="ready"]').length;
      if ((!want.charts || (charts >= want.charts && pending === 0)) && (!want.diagrams || diagrams >= want.diagrams)) { paintedSeen = true; stamp('painted'); }
    }
  };
  state.check = check;
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-mx-chart-state', 'data-mx-mermaid-state', 'data-mx-ready'] });
}

/** The lab's throttling (scripts/ci/performance-loads.mjs `conditions`). */
const LAB_THROTTLE = { latencyMs: 80, downloadMbps: 10, uploadMbps: 5, cpuSlowdown: 4 };

/** Size samples per cell: the summary takes their median, so one late-landing chunk cannot move a target. */
const SIZE_RUNS = 3;
/** Size mode reads the byte totals only after the network has been quiet this long (bounded by SIZE_SETTLE_MAX_MS). */
const SIZE_QUIET_MS = 500;
const SIZE_SETTLE_MAX_MS = 8000;

/**
 * Resolve once `busy()` has been false for `quietMs` straight, or `maxMs` has passed.
 * Clock and sleep are injected so the settle is testable without a browser.
 */
export async function waitForQuiet({ busy, quietMs = SIZE_QUIET_MS, maxMs = SIZE_SETTLE_MAX_MS, pollMs = 50, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const start = now();
  let quietSince = null;
  for (;;) {
    const t = now();
    if (busy()) quietSince = null; else quietSince ??= t;
    if (quietSince !== null && t - quietSince >= quietMs) return true;
    if (t - start >= maxMs) return false;
    await sleep(pollMs);
  }
}

/** The size lab keeps the same network byte accounting with unthrottled views, settled before reading. */
export const documentMeasurementMode = sizeOnly => sizeOnly
  ? { runs: SIZE_RUNS, throttle: null, sizeOnly: true }
  : { runs: 5, throttle: LAB_THROTTLE, sizeOnly: false };

const kindOf = ({ type }) => type === 'Document' ? 'html' : type === 'Script' ? 'js' : type === 'Stylesheet' ? 'css' : 'other';

/** One cold view of `url` in a fresh tab of `context`; size mode skips throttling and timing waits. */
async function measureDocumentView(context, url, { route, painted, throttle = LAB_THROTTLE, sizeOnly = false, timeoutMs = 60_000 }) {
  const page = await context.newPage();
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('Performance.enable');
    if (throttle) {
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: throttle.latencyMs, downloadThroughput: throttle.downloadMbps * 1e6 / 8, uploadThroughput: throttle.uploadMbps * 1e6 / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle.cpuSlowdown });
    }
    // Sizes come from the network, not Resource Timing: the raw document is an
    // opaque-origin sandbox, where every resource reports zero body bytes.
    const requests = new Map();
    const inflight = new Set();
    cdp.on('Network.requestWillBeSent', event => { if (!event.request.url.startsWith('data:') && !requests.has(event.requestId)) requests.set(event.requestId, { url: event.request.url, type: event.type, headers: 0, gzip: 0, decoded: 0 }); if (!['EventSource', 'WebSocket', 'Ping'].includes(event.type)) inflight.add(event.requestId); });
    cdp.on('Network.responseReceived', event => { const r = requests.get(event.requestId); if (r) { r.type = event.type; r.headers = event.response.encodedDataLength ?? 0; } });
    cdp.on('Network.dataReceived', event => { const r = requests.get(event.requestId); if (r) r.decoded += event.dataLength; });
    cdp.on('Network.loadingFinished', event => { const r = requests.get(event.requestId); if (r) r.gzip = Math.max(0, event.encodedDataLength - r.headers); inflight.delete(event.requestId); });
    cdp.on('Network.loadingFailed', event => { inflight.delete(event.requestId); });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error).slice(0, 200)));
    await page.addInitScript(({ view, want }) => { window.__documentViewConfig = { view, want }; }, { view: route === 'view', want: painted });
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await page.evaluate(() => window.__documentView.check());
    const ready = await page.waitForFunction((sizeOnly) => {
      const s = window.__documentView;
      return sizeOnly ? s.ready !== null : (!s.view || s.takeover !== null) && (!s.want || s.painted !== null);
    }, sizeOnly, { timeout: timeoutMs }).then(() => true, () => false);
    // Late resources (chart chunks, fonts) and the LCP candidate settle.
    if (!sizeOnly) await page.waitForTimeout(1000);
    // Size mode has no fixed settle: the bytes are read once no request is in flight for SIZE_QUIET_MS.
    else await waitForQuiet({ busy: () => inflight.size > 0 });
    const measured = await page.evaluate(() => {
      const s = window.__documentView;
      // Resource timing names every script and when it finished, even at the opaque origin (where its sizes read zero).
      const scriptsBeforeReady = s.ready === null ? null
        : performance.getEntriesByType('resource').filter(e => e.initiatorType === 'script' || /\.m?js(\?|$)/.test(e.name)).filter(e => e.responseEnd <= s.ready).map(e => e.name);
      return { fcp: s.fcp, lcp: s.lcp, takeover: s.takeover, painted: s.painted, readyAt: s.ready, scriptsBeforeReady };
    });
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const bytes = { html: { decoded: 0, gzip: 0 }, js: { decoded: 0, gzip: 0 }, css: { decoded: 0, gzip: 0 }, other: { decoded: 0, gzip: 0 } };
    for (const request of requests.values()) {
      const kind = bytes[kindOf(request)];
      kind.decoded += request.decoded; kind.gzip += request.gzip;
    }
    // JS BEFORE READY: the wire bytes (CDP, per URL) of the scripts the page had finished loading when it became ready.
    const before = new Set(measured.scriptsBeforeReady ?? []);
    const jsBeforeReady = measured.scriptsBeforeReady === null ? null : { decoded: 0, gzip: 0 };
    const scriptsBeforeReady = [];
    if (jsBeforeReady) for (const request of requests.values()) if (kindOf(request) === 'js' && before.has(request.url)) {
      jsBeforeReady.decoded += request.decoded;
      jsBeforeReady.gzip += request.gzip;
      scriptsBeforeReady.push({ url: new URL(request.url).pathname, gzip: request.gzip });
    }
    return {
      route, ready, errors,
      fcp: measured.fcp, lcp: measured.lcp,
      takeover: route === 'view' ? measured.takeover : null,
      painted: painted ? measured.painted : null,
      readyAt: measured.readyAt,
      requests: requests.size,
      scripts: [...requests.values()].filter(request => kindOf(request) === 'js').map(request => ({ url: new URL(request.url).pathname, gzip: request.gzip })),
      bytes,
      jsBeforeReady,
      scriptsBeforeReady,
      scriptMs: Math.round((metrics.ScriptDuration ?? 0) * 1000),
    };
  } finally {
    await page.close();
  }
}

/**
 * A build that prerenders Mermaid (lib/mermaid-images) draws a published
 * diagram to stored SVG in the background; the lab measures the steady state a
 * reader meets, so it waits — bounded — until each diagram fixture's served
 * document carries its stored drawings. A build that does not (the base, before
 * that change) never does, and the wait simply runs out. Answers the fixture
 * keys that were seen stored.
 */
export async function waitForStoredDiagrams(base, fixtures, { timeoutMs = 60_000, pollMs = 1000, fetchImpl = fetch } = {}) {
  const pending = new Map(fixtures.filter(f => f.painted?.diagrams).map(f => [f.key, f.id]));
  const seen = [];
  for (const end = Date.now() + timeoutMs; pending.size && Date.now() < end;) {
    for (const [key, id] of [...pending]) {
      const html = await (await fetchImpl(`${base}/a/${id}/raw`)).text();
      if (html.includes('"mermaidImages"')) { pending.delete(key); seen.push(key); }
    }
    if (pending.size) await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  return seen;
}

/** Resolve `/a/<id>` to the address a reader lands on: a redirect's target (one hop, untimed), else `/a/<id>`. */
async function canonicalView(base, id, fetchImpl = fetch) {
  const response = await fetchImpl(`${base}/a/${id}`, { redirect: 'manual' });
  const location = response.headers.get('location');
  return location ? new URL(location, base).href : `${base}/a/${id}`;
}

/**
 * `runs` cold views of every fixture on both routes, interleaved per repetition
 * so drift in the runner affects every cell alike.
 */
export async function measureDocumentViews({ browser, base, fixtures, runs, throttle = LAB_THROTTLE, sizeOnly = false, log = () => {} }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(documentViewProbe);
  const views = [];
  for (const fixture of fixtures) views.push({ fixture, view: await canonicalView(base, fixture.id), raw: `${base}/a/${fixture.id}/raw` });
  const samples = [];
  try {
    for (let repetition = 0; repetition < runs; repetition++) {
      for (const { fixture, view, raw } of views) {
        for (const route of ['view', 'raw']) {
          const sample = await measureDocumentView(context, route === 'view' ? view : raw, { route, painted: sizeOnly ? null : fixture.painted, throttle, sizeOnly, timeoutMs: sizeOnly ? 15_000 : 60_000 });
          samples.push({ fixture: fixture.key, repetition, ...sample });
          log(`${fixture.key} ${route} #${repetition}: fcp ${Math.round(sample.fcp ?? -1)} takeover ${Math.round(sample.takeover ?? -1)} painted ${Math.round(sample.painted ?? -1)}${sample.ready ? '' : ' (TIMED OUT)'}`);
        }
      }
    }
  } finally {
    await context.close();
  }
  return samples;
}

/** Median of the non-null values, or null. */
export function median(values) {
  const sorted = values.filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const METRICS = {
  requests: s => s.requests,
  htmlDecoded: s => s.bytes.html.decoded, htmlGzip: s => s.bytes.html.gzip,
  jsDecoded: s => s.bytes.js.decoded, jsGzip: s => s.bytes.js.gzip,
  cssDecoded: s => s.bytes.css.decoded, cssGzip: s => s.bytes.css.gzip,
  /** Every response body on the wire (the size targets' "total transferred"). */
  totalGzip: s => Object.values(s.bytes).reduce((n, kind) => n + kind.gzip, 0),
  /** Script bytes on the wire that had finished before the page was ready (the size targets' "JS before ready"); null on a build that never signalled ready. */
  jsBeforeReadyGzip: s => s.jsBeforeReady?.gzip ?? null,
  fcp: s => s.fcp, lcp: s => s.lcp, takeover: s => s.takeover, painted: s => s.painted, readyAt: s => s.readyAt ?? null, scriptMs: s => s.scriptMs,
};

/** `{ [fixture]: { [route]: { runs, timedOut, <metric>: median } } }` */
export function summarizeDocumentViews(samples) {
  const cells = {};
  for (const sample of samples) ((cells[sample.fixture] ??= {})[sample.route] ??= []).push(sample);
  const summary = {};
  for (const [fixture, routes] of Object.entries(cells)) {
    for (const [route, list] of Object.entries(routes)) {
      const cell = { runs: list.length, timedOut: list.filter(s => !s.ready).length };
      for (const [metric, read] of Object.entries(METRICS)) cell[metric] = median(list.map(read));
      (summary[fixture] ??= {})[route] = cell;
    }
  }
  return summary;
}

const ms = value => value === null || value === undefined ? '–' : `${Math.round(value)}`;
const kb = value => value === null || value === undefined ? '–' : `${(value / 1024).toFixed(1)}`;
const delta = (head, base, format) => {
  if (head === null || head === undefined) return '–';
  if (base === null || base === undefined) return format(head);
  const change = head - base;
  const sign = change > 0 ? '+' : change < 0 ? '−' : '±';
  return `${format(head)} (${sign}${format(Math.abs(change))})`;
};

/** A Markdown table of head medians with the change from base, for the job summary. */
export function documentViewsMarkdown(head, base = {}) {
  const columns = [
    ['requests', 'Requests', String], ['htmlGzip', 'HTML gz KB', kb], ['jsDecoded', 'JS KB', kb], ['jsGzip', 'JS gz KB', kb],
    ['jsBeforeReadyGzip', 'JS before ready gz KB', kb], ['totalGzip', 'Total gz KB', kb],
    ['cssGzip', 'CSS gz KB', kb], ['fcp', 'FCP ms', ms], ['lcp', 'LCP ms', ms], ['takeover', 'Takeover ms', ms],
    ['painted', 'Painted ms', ms], ['scriptMs', 'Script ms', ms],
  ];
  const lines = [
    `| Fixture | Route | ${columns.map(([, label]) => label).join(' | ')} |`,
    `| --- | --- | ${columns.map(() => '---:').join(' | ')} |`,
  ];
  for (const [fixture, routes] of Object.entries(head)) {
    for (const [route, cell] of Object.entries(routes)) {
      const before = base[fixture]?.[route] ?? {};
      const values = columns.map(([metric, , format]) => delta(cell[metric], before[metric], format));
      lines.push(`| ${fixture}${cell.timedOut ? ` (${cell.timedOut} timed out)` : ''} | ${route} | ${values.join(' | ')} |`);
    }
  }
  return lines.join('\n');
}

/**
 * DOCUMENT VIEWS for the page-speed lab (scripts/performance-loads.mjs).
 *
 * One sample = one fresh tab in a cookie-less context, a cold browser cache,
 * the lab's network/CPU throttling, and one navigation to either the reader
 * view (`view`, the canonical `/@owner/<id>-slug` address `/a/<id>` redirects
 * to; the redirect hop is resolved once, outside timing) or the sandboxed
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
 *                   This is when the React runtime owns the visible document.
 *                   Null on raw, which hydrates the server DOM in place.
 *   painted       — fixtures with charts/diagrams: the first state where the
 *                   expected count of `[data-mx-chart-state=ready]` (none still
 *                   pending) or `[data-mx-mermaid-state=ready]` is on screen
 *                   (after takeover on view), plus two animation frames
 *   scriptMs      — main-thread script execution (CDP ScriptDuration) for the tab
 */

/** Installed before any page script; records paint entries and DOM milestones. */
export function documentViewProbe() {
  const state = (window.__documentView = { fcp: null, lcp: null, takeover: null, painted: null, want: null, view: false });
  try {
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.name === 'first-contentful-paint') state.fcp = entry.startTime; }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) state.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* unsupported entry types leave the metric null */ }
  let takeoverSeen = false, paintedSeen = false;
  const stamp = key => requestAnimationFrame(() => requestAnimationFrame(() => { state[key] = performance.now(); }));
  const check = () => {
    // Set by a per-tab init script (measureDocumentView), which runs before any page script.
    if (!state.configured && window.__documentViewConfig) { Object.assign(state, window.__documentViewConfig, { configured: true }); }
    if (state.view && !takeoverSeen) {
      const owned = document.querySelector('body > #root [data-mx-inline-story] > :not(style)');
      if (owned && !document.querySelector('[data-mx-initial-story]')) { takeoverSeen = true; stamp('takeover'); }
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
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-mx-chart-state', 'data-mx-mermaid-state'] });
}

/** The lab's throttling (scripts/performance-loads.mjs `conditions`). */
export const LAB_THROTTLE = { latencyMs: 80, downloadMbps: 10, uploadMbps: 5, cpuSlowdown: 4 };

const kindOf = ({ type }) => type === 'Document' ? 'html' : type === 'Script' ? 'js' : type === 'Stylesheet' ? 'css' : 'other';

/** One cold, throttled view of `url` in a fresh tab of `context`. */
export async function measureDocumentView(context, url, { route, painted, throttle = LAB_THROTTLE, timeoutMs = 60_000 }) {
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
    cdp.on('Network.requestWillBeSent', event => { if (!event.request.url.startsWith('data:') && !requests.has(event.requestId)) requests.set(event.requestId, { url: event.request.url, type: event.type, headers: 0, gzip: 0, decoded: 0 }); });
    cdp.on('Network.responseReceived', event => { const r = requests.get(event.requestId); if (r) { r.type = event.type; r.headers = event.response.encodedDataLength ?? 0; } });
    cdp.on('Network.dataReceived', event => { const r = requests.get(event.requestId); if (r) r.decoded += event.dataLength; });
    cdp.on('Network.loadingFinished', event => { const r = requests.get(event.requestId); if (r) r.gzip = Math.max(0, event.encodedDataLength - r.headers); });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error).slice(0, 200)));
    await page.addInitScript(({ view, want }) => { window.__documentViewConfig = { view, want }; }, { view: route === 'view', want: painted });
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await page.evaluate(() => window.__documentView.check());
    const ready = await page.waitForFunction(() => {
      const s = window.__documentView;
      return (!s.view || s.takeover !== null) && (!s.want || s.painted !== null);
    }, null, { timeout: timeoutMs }).then(() => true, () => false);
    // Late resources (chart chunks, fonts) and the LCP candidate settle.
    await page.waitForTimeout(1000);
    const measured = await page.evaluate(() => {
      const s = window.__documentView;
      return { fcp: s.fcp, lcp: s.lcp, takeover: s.takeover, painted: s.painted };
    });
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const bytes = { html: { decoded: 0, gzip: 0 }, js: { decoded: 0, gzip: 0 }, css: { decoded: 0, gzip: 0 }, other: { decoded: 0, gzip: 0 } };
    for (const request of requests.values()) {
      const kind = bytes[kindOf(request)];
      kind.decoded += request.decoded; kind.gzip += request.gzip;
    }
    return {
      route, ready, errors,
      fcp: measured.fcp, lcp: measured.lcp,
      takeover: route === 'view' ? measured.takeover : null,
      painted: painted ? measured.painted : null,
      requests: requests.size,
      bytes,
      scriptMs: Math.round((metrics.ScriptDuration ?? 0) * 1000),
    };
  } finally {
    await page.close();
  }
}

/** Resolve `/a/<id>` to the canonical address a reader lands on (one hop, untimed). */
export async function canonicalView(base, id, fetchImpl = fetch) {
  const response = await fetchImpl(`${base}/a/${id}`, { redirect: 'manual' });
  const location = response.headers.get('location');
  return location ? new URL(location, base).href : `${base}/a/${id}`;
}

/**
 * `runs` cold views of every fixture on both routes, interleaved per repetition
 * so drift in the runner affects every cell alike.
 */
export async function measureDocumentViews({ browser, base, fixtures, runs, throttle = LAB_THROTTLE, log = () => {} }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(documentViewProbe);
  const views = [];
  for (const fixture of fixtures) views.push({ fixture, view: await canonicalView(base, fixture.id), raw: `${base}/a/${fixture.id}/raw` });
  const samples = [];
  try {
    for (let repetition = 0; repetition < runs; repetition++) {
      for (const { fixture, view, raw } of views) {
        for (const route of ['view', 'raw']) {
          const sample = await measureDocumentView(context, route === 'view' ? view : raw, { route, painted: fixture.painted, throttle });
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
  fcp: s => s.fcp, lcp: s => s.lcp, takeover: s => s.takeover, painted: s => s.painted, scriptMs: s => s.scriptMs,
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

/**
 * Eval report — merge N run directories into one comparison table. Ported from
 * minusx `scripts/qa-report.ts`; the semantics are unchanged:
 *
 *   rows keyed by (flow, metric); a metric a run never recorded renders null;
 *   duplicates within one run: numbers SUM, pass ANDs, text last-wins, images
 *   are keyed by variant; the HTML is self-contained (images inlined as base64)
 *   so it survives as a CI artifact or a Slack upload.
 *
 * N=1 is a plain single-run report; N=2+ is a side-by-side comparison. The
 * renderer knows nothing about WHY there are N columns — here a column is a
 * LEG (harness × model). What this port adds is a summary band per column:
 * pass rate over every flow, total cost, mean turns. No delta math: columns sit
 * side by side and a human compares.
 *
 * Dependency-free (node builtins only) so the CLI runs under bare `tsx`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { MetricRow, RunMeta } from './contracts';
import { DEFAULT_IMAGE_VARIANT, IMAGE_RENDERERS, IMAGE_SIZES, allVariants, variantKey, variantLabel } from './image-variants';
import { bestColumns, directionOf } from './direction';

export interface RunData {
  meta: RunMeta;
  rows: MetricRow[];
}

/** An image metric's captures for one run, keyed by `variantKey`. */
export type ImageSet = Record<string, string>;

export interface MergedMetric {
  metric: string;
  kind: MetricRow['kind'];
  /** One entry per column; null when that run never recorded the metric. */
  values: Array<MetricRow['value'] | ImageSet | null>;
}

export interface MergedReport {
  columns: RunMeta[];
  flows: Array<{ flow: string; metrics: MergedMetric[] }>;
}

function reduceValues(rows: MetricRow[]): MetricRow['value'] | ImageSet {
  if (rows[0].kind === 'number') return rows.reduce((sum, r) => sum + Number(r.value), 0);
  if (rows[0].kind === 'pass') return rows.every((r) => r.value === true);
  if (rows[0].kind === 'image') {
    const set: ImageSet = {};
    for (const row of rows) set[variantKey(row.variant ?? DEFAULT_IMAGE_VARIANT)] = String(row.value);
    return set;
  }
  return rows[rows.length - 1].value;
}

export function mergeRuns(runs: RunData[]): MergedReport {
  const flowOrder: string[] = [];
  const metricOrder = new Map<string, string[]>();
  const kinds = new Map<string, MetricRow['kind']>();
  for (const run of runs) {
    for (const row of run.rows) {
      if (!flowOrder.includes(row.flow)) {
        flowOrder.push(row.flow);
        metricOrder.set(row.flow, []);
      }
      const metrics = metricOrder.get(row.flow)!;
      if (!metrics.includes(row.metric)) metrics.push(row.metric);
      kinds.set(`${row.flow} ${row.metric}`, row.kind);
    }
  }
  return {
    columns: runs.map((r) => r.meta),
    flows: flowOrder.map((flow) => ({
      flow,
      metrics: metricOrder.get(flow)!.map((metric) => ({
        metric,
        kind: kinds.get(`${flow} ${metric}`)!,
        values: runs.map((run) => {
          const rows = run.rows.filter((r) => r.flow === flow && r.metric === metric);
          return rows.length ? reduceValues(rows) : null;
        }),
      })),
    })),
  };
}

export interface ColumnSummary {
  label: string;
  /** Flows whose `pass` row is true / flows that have a pass row. */
  passed: number;
  total: number;
  /** Sum of every flow's `cost_usd`; null when no flow recorded one. */
  costUsd: number | null;
  /** Mean of every flow's `turns`; null when none recorded. */
  meanTurns: number | null;
}

export function summarize(report: MergedReport): ColumnSummary[] {
  return report.columns.map((col, i) => {
    let passed = 0, total = 0, cost: number | null = null;
    const turns: number[] = [];
    for (const flow of report.flows) {
      for (const m of flow.metrics) {
        const v = m.values[i];
        if (v === null || v === undefined) continue;
        if (m.metric === 'pass' && m.kind === 'pass') { total += 1; if (v === true) passed += 1; }
        if (m.metric === 'cost_usd' && m.kind === 'number') cost = (cost ?? 0) + Number(v);
        if (m.metric === 'turns' && m.kind === 'number') turns.push(Number(v));
      }
    }
    return {
      label: col.label,
      passed,
      total,
      costUsd: cost === null ? null : Math.round(cost * 1e6) / 1e6,
      meanTurns: turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length : null,
    };
  });
}

/**
 * The dollars-and-verdict table, for a terminal and for a CI job summary — so
 * what a run cost is readable without downloading an artifact.
 *
 * Cost is the harness's own figure where it reports one, else our tokens × the
 * leg's rates (`lib/price.ts taskCost`; the `cost_source` row says which). A leg
 * with neither shows `unknown`, never 0 — a blank must not read as "free".
 */
export function renderSummaryMarkdown(report: MergedReport): string {
  const rows = summarize(report);
  const known = rows.filter((r) => r.costUsd !== null);
  const total = known.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const lines = [
    '| leg | passed | cost (USD) | mean turns |',
    '| --- | --- | ---: | ---: |',
    ...rows.map((r) => `| ${r.label} | ${r.passed}/${r.total} | ${r.costUsd === null ? 'unknown' : r.costUsd.toFixed(4)} | ${r.meanTurns === null ? '—' : (Math.round(r.meanTurns * 10) / 10)} |`),
    // A total of 0.0000 when NOTHING was measured reads as "free"; say unknown instead.
    `| **Total** | ${rows.reduce((n, r) => n + r.passed, 0)}/${rows.reduce((n, r) => n + r.total, 0)} | ${known.length ? total.toFixed(4) : 'unknown'} | |`,
  ];
  if (known.length !== rows.length) {
    lines.push('', `_${rows.length - known.length} of ${rows.length} legs reported no token usage; the total covers the rest._`);
  }
  lines.push('', '_Cost is the figure each harness reports for itself where it does, else its tokens × the rates the run was given (Codex, which also pays a per-call web-search fee); it excludes GitHub Actions minutes. Check the provider console for billed spend._');
  return lines.join('\n');
}

export interface RenderOptions {
  /** Resolve an image row's relative path for column `col` to bytes, or null if unavailable. */
  resolveImage: (col: number, relPath: string) => Buffer | null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A text value that is ENTIRELY a URL becomes a link — the report's whole point
 * is to be clicked through to the artifacts, and copying a URL out of a table
 * cell is friction for no reason.
 *
 * Only `http`/`https`, and only when the value is nothing but the URL. These
 * cells hold AGENT output: a `javascript:` or `data:` value must render as inert
 * text, and a URL containing markup must be escaped, not emitted raw.
 */
function textCell(value: string): string {
  const trimmed = value.trim();
  let url: URL | null = null;
  try {
    url = new URL(trimmed);
  } catch {
    url = null;
  }
  const safe = url !== null && (url.protocol === 'http:' || url.protocol === 'https:') && !/\s/.test(trimmed);
  return safe
    ? `<a href="${esc(trimmed)}" target="_blank" rel="noopener">${esc(trimmed)}</a>`
    : esc(value);
}

function num(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function cell(metric: MergedMetric, col: number, opts: RenderOptions, best: number[] = []): string {
  const value = metric.values[col];
  if (value === null || value === undefined) return '<td class="na">—</td>';
  if (metric.kind === 'pass') return value === true ? '<td class="pass">PASS</td>' : '<td class="fail">FAIL</td>';
  if (metric.kind === 'number') return `<td class="num${best.includes(col) ? ' best' : ''}">${num(Number(value))}</td>`;
  if (metric.kind === 'image') {
    const set: ImageSet = typeof value === 'string' ? { [variantKey(DEFAULT_IMAGE_VARIANT)]: value } : (value as ImageSet);
    const imgs = allVariants()
      .map((variant) => {
        const rel = set[variantKey(variant)];
        if (!rel) return '';
        const bytes = opts.resolveImage(col, rel);
        if (!bytes) return '';
        return `<img class="shot" hidden data-variant="${variantKey(variant)}" data-label="${esc(variantLabel(variant))}"`
          + ` alt="${esc(`${metric.metric} — ${variantLabel(variant)}`)}"`
          + ` src="data:image/png;base64,${bytes.toString('base64')}"/>`;
      })
      .join('');
    if (!imgs) return '<td class="na">—</td>';
    return `<td class="img" data-shots>${imgs}<div class="fallback"></div></td>`;
  }
  return `<td class="text"><div>${textCell(String(value))}</div></td>`;
}

function toggleGroup(name: string, label: string, options: ReadonlyArray<readonly [string, string]>, selected: string): string {
  const inputs = options
    .map(([value, text]) => `<label class="opt"><input type="radio" name="${name}" value="${value}"${value === selected ? ' checked' : ''}/><span>${esc(text)}</span></label>`)
    .join('');
  return `<fieldset aria-label="${esc(label)}"><legend>${esc(label)}</legend>${inputs}</fieldset>`;
}

/**
 * Every artifact the run produced, in one strip — so the visual comparison can be
 * made without opening a section, which is the thing a reader actually wants to do
 * first. Each tile keeps its flow and leg, and opens the same lightbox as a row image.
 */
function gallery(report: MergedReport, opts: RenderOptions): string {
  const tiles: string[] = [];
  for (const flow of report.flows) {
    for (const m of flow.metrics) {
      if (m.kind !== 'image') continue;
      m.values.forEach((value, col) => {
        if (value === null || value === undefined) return;
        const set: ImageSet = typeof value === 'string' ? { [variantKey(DEFAULT_IMAGE_VARIANT)]: value } : (value as ImageSet);
        const imgs = allVariants()
          .map((variant) => {
            const rel = set[variantKey(variant)];
            if (!rel) return '';
            const bytes = opts.resolveImage(col, rel);
            if (!bytes) return '';
            return `<img class="shot" hidden data-variant="${variantKey(variant)}" data-label="${esc(variantLabel(variant))}" alt="${esc(`${flow.flow} — ${report.columns[col].label}`)}" src="data:image/png;base64,${bytes.toString('base64')}"/>`;
          })
          .join('');
        if (!imgs) return;
        tiles.push(`<figure class="tile" data-shots>${imgs}<div class="fallback"></div><figcaption>${esc(flow.flow)} · <b>${esc(report.columns[col].label)}</b></figcaption></figure>`);
      });
    }
  }
  return tiles.length ? `<section class="gallery" aria-label="All artifacts"><h2>All artifacts</h2><div class="tiles">${tiles.join('')}</div></section>` : '';
}

export function renderHtml(report: MergedReport, opts: RenderOptions): string {
  const cols = report.columns;
  const colHead = (c: RunMeta) => {
    const target = /^https?:\/\//.test(c.target) ? `<a href="${esc(c.target)}" target="_blank" rel="noopener">${esc(c.target)}</a>` : esc(c.target);
    const sub = [c.harness, c.model].filter(Boolean).map((s) => esc(String(s))).join(' · ');
    return `<th>${esc(c.label)}${sub ? `<div class="sub">${sub}</div>` : ''}<div class="target">${target}</div></th>`;
  };
  const head = `<tr><th>Metric</th>${cols.map(colHead).join('')}</tr>`;

  const summary = summarize(report);
  // The summary is what a reader lands on, so it carries the same "which column did better" marking
  // as the detail rows — computed the same way, from the same direction table.
  const summaryRow = (label: string, values: Array<number | null>, render: (v: number) => string) => {
    const best = bestColumns(values, directionOf(label));
    const cells = values
      .map((v, i) => (v === null ? '<td class="na">—</td>' : `<td class="num${best.includes(i) ? ' best' : ''}">${render(v)}</td>`))
      .join('');
    return `<tr><td class="metric">${esc(label)} <span class="dir">↓</span></td>${cells}</tr>`;
  };
  const summaryRows = [
    `<tr><td class="metric">pass rate</td>${summary.map((s) => `<td class="${s.total && s.passed === s.total ? 'pass' : s.passed === 0 && s.total ? 'fail' : 'num'}">${s.passed}/${s.total}</td>`).join('')}</tr>`,
    summaryRow('cost_usd', summary.map((s) => s.costUsd), num),
    summaryRow('turns', summary.map((s) => (s.meanTurns === null ? null : Math.round(s.meanTurns * 10) / 10)), num),
  ].join('\n');

  const body = report.flows
    .map((f, fi) => {
      // Collapsed by default: the summary is what a reader lands on, and a flow is opened when it is
      // the one being asked about. Plain rows toggled by class — `<details>` cannot wrap table rows.
      const header = `<tr class="flow" data-flow-toggle="${fi}" data-collapsed="true" tabindex="0" aria-label="${esc(f.flow)} section"><td colspan="${cols.length + 1}"><span class="caret">▸</span> ${esc(f.flow)}</td></tr>`;
      const rows = f.metrics
        .map((m) => {
          const direction = directionOf(m.metric);
          const best = bestColumns(m.values.map((v) => (typeof v === 'number' ? v : null)), direction);
          const arrow = direction ? ` <span class="dir">${direction === 'lower' ? '↓' : '↑'}</span>` : '';
          return `<tr class="metric-row" data-flow="${fi}" hidden><td class="metric">${esc(m.metric)}${arrow}</td>${cols.map((_, i) => cell(m, i, opts, best)).join('')}</tr>`;
        })
        .join('\n');
      return `${header}\n${rows}`;
    })
    .join('\n');

  const settings = `<div class="settings">
  <button type="button" class="gear" aria-label="Open report settings">⚙ Settings</button>
  <span class="current" aria-label="Current image settings"></span>
</div>
<div class="modal" hidden aria-label="Report settings">
  <div class="sheet">
    <h2>Settings</h2>
    <h3>Image</h3>
    ${toggleGroup('size', 'Image size', IMAGE_SIZES.map((s) => [s, s === 'laptop' ? 'Laptop' : 'Mobile'] as const), DEFAULT_IMAGE_VARIANT.size)}
    ${toggleGroup('renderer', 'Image renderer', IMAGE_RENDERERS.map((r) => [r, r === 'playwright' ? 'Playwright image' : 'App export'] as const), DEFAULT_IMAGE_VARIANT.renderer)}
    <button type="button" class="close" aria-label="Close report settings">Done</button>
  </div>
</div>
<div class="lightbox" hidden aria-label="Image preview">
  <div class="bar">
    <button type="button" class="newtab" aria-label="Open image in new tab">Open in new tab</button>
    <a class="dl" download="eval-image.png" aria-label="Download image">Download</a>
    <button type="button" class="x" aria-label="Close image preview">✕</button>
  </div>
  <img alt="Full size image" aria-label="Full size image"/>
</div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Agent eval report</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; background: #fafafa; color: #1a1a1a; }
  table { border-collapse: collapse; width: 100%; max-width: 1400px; background: #fff; margin-bottom: 1.5rem; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
  th .sub { font-weight: normal; font-size: 0.8em; color: #555; }
  th .target { font-weight: normal; font-size: 0.75em; color: #888; }
  /* On a TD, max-width is undefined in auto table layout and browsers grow the column anyway;
     a block child honours it, which is what keeps a paragraph-long brief from stretching its column. */
  td.text > div { max-width: 26rem; }
  tr.flow td { background: #f0f0f0; font-weight: bold; cursor: pointer; user-select: none; }
  tr.flow:hover td { background: #e8e8e8; }
  tr.flow .caret { display: inline-block; width: 1em; transition: transform 0.12s; }
  tr.flow[data-collapsed="false"] .caret { transform: rotate(90deg); }
  td.num.best { font-weight: bold; color: #0a7d33; }
  td.metric .dir { color: #aaa; font-weight: normal; }
  .gallery { max-width: 1400px; margin: 0 0 1.5rem; }
  .gallery h2 { font-size: 0.9rem; margin: 0 0 0.5rem; color: #555; }
  .gallery .tiles { display: flex; flex-wrap: wrap; gap: 0.75rem; }
  .gallery .tile { margin: 0; background: #fff; border: 1px solid #ddd; padding: 0.4rem; }
  .gallery figcaption { font-size: 0.7em; color: #666; margin-top: 0.3rem; max-width: 220px; }
  .gallery img { width: 220px; height: auto; max-height: 280px; object-fit: cover; object-position: top; display: block; cursor: zoom-in; }
  td.metric { color: #555; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.pass { color: #0a7d33; font-weight: bold; }
  td.fail { color: #c22; font-weight: bold; }
  td.na { color: #aaa; text-align: center; }
  [hidden] { display: none !important; }
  td.img img { width: 260px; height: auto; max-height: 340px; object-fit: cover; object-position: top; display: block; border: 1px solid #eee; cursor: zoom-in; }
  td.img .fallback:not(:empty) { margin-top: 0.35rem; font-size: 0.7em; color: #a06000; }
  .settings { display: flex; align-items: center; gap: 0.75rem; margin: 0 0 1rem; }
  .gear, .close, .newtab, .x { font: inherit; font-size: 0.85em; padding: 0.35rem 0.7rem; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; }
  .settings .current { font-size: 0.75em; color: #888; }
  .modal, .lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 10; }
  .modal[hidden], .lightbox[hidden] { display: none; }
  .sheet { background: #fff; padding: 1.25rem 1.5rem; border-radius: 6px; min-width: 320px; }
  .sheet h2 { margin: 0 0 0.25rem; font-size: 1rem; }
  .sheet h3 { margin: 1rem 0 0.5rem; font-size: 0.8rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
  fieldset { border: 1px solid #eee; border-radius: 4px; margin: 0 0 0.75rem; padding: 0.5rem 0.75rem; }
  legend { font-size: 0.75em; color: #888; padding: 0 0.25rem; }
  .opt { display: inline-flex; align-items: center; gap: 0.35rem; margin-right: 1rem; font-size: 0.85em; cursor: pointer; }
  .lightbox { flex-direction: column; align-items: center; gap: 0.75rem; padding: 1rem; overflow: auto; }
  .lightbox .bar { display: flex; gap: 0.5rem; align-items: center; position: sticky; top: 0; z-index: 1; }
  .lightbox .dl { font-size: 0.85em; padding: 0.35rem 0.7rem; border: 1px solid #ccc; border-radius: 4px; background: #fff; color: #1a1a1a; text-decoration: none; }
  .lightbox img { max-width: min(100%, 1100px); height: auto; background: #fff; }
</style></head>
<body><h1>Agent eval report</h1>
${settings}
<table aria-label="Summary"><thead>${head}</thead><tbody>
${summaryRows}
</tbody></table>
${gallery(report, opts)}
<table aria-label="Metrics"><thead>${head}</thead><tbody>
${body}
</tbody></table>
<script>
(function () {
  var KEY = 'eval-report-image-variant';
  var DEFAULTS = ${JSON.stringify(DEFAULT_IMAGE_VARIANT)};
  var state = DEFAULTS;
  try { state = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* no storage */ }
  var modal = document.querySelector('.modal');
  var lightbox = document.querySelector('.lightbox');
  var lightboxImg = lightbox.querySelector('img');
  function apply() {
    var want = state.size + ':' + state.renderer;
    // Both table cells and gallery tiles carry data-shots; a td-only selector leaves every
    // gallery image hidden and the strip renders as captions with nothing above them.
    document.querySelectorAll('[data-shots]').forEach(function (td) {
      var imgs = Array.prototype.slice.call(td.querySelectorAll('img.shot'));
      var shown = imgs.filter(function (i) { return i.dataset.variant === want; })[0] || imgs[0];
      imgs.forEach(function (i) { i.hidden = i !== shown; });
      td.querySelector('.fallback').textContent = shown && shown.dataset.variant !== want ? 'not captured — showing ' + shown.dataset.label : '';
    });
    document.querySelectorAll('input[name="size"]').forEach(function (i) { i.checked = i.value === state.size; });
    document.querySelectorAll('input[name="renderer"]').forEach(function (i) { i.checked = i.value === state.renderer; });
    var label = document.querySelector('.settings .current');
    if (label) label.textContent = state.size + ' · ' + state.renderer;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* nothing to persist to */ }
  }
  document.querySelector('.gear').addEventListener('click', function () { modal.hidden = false; });
  document.querySelector('.modal .close').addEventListener('click', function () { modal.hidden = true; });
  modal.addEventListener('click', function (e) { if (e.target === modal) modal.hidden = true; });
  modal.addEventListener('change', function (e) { if (e.target.name === 'size' || e.target.name === 'renderer') { state[e.target.name] = e.target.value; apply(); } });
  document.addEventListener('click', function (e) {
    if (e.target.classList && e.target.classList.contains('shot')) {
      lightboxImg.src = e.target.src; lightbox.querySelector('.dl').href = e.target.src; lightbox.hidden = false; lightbox.scrollTop = 0;
    }
  });
  lightbox.querySelector('.x').addEventListener('click', function () { lightbox.hidden = true; });
  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) lightbox.hidden = true; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { lightbox.hidden = true; modal.hidden = true; } });
  lightbox.querySelector('.newtab').addEventListener('click', function () {
    fetch(lightboxImg.src).then(function (r) { return r.blob(); }).then(function (b) { window.open(URL.createObjectURL(b), '_blank'); });
  });
  // Flow sections start collapsed; the summary and the gallery are what a reader lands on.
  document.querySelectorAll('tr.flow[data-flow-toggle]').forEach(function (band) {
    var toggle = function () {
      var open = band.dataset.collapsed === 'false';
      band.dataset.collapsed = open ? 'true' : 'false';
      document.querySelectorAll('tr.metric-row[data-flow="' + band.dataset.flowToggle + '"]').forEach(function (row) { row.hidden = open; });
    };
    band.addEventListener('click', toggle);
    band.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });

  apply();
})();
</script>
</body></html>
`;
}

/** Read one run directory (meta.json + rows/*.json) into RunData. */
export function collectRun(dir: string, labelOverride?: string): RunData {
  const metaPath = path.join(dir, 'meta.json');
  const meta: RunMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : { label: path.basename(dir), target: 'unknown' };
  if (labelOverride) meta.label = labelOverride;
  const rowsDir = path.join(dir, 'rows');
  const rows: MetricRow[] = [];
  if (fs.existsSync(rowsDir)) {
    for (const f of fs.readdirSync(rowsDir).sort()) {
      if (!f.endsWith('.json')) continue;
      rows.push(...(JSON.parse(fs.readFileSync(path.join(rowsDir, f), 'utf8')).rows ?? []));
    }
  }
  return { meta, rows };
}

/** Merge run dirs and write report.json + report.html into `out`. Returns the html path. */
/**
 * The report's file stem: `report-<UTC stamp to the minute>`, from the earliest
 * leg's start. Named by when its runs happened, not when it was rendered, so a
 * re-render of the same runs gets the same name and two downloads never
 * overwrite each other as `report.html` did. A run recorded before `startedAt`
 * existed falls back to the render time.
 */
export function reportStem(columns: RunMeta[], fallback: Date): string {
  const starts = columns.map((c) => c.startedAt).filter((s): s is string => typeof s === 'string').sort();
  const at = starts.length ? new Date(starts[0]) : fallback;
  const iso = at.toISOString();   // 2026-08-28T02:49:26.000Z
  return `report-${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 16).replace(':', '')}Z`;
}

export function writeReport(runs: Array<{ dir: string; label?: string }>, out: string): string {
  const data = runs.map((r) => collectRun(r.dir, r.label));
  const merged = mergeRuns(data);
  const stem = reportStem(merged.columns, new Date());
  const html = renderHtml(merged, {
    resolveImage: (col, rel) => {
      const p = path.join(runs[col].dir, rel);
      return fs.existsSync(p) ? fs.readFileSync(p) : null;
    },
  });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${stem}.json`), JSON.stringify(merged, null, 2));
  const htmlPath = path.join(out, `${stem}.html`);
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

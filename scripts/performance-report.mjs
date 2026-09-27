/**
 * The page-speed lab's report: head against base, as Markdown for the job
 * summary and as one combined JSON artifact. Never posted as a PR comment.
 *
 *   usage: node scripts/performance-report.mjs <base.json> <head.json> [combined.json]
 *
 * Inputs are what scripts/performance-loads.mjs writes for each build.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { documentViewsMarkdown, median } from './lib/document-views.mjs';

/** Median useful-content time and JS bytes of the app-shell loads, per route and cache mode. */
export function loadsSummary(result) {
  const cells = {};
  for (const load of result.loads ?? []) ((cells[`${load.route} ${load.cache}`] ??= [])).push(load);
  return Object.fromEntries(Object.entries(cells).map(([cell, loads]) => [cell, {
    runs: loads.length,
    usefulMs: median(loads.map(l => l.usefulMs)),
    ttfbMs: median(loads.map(l => l.ttfbMs)),
    jsTransferredBytes: median(loads.map(l => l.jsTransferredBytes)),
  }]));
}

const change = (head, base, unit) => {
  if (head === null || head === undefined) return '–';
  const value = unit === 'KB' ? `${(head / 1024).toFixed(1)}` : `${Math.round(head)}`;
  if (base === null || base === undefined) return value;
  const delta = head - base;
  const size = unit === 'KB' ? (Math.abs(delta) / 1024).toFixed(1) : Math.round(Math.abs(delta));
  return `${value} (${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${size})`;
};

export function reportMarkdown(base, head) {
  const lines = ['## Page speed lab', ''];
  lines.push(`Base \`${base.revision?.slice(0, 12)}\` → head \`${head.revision?.slice(0, 12)}\`, one runner, production builds behind a gzip gateway. Values are head medians; brackets are the change from base (negative is faster/smaller).`, '');
  if (head.documents) {
    const c = head.documents.conditions;
    lines.push(`### Document views`, '', `Anonymous reader, cold cache, ${c.latencyMs} ms latency, ${c.downloadMbps} Mbps down, ${c.cpuSlowdown}× CPU slowdown, median of ${c.runs}. \`view\` is the reader page (\`/a/<id>\`), \`raw\` is \`/a/<id>/raw\`. Takeover: the React runtime owns the visible document. Painted: charts/diagram drawn. KB are response bodies.`, '');
    lines.push(documentViewsMarkdown(head.documents.summary, base.documents?.summary ?? {}), '');
  }
  const headLoads = loadsSummary(head), baseLoads = loadsSummary(base);
  lines.push('### App loads', '', `Signed-in home and anonymous prose reader, ${head.conditions?.repetitions ?? '?'} runs each. Useful: the first frame with the content.`, '');
  lines.push('| Route | Cache | Useful ms | TTFB ms | JS transferred KB |', '| --- | --- | ---: | ---: | ---: |');
  for (const [cell, now] of Object.entries(headLoads)) {
    const before = baseLoads[cell] ?? {};
    const [route, cache] = cell.split(' ');
    lines.push(`| ${route} | ${cache} | ${change(now.usefulMs, before.usefulMs)} | ${change(now.ttfbMs, before.ttfbMs)} | ${change(now.jsTransferredBytes, before.jsTransferredBytes, 'KB')} |`);
  }
  return lines.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [basePath, headPath, combinedPath] = process.argv.slice(2);
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  const head = JSON.parse(readFileSync(headPath, 'utf8'));
  process.stdout.write(reportMarkdown(base, head));
  if (combinedPath) writeFileSync(combinedPath, JSON.stringify({ base, head, summary: { documents: { base: base.documents?.summary ?? null, head: head.documents?.summary ?? null }, loads: { base: loadsSummary(base), head: loadsSummary(head) } } }, null, 2));
}

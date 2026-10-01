#!/usr/bin/env node
/**
 * THE PHASE 2 SIZE TARGETS (docs/phase2-architecture.md), checked against a
 * page-speed lab result (scripts/ci/performance-loads.mjs output).
 *
 *   node scripts/build/size-targets.mjs <lab.json> [--markdown] [--strict]
 *
 * One line per target: pass, fail, or "no data" when the lab did not measure
 * what the target needs (a fixture missing, a build that never signalled
 * ready). Exit 0 always, unless `--strict`, which fails on any target that is
 * not a pass — CI runs it non-blocking until Phase 2 flips it on (T7).
 *
 * Units: bytes on the wire as the lab measures them (`bytes.*.gzip` — brotli
 * where the server compressed, gzip where the gateway did), medians over the
 * lab's runs, KB = 1024 bytes as the lab report prints them. Target 1 and 2
 * read `jsBeforeReadyGzip` on the reader view (`view` route): the script bytes
 * finished before the page was ready (scripts/lib/document-views.mjs). Target 3
 * reads the prose view's `totalGzip`: every response body. The production
 * prose page is measured separately after a deploy; the lab's prose view is
 * its proxy here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KB = 1024;

/** The three targets. `fixtures` are the lab keys whose maximum is judged; `optional` ones count only when present. */
export const SIZE_TARGETS = Object.freeze([
  { id: 1, label: 'JS before ready, nothing interactive (prose, deck)', metric: 'jsBeforeReadyGzip', route: 'view', fixtures: ['prose', 'deck'], optional: [], limit: 10 * KB },
  { id: 2, label: 'JS before ready, interactive (kit, dashboard, every component)', metric: 'jsBeforeReadyGzip', route: 'view', fixtures: ['kit', 'dashboard'], optional: ['kitchen'], limit: 85 * KB },
  { id: 3, label: 'Prose page, total transferred', metric: 'totalGzip', route: 'view', fixtures: ['prose'], optional: [], limit: 200 * KB },
]);

/**
 * Judge every target against `lab` (the whole lab JSON, or its `documents.summary`).
 * @returns {Array<{ id: number, label: string, limit: number, measured: number | null, worst: string | null, missing: string[], verdict: 'pass' | 'fail' | 'no data' }>}
 */
export function evaluateSizeTargets(lab) {
  const summary = lab?.documents?.summary ?? lab?.summary ?? lab ?? {};
  return SIZE_TARGETS.map((target) => {
    const values = [];
    const missing = [];
    for (const key of [...target.fixtures, ...target.optional]) {
      const value = summary[key]?.[target.route]?.[target.metric];
      if (typeof value === 'number' && Number.isFinite(value)) values.push({ key, value });
      else if (target.fixtures.includes(key)) missing.push(key);
    }
    if (!values.length || missing.length) return { id: target.id, label: target.label, limit: target.limit, measured: null, worst: null, missing, verdict: 'no data' };
    const worst = values.reduce((a, b) => (b.value > a.value ? b : a));
    return { id: target.id, label: target.label, limit: target.limit, measured: worst.value, worst: worst.key, missing, verdict: worst.value <= target.limit ? 'pass' : 'fail' };
  });
}

const kb = (bytes) => `${(bytes / KB).toFixed(1)} KB`;

/** A Markdown table for the job summary. */
export function sizeTargetsMarkdown(rows) {
  const lines = ['| # | Target | Limit | Measured | Verdict |', '| ---: | --- | ---: | ---: | --- |'];
  for (const row of rows) {
    const measured = row.measured === null ? `no data${row.missing.length ? ` (missing: ${row.missing.join(', ')})` : ''}` : `${kb(row.measured)} (${row.worst})`;
    lines.push(`| ${row.id} | ${row.label} | ${kb(row.limit)} | ${measured} | ${row.verdict} |`);
  }
  return lines.join('\n');
}

/** Plain lines for a terminal. */
export function sizeTargetsText(rows) {
  return rows.map((row) => `target ${row.id} ${row.verdict.padEnd(7)} ${row.label}: ${row.measured === null ? `no data${row.missing.length ? ` (missing ${row.missing.join(', ')})` : ''}` : `${kb(row.measured)} (${row.worst}) vs ≤ ${kb(row.limit)}`}`).join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: node scripts/build/size-targets.mjs <lab.json> [--markdown] [--strict]'); process.exit(2); }
  const rows = evaluateSizeTargets(JSON.parse(readFileSync(path.resolve(file), 'utf8')));
  console.log(args.includes('--markdown') ? `### Phase 2 size targets\n\n${sizeTargetsMarkdown(rows)}\n` : sizeTargetsText(rows));
  process.exit(args.includes('--strict') && rows.some((row) => row.verdict !== 'pass') ? 1 : 0);
}

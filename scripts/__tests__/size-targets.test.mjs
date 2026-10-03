/** The Phase 2 size targets read the lab's summary and judge each target on its worst fixture. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateSizeTargets, SIZE_TARGETS, sizeTargetsMarkdown, sizeTargetsText } from '../build/size-targets.mjs';
import { summarizeDocumentViews } from '../lib/document-views.mjs';

const KB = 1024;
/**
 * The document's own page (`raw`, what the app page frames) carries the JS; the reader's whole page (`view`) the total,
 * and the shell's own JS before its frame is ready.
 */
const cell = (jsBeforeReadyGzip, totalGzip, shell = 40 * KB) => ({ raw: { jsBeforeReadyGzip }, view: { totalGzip, jsBeforeReadyGzip: shell } });

describe('the four targets', () => {
  it('are the proposal\'s: 10 KB, 85 KB and 250 KB — the JS on the framed document, the total on the reader view — and 50 KB for the shell', () => {
    expect(SIZE_TARGETS.map((t) => [t.id, t.limit / KB, t.route])).toEqual([[1, 10, 'raw'], [2, 85, 'raw'], [3, 250, 'view'], [4, 50, 'view']]);
  });

  it('never judge document JS by the app shell around its frame', () => {
    // The shell's bundle readies the `view` route; the document's own page is `raw`.
    const shell = (doc) => ({ raw: { jsBeforeReadyGzip: doc }, view: { jsBeforeReadyGzip: 45 * KB, totalGzip: 130 * KB } });
    const rows = evaluateSizeTargets({ summary: { prose: shell(5 * KB), deck: shell(6 * KB), kit: shell(37 * KB), dashboard: shell(58 * KB) } });
    expect(rows.map((r) => [r.id, r.verdict, r.measured])).toEqual([[1, 'pass', 6 * KB], [2, 'pass', 58 * KB], [3, 'pass', 130 * KB], [4, 'pass', 45 * KB]]);
  });

  it('budget the app shell\'s own JS before its document frame is ready, on every page kind it frames', () => {
    const at = (shell) => cell(1, 1, shell);
    const rows = evaluateSizeTargets({ summary: { prose: at(30 * KB), deck: at(31 * KB), kit: at(44.9 * KB), dashboard: at(52 * KB) } });
    expect(rows[3]).toMatchObject({ id: 4, label: 'App shell JS before the document frame is ready', verdict: 'fail', worst: 'dashboard', measured: 52 * KB });
    // The document's own bytes are not the shell's: a heavy framed document leaves target 4 alone.
    const heavyDocument = evaluateSizeTargets({ summary: { prose: cell(200 * KB, 1, 30 * KB), deck: at(30 * KB), kit: at(30 * KB), dashboard: at(30 * KB) } });
    expect(heavyDocument[3]).toMatchObject({ verdict: 'pass', measured: 30 * KB });
    // A build that frames nothing, or whose frame never signalled ready, has no shell measurement: never a pass.
    const unframed = evaluateSizeTargets({ summary: { prose: at(null), deck: at(30 * KB), kit: at(30 * KB), dashboard: at(30 * KB) } });
    expect(unframed[3]).toMatchObject({ verdict: 'no data', missing: ['prose'] });
  });

  it('pass when every fixture is under its limit, judged on the worst one', () => {
    const rows = evaluateSizeTargets({ documents: { summary: { prose: cell(5 * KB, 150 * KB), deck: cell(6 * KB, 160 * KB), kit: cell(28 * KB, 200 * KB), dashboard: cell(50 * KB, 300 * KB, 45 * KB) } } });
    expect(rows.map((r) => [r.id, r.verdict, r.worst])).toEqual([[1, 'pass', 'deck'], [2, 'pass', 'dashboard'], [3, 'pass', 'prose'], [4, 'pass', 'dashboard']]);
  });

  it('fail on the fixture that breaks the limit, and name it', () => {
    const rows = evaluateSizeTargets({ documents: { summary: { prose: cell(275 * KB, 481 * KB), deck: cell(275 * KB, 400 * KB), kit: cell(275 * KB, 400 * KB), dashboard: cell(300 * KB, 500 * KB, 60 * KB) } } });
    expect(rows.map((r) => r.verdict)).toEqual(['fail', 'fail', 'fail', 'fail']);
    expect(rows[1].measured).toBe(300 * KB);
    expect(rows[1].worst).toBe('dashboard');
  });

  it('count the kitchen sink for target 2 only when the lab measured it', () => {
    const summary = { prose: cell(1, 1), deck: cell(1, 1), kit: cell(1, 1), dashboard: cell(1, 1) };
    expect(evaluateSizeTargets({ summary })[1]).toMatchObject({ verdict: 'pass', worst: 'kit', missing: [] });
    expect(evaluateSizeTargets({ summary: { ...summary, kitchen: cell(90 * KB, 1) } })[1]).toMatchObject({ verdict: 'fail', worst: 'kitchen' });
  });

  it('answer "no data" when a required fixture or the ready signal is missing, never pass by omission', () => {
    const rows = evaluateSizeTargets({ documents: { summary: { prose: { raw: { jsBeforeReadyGzip: null }, view: { totalGzip: 100 * KB } }, kit: cell(1, 1) } } });
    expect(rows[0]).toMatchObject({ verdict: 'no data', missing: ['prose', 'deck'] });
    expect(rows[1]).toMatchObject({ verdict: 'no data', missing: ['dashboard'] });
    expect(rows[2]).toMatchObject({ verdict: 'pass', measured: 100 * KB });
  });

  it('read what the lab summary produces from samples', () => {
    const sample = (fixture, gzip, before, route = 'view') => ({ fixture, route, ready: true, errors: [], fcp: 1, lcp: 1, takeover: 5, painted: null, readyAt: 5, requests: 3,
      bytes: { html: { decoded: 10, gzip: 10 }, js: { decoded: gzip * 3, gzip }, css: { decoded: 0, gzip: 4 }, other: { decoded: 0, gzip: 6 } }, jsBeforeReady: { decoded: before * 3, gzip: before }, scriptMs: 1 });
    const summary = summarizeDocumentViews([sample('prose', 100, 20), sample('prose', 300, 40), sample('prose', 9, 20, 'raw'), sample('prose', 9, 40, 'raw'), sample('deck', 50, 50, 'raw'), sample('kit', 1, 1, 'raw'), sample('dashboard', 1, 1, 'raw'),
      sample('deck', 1, 60), sample('kit', 1, 10), sample('dashboard', 1, 10)]);
    expect(summary.prose.raw.jsBeforeReadyGzip).toBe(30);
    expect(summary.prose.view.totalGzip).toBe(220);
    const rows = evaluateSizeTargets({ documents: { summary } });
    expect(rows[0]).toMatchObject({ verdict: 'pass', measured: 50, worst: 'deck' });
    expect(rows[2]).toMatchObject({ verdict: 'pass', measured: 220 });
    expect(rows[3]).toMatchObject({ verdict: 'pass', measured: 60, worst: 'deck' });
  });
});

describe('the report', () => {
  const rows = evaluateSizeTargets({ summary: { prose: cell(5 * KB, 150 * KB), deck: cell(12 * KB, 1), kit: cell(1, 1) } });
  it('prints one row per target with the verdict', () => {
    const markdown = sizeTargetsMarkdown(rows);
    expect(markdown.split('\n')).toHaveLength(6);
    expect(markdown).toContain('| 1 | JS before ready, nothing interactive (prose, deck) | 10.0 KB | 12.0 KB (deck) | fail |');
    expect(markdown).toContain('no data (missing: dashboard)');
    expect(sizeTargetsText(rows)).toContain('target 3 pass');
  });

  it('exits 0 by default and 1 under --strict when a target is not a pass', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'size-targets-'));
    const file = path.join(dir, 'lab.json');
    writeFileSync(file, JSON.stringify({ documents: { summary: { prose: cell(5 * KB, 150 * KB), deck: cell(12 * KB, 1), kit: cell(1, 1) } } }));
    const script = path.resolve(import.meta.dirname, '../build/size-targets.mjs');
    const out = execFileSync(process.execPath, [script, file], { encoding: 'utf8' });
    expect(out).toContain('target 1 fail');
    let status = 0;
    try { execFileSync(process.execPath, [script, file, '--strict'], { encoding: 'utf8' }); } catch (error) { status = error.status; }
    expect(status).toBe(1);
  });
});

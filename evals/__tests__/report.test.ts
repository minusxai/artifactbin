/**
 * Merge + render semantics, ported from minusx `scripts/__tests__/qa-report.test.ts`:
 *   - rows keyed by (flow, metric); a metric missing from a run renders null
 *   - duplicate rows within one run: numbers SUM, pass ANDs, text last-wins, images keyed by variant
 *   - HTML embeds labels, PASS/FAIL, and base64 data URIs for images
 * Plus what this port adds: a per-column SUMMARY band (pass rate, total cost, mean turns).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeRuns, renderHtml, renderSummaryMarkdown, reportStem, summarize, writeReport, type RunData } from '../lib/report';
import { RunRecorder } from '../lib/rows';
import { DEFAULT_IMAGE_VARIANT, variantKey } from '../lib/image-variants';

const runA: RunData = {
  meta: { label: 'run-a', target: 'https://a.example' },
  rows: [
    { flow: 'protocol', metric: 'pass', value: true, kind: 'pass' },
    { flow: 'protocol', metric: 'cost_usd', value: 0.0123, kind: 'number' },
    { flow: 'protocol', metric: 'cost_usd', value: 0.011, kind: 'number' },
    { flow: 'protocol', metric: 'total_tokens', value: 100, kind: 'number' },
    { flow: 'protocol', metric: 'total_tokens', value: 50, kind: 'number' },
    { flow: 'protocol', metric: 'turns', value: 4, kind: 'number' },
    { flow: 'protocol', metric: 'document', value: 'screens/doc.png', kind: 'image' },
    { flow: 'only-in-a', metric: 'pass', value: true, kind: 'pass' },
    { flow: 'only-in-a', metric: 'turns', value: 8, kind: 'number' },
    { flow: 'only-in-a', metric: 'cost_usd', value: 1, kind: 'number' },
  ],
};

const runB: RunData = {
  meta: { label: 'run-b', target: 'https://b.example' },
  rows: [
    { flow: 'protocol', metric: 'pass', value: true, kind: 'pass' },
    { flow: 'protocol', metric: 'pass', value: false, kind: 'pass' },
    { flow: 'protocol', metric: 'total_tokens', value: 70, kind: 'number' },
    { flow: 'protocol', metric: 'turns', value: 10, kind: 'number' },
  ],
};

describe('mergeRuns', () => {
  it('merges rows by (flow, metric) into one column per run; duplicates within a run SUM', () => {
    const merged = mergeRuns([runA, runB]);
    expect(merged.columns.map((c) => c.label)).toEqual(['run-a', 'run-b']);
    const tokens = merged.flows.find((f) => f.flow === 'protocol')!.metrics.find((m) => m.metric === 'total_tokens')!;
    expect(tokens.values).toEqual([150, 70]);
  });

  it('ANDs duplicate pass rows within a run', () => {
    const pass = mergeRuns([runA, runB]).flows[0].metrics.find((m) => m.metric === 'pass')!;
    expect(pass.values).toEqual([true, false]);
  });

  it('renders null for a metric a run never recorded; a variant-less image reads as the default variant', () => {
    const merged = mergeRuns([runA, runB]);
    expect(merged.flows.find((f) => f.flow === 'only-in-a')!.metrics[0].values).toEqual([true, null]);
    const image = merged.flows[0].metrics.find((m) => m.metric === 'document')!;
    expect(image.values).toEqual([{ [variantKey(DEFAULT_IMAGE_VARIANT)]: 'screens/doc.png' }, null]);
  });

  it('collects an image row captured in several variants into one keyed set', () => {
    const run: RunData = {
      meta: { label: 'v', target: 'local' },
      rows: [
        { flow: 'report', metric: 'document', value: 'a.png', kind: 'image', variant: { size: 'laptop', renderer: 'playwright' } },
        { flow: 'report', metric: 'document', value: 'b.png', kind: 'image', variant: { size: 'laptop', renderer: 'export' } },
        { flow: 'report', metric: 'document', value: 'c.png', kind: 'image', variant: { size: 'mobile', renderer: 'playwright' } },
      ],
    };
    expect(mergeRuns([run]).flows[0].metrics[0].values[0]).toEqual({ 'laptop:playwright': 'a.png', 'laptop:export': 'b.png', 'mobile:playwright': 'c.png' });
  });
});

describe('summarize', () => {
  it('per column: pass rate over the pass rows of every flow, total cost, mean turns', () => {
    const s = summarize(mergeRuns([runA, runB]));
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ label: 'run-a', passed: 2, total: 2, costUsd: 1.0233, meanTurns: 6 });
    expect(s[1]).toMatchObject({ label: 'run-b', passed: 0, total: 1, costUsd: null, meanTurns: 10 });
  });
});

describe('renderHtml', () => {
  it('renders labels, links, PASS/FAIL, numbers with enough precision, inlined images, placeholders, and the summary band', () => {
    const merged = mergeRuns([runA, runB]);
    const png = Buffer.from('fake-png-bytes');
    const html = renderHtml(merged, { resolveImage: (col, rel) => (col === 0 && rel === 'screens/doc.png' ? png : null) });
    expect(html).toContain('run-a');
    expect(html).toContain('<a href="https://a.example"');
    expect(html).toContain('PASS');
    expect(html).toContain('FAIL');
    expect(html).toContain('150');
    expect(html).toContain('0.0233');
    expect(html).toContain(`data:image/png;base64,${png.toString('base64')}`);
    expect(html).toContain('—');
    expect(html).toContain('aria-label="Summary"');
    expect(html).toContain('2/2');
    expect(html).toContain('0/1');
  });

  it('emits one img per captured variant, tagged for the settings toggle, and the settings/lightbox chrome', () => {
    const run: RunData = {
      meta: { label: 'v', target: 'local' },
      rows: [
        { flow: 'report', metric: 'document', value: 'a.png', kind: 'image', variant: { size: 'laptop', renderer: 'playwright' } },
        { flow: 'report', metric: 'document', value: 'b.png', kind: 'image', variant: { size: 'mobile', renderer: 'export' } },
      ],
    };
    const html = renderHtml(mergeRuns([run]), { resolveImage: (_c, rel) => Buffer.from(rel) });
    expect(html).toContain('data-variant="laptop:playwright"');
    expect(html).toContain('data-variant="mobile:export"');
    expect(html).toContain('aria-label="Open report settings"');
    expect(html).toContain('aria-label="Image size"');
    expect(html).toContain('aria-label="Image renderer"');
    expect(html).toContain('value="laptop" checked');
    expect(html).toContain('value="playwright" checked');
    expect(html).toContain('aria-label="Close image preview"');
    expect(html).toContain('createObjectURL');
  });
});

describe('renderSummaryMarkdown', () => {
  it('is a table of what each leg cost and how it did', () => {
    const md = renderSummaryMarkdown(mergeRuns([runA, runB]));
    expect(md).toContain('| run-a |');
    expect(md).toContain('| run-b |');
    expect(md).toContain('2/2');
    expect(md).toContain('0/1');
    expect(md).toContain('1.0233');   // run-a's summed cost_usd
    expect(md).toContain('**Total**');
  });

  it('says when a cost is unknown rather than printing 0 — a harness can report no tokens at all', () => {
    // OpenCode can exit before its final step_finish; a blank cost must not read as "free".
    const md = renderSummaryMarkdown(mergeRuns([{ meta: { label: 'no-telemetry', target: 't' }, rows: [{ flow: 'protocol', metric: 'pass', value: true, kind: 'pass' }] }]));
    expect(md).toContain('unknown');
    expect(md).not.toMatch(/\|\s*0\.0000\s*\|/);
  });

  it('totals only the costs it actually knows', () => {
    const md = renderSummaryMarkdown(mergeRuns([runA, runB]));
    expect(md).toMatch(/\*\*Total\*\*.*1\.0233/);
  });
});

describe('renderHtml — reading it at a glance', () => {
  const twoLegs = mergeRuns([runA, runB]);
  const html = () => renderHtml(twoLegs, { resolveImage: () => Buffer.from('x') });

  it('marks the better column where "better" means something, and says which way', () => {
    const out = html();
    // run-a: cost 0.0233, run-b: none → no contest. total_tokens 150 vs 70 → run-b is better.
    expect(out).toContain('class="num best"');
    expect(out).toMatch(/total_tokens\s*<span class="dir">↓<\/span>/);
  });

  it('does not mark a metric that is not a contest', () => {
    const run = {
      meta: { label: 'v', target: 'local' },
      rows: [{ flow: 'f', metric: 'versions', value: 2, kind: 'number' as const }],
    };
    const out = renderHtml(mergeRuns([run, { ...run, meta: { label: 'w', target: 'local' } }]), { resolveImage: () => null });
    expect(out).not.toContain('class="num best"');
    expect(out).not.toMatch(/versions\s*<span class="dir">/);
  });

  it('collapses each flow by default, so the summary is what you land on', () => {
    const out = html();
    expect(out).toContain('data-flow-toggle');
    expect(out).toContain('data-collapsed="true"');
  });

  it('gathers every artifact image into one gallery, labelled by flow and leg', () => {
    const out = html();
    expect(out).toContain('aria-label="All artifacts"');
    expect(out).toContain('gallery');
  });
});

describe('renderHtml — the parts a reader sees first', () => {
  const html = () => renderHtml(mergeRuns([runA, runB]), { resolveImage: () => Buffer.from('x') });

  it('reveals gallery images with the same selector as table images', () => {
    // The tiles are <figure data-shots>, not <td data-shots>; a td-only selector leaves every
    // gallery image `hidden` and the strip renders as captions with nothing above them.
    const out = html();
    const selector = /querySelectorAll\('([^']*\[data-shots\])'\)/.exec(out)?.[1];
    expect(selector).toBeTruthy();
    expect(selector!.startsWith('td')).toBe(false);
  });

  it('marks the better column in the SUMMARY too — it is the first thing read', () => {
    const out = html();
    const summary = out.slice(out.indexOf('aria-label="Summary"'), out.indexOf('aria-label="Metrics"'));
    // run-a cost 1.0233 vs run-b none → no contest; mean turns 6 vs 10 → run-a is better.
    expect(summary).toContain('best');
  });
});

describe('renderHtml — URLs are clickable', () => {
  const withText = (metric: string, value: string) =>
    renderHtml(mergeRuns([{ meta: { label: 'a', target: 'local' }, rows: [{ flow: 'f', metric, value, kind: 'text' }] }]),
      { resolveImage: () => null });

  it('links a value that is entirely a URL, opening in a new tab', () => {
    const html = withText('url', 'https://artifactbin.dev/a/DKzVUp');
    expect(html).toContain('<a href="https://artifactbin.dev/a/DKzVUp" target="_blank" rel="noopener">https://artifactbin.dev/a/DKzVUp</a>');
  });

  it('links the agent\'s final message when that is just the URL', () => {
    expect(withText('final_message', 'https://artifactbin.dev/a/umq0OD')).toContain('<a href="https://artifactbin.dev/a/umq0OD"');
  });

  it('leaves ordinary text alone, including text that merely mentions a URL', () => {
    expect(withText('first_error', 'invalid_jsx')).not.toContain('<a href');
    expect(withText('final_message', 'published at https://x.dev/a/1 — done')).not.toContain('<a href');
  });

  it('never makes a live link out of a dangerous scheme — these values come from an AGENT', () => {
    for (const hostile of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x']) {
      const html = withText('final_message', hostile);
      expect(html).not.toContain('<a href');
      expect(html).not.toContain('javascript:alert(1)</a>');
    }
  });

  it('escapes a URL containing markup characters rather than emitting them raw', () => {
    const html = withText('url', 'https://x.dev/a/1?q="><img src=x>');
    expect(html).not.toContain('"><img src=x>');
    expect(html).toContain('&quot;&gt;&lt;img');
  });
});

describe('the task brief', () => {
  const withBrief = (label: string, brief: string): RunData => ({
    meta: { label, target: 'https://x.example' },
    rows: [
      { flow: 'report', metric: 'Task Brief', value: brief, kind: 'text' },
      { flow: 'report', metric: 'pass', value: true, kind: 'pass' },
    ],
  });

  it('is ONE row carrying each leg its own brief, so a future divergence is visible rather than collapsed', () => {
    const merged = mergeRuns([withBrief('a', 'write a report'), withBrief('b', 'write a report, and note you cannot view images')]);
    const brief = merged.flows[0].metrics.filter((m) => m.metric === 'Task Brief');
    expect(brief).toHaveLength(1);
    expect(brief[0].kind).toBe('text');
    expect(brief[0].values).toEqual(['write a report', 'write a report, and note you cannot view images']);
  });

  it('opens the section: it is the first metric of its flow', () => {
    const merged = mergeRuns([withBrief('a', 'write a report')]);
    expect(merged.flows[0].metrics[0].metric).toBe('Task Brief');
  });

  it('renders as escaped prose in every column, never as a link', () => {
    const html = renderHtml(mergeRuns([withBrief('a', 'Title it "Q2" & <b>keep it short</b>')]), { resolveImage: () => null });
    expect(html).toContain('Title it &quot;Q2&quot; &amp; &lt;b&gt;keep it short&lt;/b&gt;');
    expect(html).not.toContain('<b>keep it short</b>');
  });
});

/**
 * The report is named by WHEN ITS RUNS STARTED, so two downloads never overwrite
 * each other and a filename says which comparison it holds: `report-<UTC stamp>`.
 * The stamp is the earliest leg's start (the legs of one matrix start together),
 * and a run recorded before `startedAt` existed falls back to the render time.
 */
describe('reportStem', () => {
  const fallback = new Date('2030-01-02T03:04:05Z');
  it('is the earliest leg start, to the minute, in UTC', () => {
    const cols = [
      { label: 'b', target: 't', startedAt: '2026-08-28T02:51:10.000Z' },
      { label: 'a', target: 't', startedAt: '2026-08-28T02:49:26.000Z' },
    ];
    expect(reportStem(cols, fallback)).toBe('report-20260828-0249Z');
  });
  it('falls back to the render time when no leg recorded a start', () => {
    expect(reportStem([{ label: 'a', target: 't' }], fallback)).toBe('report-20300102-0304Z');
  });
});

describe('writeReport', () => {
  it('writes <stem>.html and <stem>.json side by side, and returns the html path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-report-'));
    const run = path.join(root, 'run');
    new RunRecorder(run, { label: 'x', target: 't', startedAt: '2026-08-28T02:49:26.000Z' }, 'protocol').finalize(true);
    const html = writeReport([{ dir: run }], path.join(root, 'out'));
    expect(path.basename(html)).toBe('report-20260828-0249Z.html');
    expect(fs.existsSync(path.join(root, 'out', 'report-20260828-0249Z.json'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

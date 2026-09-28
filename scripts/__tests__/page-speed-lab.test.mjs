/** The page-speed lab: its workflow stays off the critical path, and its report reads what it measured. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { describe, expect, it } from 'vitest';
import { documentViewsMarkdown, median, summarizeDocumentViews, waitForStoredDiagrams, documentMeasurementMode } from '../lib/document-views.mjs';
import { PAGE_SPEED_FIXTURES, publishPageSpeedFixtures } from '../fixtures/page-speed/index.mjs';
import { loadsSummary, reportMarkdown } from '../performance-report.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const workflowText = readFileSync(path.join(root, '.github/workflows/page-speed.yml'), 'utf8');
const workflow = yaml.parse(workflowText);
const ci = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));

describe('the page-speed workflow', () => {
  it('runs beside CI for app changes and main pushes, including changes to the lab itself', () => {
    for (const trigger of [workflow.on.pull_request, workflow.on.push]) {
      expect(trigger.paths).toEqual(expect.arrayContaining(['services/app/**', 'scripts/performance-loads.mjs', 'scripts/lib/document-views.mjs', 'scripts/fixtures/page-speed/**', '.github/workflows/page-speed.yml']));
    }
    expect(workflow.on.push.branches).toEqual(['main']);
    expect(workflow.concurrency['cancel-in-progress']).toContain("github.event_name == 'pull_request'");
  });

  it('never lengthens or gates CI: no ci.yml job waits on it or runs the lab', () => {
    const ciText = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    expect(ciText).not.toContain('performance-loads');
    expect(ciText).not.toContain('page-speed');
    for (const job of Object.values(ci.jobs)) expect(job.needs ?? []).not.toContain('lab');
    expect(Object.keys(workflow.jobs)).toEqual(['measure', 'report']);
  });

  it('only reads the repository and posts no PR comment', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.measure.permissions).toBeUndefined();
    expect(workflowText).not.toMatch(/gh pr comment|pull-requests:\s*write|issues:\s*write|createComment/);
    const steps = workflow.jobs.report.steps.map(step => step.run ?? '').join('\n');
    expect(steps).toContain('GITHUB_STEP_SUMMARY');
    expect(workflow.jobs.measure.steps.some(step => String(step.uses).startsWith('actions/upload-artifact@'))).toBe(true);
  });

  it('pins every action to a full commit SHA', () => {
    const refs = [...workflowText.matchAll(/uses:\s+([^\s#]+)/g)].map(m => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });

  it('measures base and head in parallel, then reports their artifacts', () => {
    expect(workflow.jobs.measure.strategy.matrix.revision).toEqual(['base', 'head']);
    const runs = workflow.jobs.measure.steps.map(step => step.run ?? '').join('\n');
    expect(runs).toContain('node scripts/performance-loads.mjs');
    expect(runs).toContain('--size-only');
    expect(workflow.jobs.report.needs).toEqual(['measure']);
    expect(workflow.jobs.report.steps.some(step => String(step.uses).startsWith('actions/download-artifact@'))).toBe(true);
    expect(workflow.jobs.report.steps.map(step => step.run ?? '').join('\n')).toContain('node scripts/size-targets.mjs page-speed/head.json --markdown');
  });

  it('keeps full timing measurements on a manual run, while PRs use size only', () => {
    expect(workflow.on.workflow_dispatch).toBeDefined();
    const runs = workflow.jobs.measure.steps.map(step => step.run ?? '').join('\n');
    expect(workflow.jobs.measure.steps.find(step => step.name === 'Measure selected revision').env.EVENT).toContain('github.event_name');
    expect(runs).toContain('if [ "$EVENT" = workflow_dispatch ]');
  });
});

describe('size-only document measurements', () => {
  it('uses one unthrottled pass per fixture and route', () => {
    expect(documentMeasurementMode(true)).toEqual({ runs: 1, throttle: null, sizeOnly: true });
    expect(documentMeasurementMode(false)).toEqual({ runs: 5, throttle: { latencyMs: 80, downloadMbps: 10, uploadMbps: 5, cpuSlowdown: 4 }, sizeOnly: false });
  });
});

describe('page-speed fixtures', () => {
  it('publishes the dataset first and points the dashboard at it', async () => {
    const bodies = [];
    const published = await publishPageSpeedFixtures(async body => { bodies.push(body); return { id: `id${bodies.length}` }; });
    expect(bodies[0]).toMatchObject({ title: 'Perf sales', visibility: 'unlisted' });
    expect(bodies[0].dataset.split('\n')[0]).toBe('month,region,product,revenue,units');
    expect(published.map(f => f.key)).toEqual(['prose', 'kit', 'dashboard', 'deck', 'mermaid', 'mermaid-industry', 'kitchen']);
    // The same diagram in a theme's web fonts: the drawing a stored copy is made of (the plain one draws in system fonts).
    const themed = bodies.find(body => body.title === 'Perf F mermaid, industry theme');
    expect(themed.theme).toBe('industry');
    expect(themed.markup).toBe(bodies.find(body => body.title === 'Perf E mermaid').markup);
    expect(bodies.find(body => body.title === 'Perf E mermaid').theme).toBeUndefined();
    const dashboard = bodies.find(body => body.title === 'Perf C dashboard');
    expect(dashboard.template).toBe('dashboard');
    expect(dashboard.markup).toContain('src="ref:id1"');
    expect(dashboard.markup).not.toContain('{{sales}}');
    expect(bodies.find(body => body.title === 'Perf D deck').template).toBe('deck');
    expect(PAGE_SPEED_FIXTURES.find(f => f.key === 'mermaid').painted).toEqual({ diagrams: 1 });
    const kitchen = bodies.find(body => body.title === 'Perf G kitchen sink');
    const beforeKitchen = bodies.slice(0, bodies.indexOf(kitchen));
    for (const field of ['dataset', 'viz', 'image', 'pdf']) {
      const index = beforeKitchen.findIndex(body => body.title.startsWith('kit ') && body[field]);
      expect(index, `${field} is published before the kitchen sink`).toBeGreaterThanOrEqual(0);
      expect(kitchen.markup).toContain(`ref:id${index + 1}`);
    }
  });
});

const sample = (fixture, route, overrides = {}) => ({
  fixture, route, ready: true, errors: [], fcp: 100, lcp: 120, takeover: route === 'view' ? 700 : null, painted: null, requests: 10,
  bytes: { html: { decoded: 2048, gzip: 1024 }, js: { decoded: 4096, gzip: 2048 }, css: { decoded: 0, gzip: 0 }, other: { decoded: 0, gzip: 0 } }, scriptMs: 50, ...overrides,
});

describe('waiting for stored diagram drawings', () => {
  const fixtures = [{ key: 'prose', id: 'p', painted: null }, { key: 'mermaid', id: 'm', painted: { diagrams: 1 } }];
  it('waits only for diagram fixtures, until their served document carries stored drawings', async () => {
    let calls = 0;
    const fetchImpl = async (url) => { calls++; expect(url).toBe('http://lab/a/m/raw'); return { text: async () => (calls >= 3 ? '{"mermaidImages":{}}' : '{}') }; };
    expect(await waitForStoredDiagrams('http://lab', fixtures, { pollMs: 1, fetchImpl })).toEqual(['mermaid']);
    expect(calls).toBe(3);
  });
  it('gives up after its bound on a build that never stores them', async () => {
    const fetchImpl = async () => ({ text: async () => '{}' });
    expect(await waitForStoredDiagrams('http://lab', fixtures, { timeoutMs: 20, pollMs: 5, fetchImpl })).toEqual([]);
  });
});

describe('the lab report', () => {
  it('takes medians of what was measured, ignoring missing values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, undefined, 5])).toBe(5);
    expect(median([null])).toBeNull();
  });

  it('summarizes each fixture and route, counting timeouts', () => {
    const summary = summarizeDocumentViews([
      sample('prose', 'view', { takeover: 600 }), sample('prose', 'view', { takeover: 800, ready: false }), sample('prose', 'view'),
      sample('prose', 'raw'),
    ]);
    expect(summary.prose.view).toMatchObject({ runs: 3, timedOut: 1, takeover: 700, jsGzip: 2048, requests: 10 });
    expect(summary.prose.raw.takeover).toBeNull();
  });

  it('shows head values with the signed change from base', () => {
    const base = summarizeDocumentViews([sample('prose', 'view', { takeover: 700 })]);
    const head = summarizeDocumentViews([sample('prose', 'view', { takeover: 150, bytes: { ...sample('x', 'y').bytes, js: { decoded: 4096, gzip: 3072 } } })]);
    const row = documentViewsMarkdown(head, base).split('\n').find(line => line.startsWith('| prose | view'));
    expect(row).toContain('150 (−550)');
    expect(row).toContain('3.0 (+1.0)');
    expect(documentViewsMarkdown(head)).toContain('| 150 |');
  });

  it('reports document views and app loads for base and head', () => {
    const loads = [{ route: 'home', cache: 'cold', usefulMs: 900, ttfbMs: 40, jsTransferredBytes: 2048 }, { route: 'home', cache: 'cold', usefulMs: 1100, ttfbMs: 60, jsTransferredBytes: 2048 }];
    expect(loadsSummary({ loads })['home cold']).toEqual({ runs: 2, usefulMs: 1000, ttfbMs: 50, jsTransferredBytes: 2048 });
    const documents = { conditions: { latencyMs: 80, downloadMbps: 10, cpuSlowdown: 4, runs: 5 }, summary: summarizeDocumentViews([sample('deck', 'view')]) };
    const text = reportMarkdown({ revision: 'b'.repeat(40), loads, documents }, { revision: 'a'.repeat(40), loads, documents, conditions: { repetitions: 7 } });
    expect(text).toContain('`bbbbbbbbbbbb` → head `aaaaaaaaaaaa`');
    expect(text).toContain('| deck | view |');
    expect(text).toContain('| home | cold | 1000 (±0) | 50 (±0) | 2.0 (±0.0) |');
  });

  it('labels a one-pass size report and omits app-load timing', () => {
    const documents = { conditions: { mode: 'size-only', runs: 1 }, summary: summarizeDocumentViews([sample('prose', 'view')]) };
    const text = reportMarkdown({ revision: 'a'.repeat(40), documents }, { revision: 'b'.repeat(40), documents });
    expect(text).toContain('one unthrottled pass');
    expect(text).toContain('JS before ready gz KB');
    expect(text).not.toContain('### App loads');
  });
});

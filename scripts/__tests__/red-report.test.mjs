/** scripts/lib/red-report.mjs: what a red `ci` run on main says about itself (ci.yml's `test` roll-up). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { failingTestFiles, redReport } from '../lib/red-report.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('a red ci run names its suspects', () => {
  it('reads the failing files from a Vitest log, colours and project badges included, each once', () => {
    // Lines as GitHub serves a job's log (run 44360026508's node shard and browser part).
    const log = [
      '2026-11-18T17:35:21.6356953Z \x1b[31m     \x1b[31m×\x1b[31m carries a snapshot byte-identical to .env.example\x1b[39m',
      '2026-11-18T17:35:46.5520389Z \x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m \x1b[30m\x1b[43m node \x1b[49m\x1b[39m scripts/__tests__/setup-plan.test.mjs\x1b[2m > \x1b[22mthe setup planner ships whole',
      '2026-11-18T17:35:27.8204816Z \x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m \x1b[30m\x1b[45m integration \x1b[49m\x1b[39m services/browser/__tests__/session-pages.test.ts\x1b[2m > \x1b[22mdelivers successive real SSE segments',
      '2026-11-18T17:35:46.5520389Z \x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m \x1b[30m\x1b[43m node \x1b[49m\x1b[39m scripts/__tests__/setup-plan.test.mjs\x1b[2m > \x1b[22manother test in it',
      '2026-11-18T17:35:46.5669698Z  Test Files  1 failed | 114 passed (115)',
    ].join('\n');
    expect(failingTestFiles(log)).toEqual(['scripts/__tests__/setup-plan.test.mjs', 'services/browser/__tests__/session-pages.test.ts']);
    expect(failingTestFiles('Test Files  12 passed (12)\n')).toEqual([]);
  });

  it('lists the commits since the last green run and each failed job with its files, in the summary and one annotation', () => {
    const { markdown, annotation } = redReport({
      head: '7c9c7da6d0000000000000000000000000000000',
      green: { sha: '77e7ffc520000000000000000000000000000000', run: 44311570779 },
      commits: [{ sha: '7c9c7da6d0000000000000000000000000000000', subject: 'Keep a comment written while the page was edited (#1345)' }],
      jobs: [{ name: 'node tests (1/6)', files: ['services/app/lib/annotations/__tests__/store.test.ts'] }, { name: 'build', files: [] }],
    });
    expect(markdown).toContain('## ci is red at 7c9c7da6d');
    expect(markdown).toContain('1 commit(s) since the last green ci run on main (77e7ffc52, run 44311570779):');
    expect(markdown).toContain('- 7c9c7da6d Keep a comment written while the page was edited (#1345)');
    expect(markdown).toContain('- node tests (1/6): `services/app/lib/annotations/__tests__/store.test.ts`');
    expect(markdown).toContain('- build (no failing test file in its log)');
    expect(annotation).toBe('ci is red at 7c9c7da6d: node tests (1/6), build failed (services/app/lib/annotations/__tests__/store.test.ts); 1 commit(s) since the last green ci run on main (77e7ffc52, run 44311570779).');
    expect(annotation).not.toContain('\n');
    expect(redReport({ head: 'abc', green: null, commits: [], jobs: [] }).markdown).toContain('with no green ci run on main to compare against');
  });

  it('runs in the roll-up only when the run failed, after the check that failed it, and never decides the run', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    const steps = jobs.test.steps;
    const at = (text) => steps.findIndex((step) => (step.run ?? '') === text);
    const report = steps[at('node scripts/ci/ci.mjs red-report')];
    expect(report).toMatchObject({ if: 'failure()', 'continue-on-error': true, env: { GH_TOKEN: '${{ github.token }}' } });
    expect(at('node scripts/ci/ci.mjs red-report')).toBe(at('node scripts/ci/ci.mjs check') + 1);
    // Reading the run's jobs and their logs, and comparing commits, need no more than the roll-up already holds.
    expect(jobs.test.permissions).toEqual({ contents: 'read', actions: 'read' });
  });
});

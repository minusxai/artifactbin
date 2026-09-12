import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { discoverTasks, selectTasks } from '../lib/task-set';
import { planAccess } from '../lib/tasks';
import { parseMode } from '../lib/mode';

const ROOT = path.resolve(__dirname, '../..');
const ci = yaml.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')) as {
  jobs: Record<string, { steps?: Array<{ name?: string; run?: string; with?: Record<string, unknown> }>; strategy?: { matrix?: { include?: Array<{ mode: string; tasks: string }> } } }>;
};
const ROWS = ci.jobs['agent-smoke'].strategy?.matrix?.include ?? [];
const tasksOf = (row: { tasks: string }) => row.tasks.split(',').map((s) => s.trim());

const CI_SET = selectTasks(discoverTasks(path.join(ROOT, 'evals/tasks')), { set: 'ci' });
const byId = new Map(CI_SET.map((t) => [t.id, t.task]));

describe('the agent-smoke matrix', () => {
  it('runs Linux agents under a separate account with evidence outside the denied checkout', () => {
    const steps = ci.jobs['agent-smoke'].steps ?? [];
    const prepare = steps.find((step) => step.name === 'Prepare isolated eval account')?.run ?? '';
    expect(prepare).toContain('useradd --create-home --shell /bin/bash eval-agent');
    expect(prepare).toContain('chmod 700 "$GITHUB_WORKSPACE"');
    expect(prepare).toContain('sudo -n -u eval-agent test -r "$GITHUB_WORKSPACE/package.json"');
    const launch = steps.find((step) => step.run?.includes('npm run eval'))?.run ?? '';
    expect(launch).toContain('--run-as=eval-agent');
    expect(launch).toContain('--out="$RUNNER_TEMP/agent-smoke-metrics"');
    expect(launch).toContain('umask 077');
    expect(steps.some((step) => step.with?.path === '${{ runner.temp }}/agent-smoke-metrics/')).toBe(true);
  });

  it('runs the CLI with installed local skills', () => {
    expect(ROWS).toHaveLength(1);
    expect(ROWS[0].mode).toBe('installed');
    expect(tasksOf(ROWS[0])).toEqual(expect.arrayContaining(['cli', 'data', 'edit', 'comment']));
  });

  it('names only tasks that exist AND are in the CI set — never a comparison brief', () => {
    for (const r of ROWS) {
      for (const id of tasksOf(r)) expect(byId.has(id), `${r.mode} names ${id}`).toBe(true);
    }
  });

  it('and every row can actually PLAN every task it names — the general form of the rule above', () => {
    for (const r of ROWS) {
      // The row's mode is one the driver knows; which one is the matrix's business, not this test's.
      expect(() => parseMode(r.mode), r.mode).not.toThrow();
      for (const id of tasksOf(r)) {
        const task = byId.get(id)!;
        expect(
          () => planAccess({ task, base: 'http://x.test', start: { id: 'abc123' }, credential: { token: 'mx_account' } }),
          `${r.mode} × ${id}`,
        ).not.toThrow();
      }
    }
  });
});

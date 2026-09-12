import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { discoverTasks, selectTasks } from '../lib/task-set';
import { planAccess } from '../lib/tasks';
import { parseMode } from '../lib/mode';
import { approverNeeded } from '../lib/approver';

const ROOT = path.resolve(__dirname, '../..');
const ci = yaml.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')) as {
  jobs: Record<string, { steps?: Array<{ name?: string; run?: string; with?: Record<string, unknown> }>; strategy?: { matrix?: { include?: Array<{ mode: string; tasks: string }> } } }>;
};
// The installed leg runs on every pull request; the not-installed leg (the agent installing and
// authenticating itself, which no fix can hold under three minutes) runs nightly in its own workflow.
const nightly = yaml.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/agent-smoke-nightly.yml'), 'utf8')) as {
  jobs: Record<string, { steps?: Array<{ name?: string; run?: string }> }>;
};
const nightlyRows = Object.values(nightly.jobs).flatMap((job) => (job.steps ?? [])
  .map((step) => step.run ?? '').filter((run) => run.includes('npm run eval'))
  .map((run) => ({ mode: /--mode=([\w-]+)/.exec(run)?.[1] ?? '', tasks: /--tasks=([\w,]+)/.exec(run)?.[1] ?? '' })));
const ROWS = [...(ci.jobs['agent-smoke'].strategy?.matrix?.include ?? []), ...nightlyRows];
const tasksOf = (row: { tasks: string }) => row.tasks.split(',').map((s) => s.trim());

const CI_SET = selectTasks(discoverTasks(path.join(ROOT, 'evals/tasks')), { set: 'ci' });
const byId = new Map(CI_SET.map((t) => [t.id, t.task]));

describe('the agent-smoke matrix', () => {
  it('runs Linux agents under a separate account with evidence outside the denied checkout', () => {
    const steps = ci.jobs['agent-smoke'].steps ?? [];
    const prepare = ['create the eval account', 'close the checkout to it', 'prove the eval account cannot read the checkout']
      .map((name) => steps.find((step) => step.name === name)?.run ?? '').join('\n');
    expect(prepare).toContain('useradd --create-home --shell /bin/bash eval-agent');
    expect(prepare).toContain('chmod 700 "$GITHUB_WORKSPACE"');
    expect(prepare).toContain('sudo -n -u eval-agent test -r "$GITHUB_WORKSPACE/package.json"');
    const launch = steps.find((step) => step.run?.includes('npm run eval'))?.run ?? '';
    expect(launch).toContain('--run-as=eval-agent');
    expect(launch).toContain('--out="$RUNNER_TEMP/agent-smoke-metrics"');
    expect(launch).toContain('umask 077');
    expect(steps.some((step) => step.with?.path === '${{ runner.temp }}/agent-smoke-metrics/')).toBe(true);
  });

  /**
   * BOTH FLOWS OF THE ONE CREDENTIAL PATH. `installed` is a driver that ran `afbin auth` before the
   * turn; `not-installed` is an agent that installs afbin and authenticates ITSELF, with the driver
   * approving the pairing as the person would. Only the second exercises that half, and it was not
   * being run at all — so a break in the agent's own auto-auth would have reached production green.
   */
  it('runs both CLI flows: staged-and-authenticated on every PR, and the agent doing it for itself nightly', () => {
    const byMode = new Map(ROWS.map((r) => [r.mode, r]));
    expect([...byMode.keys()].sort()).toEqual(['installed', 'not-installed']);
    expect((ci.jobs['agent-smoke'].strategy?.matrix?.include ?? []).map((r) => r.mode)).toEqual(['installed']);
    expect(tasksOf(byMode.get('installed')!)).toEqual(expect.arrayContaining(['cli', 'data', 'edit', 'comment']));
    // Two tasks are enough for the flow that is being exercised; each one is a paid agent run.
    expect(tasksOf(byMode.get('not-installed')!)).toEqual(expect.arrayContaining(['cli', 'comment']));
  });

  it('the not-installed leg gets the approver its agent cannot run without', () => {
    // The agent starts its own device pairing mid-turn and nobody else can approve it; the driver
    // must, and the predicate that decides is `lib/approver approverNeeded` (pinned in its own suite).
    for (const r of ROWS) expect(approverNeeded(parseMode(r.mode)), r.mode).toBe(r.mode === 'not-installed');
  });

  it('names only tasks that exist AND are in the CI set — never a comparison brief', () => {
    for (const r of ROWS) {
      for (const id of tasksOf(r)) expect(byId.has(id), `${r.mode} names ${id}`).toBe(true);
    }
  });

  it('and every row can actually PLAN every task it names — the general form of the rule above', () => {
    for (const r of ROWS) {
      // The row's mode is one the driver knows; which one is the matrix's business, not this test's.
      expect(parseMode(r.mode), r.mode).toBe(r.mode);
      for (const id of tasksOf(r)) {
        const task = byId.get(id)!;
        // Planning has to produce the two things a leg is launched with: the document the agent is
        // pointed at, and the seed write — present exactly when the task declares one.
        const plan = planAccess({ task, base: 'http://x.test', start: { id: 'abc123' }, credential: { token: 'mx_account' } });
        expect(plan.access, `${r.mode} × ${id}`).toEqual({ base: 'http://x.test', id: 'abc123' });
        if (task.seed === undefined) expect(plan.seed, `${r.mode} × ${id}`).toBeNull();
        else expect(plan.seed, `${r.mode} × ${id}`).toMatchObject({ id: 'abc123', markup: task.seed });
      }
    }
  });
});

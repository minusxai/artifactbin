/**
 * THE MATRIX AND THE TASKS HAVE TO AGREE — a guard that never runs is not a guard.
 *
 * `agent-smoke` names its tasks explicitly (`--tasks=…`) rather than taking the whole CI set, so a task
 * can sit in `evals/tasks/` for ever without a job ever running it. That is one failure mode. The other
 * is the opposite: handing a task to a mode it cannot run — `no-token` declares `handoff: none`, and an
 * MCP transport carries its token in the harness configuration, so `planAccess` REFUSES it. A job that
 * received it would burn its setup and fail.
 *
 * Both are checked here structurally, from the parsed workflow: every task a row names exists, is in the
 * CI set, and can actually be planned under that row's mode.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { discoverTasks, selectTasks } from '../lib/task-set';
import { needsStartDocument, planAccess } from '../lib/tasks';
import { actionTransport, installsSkills, type EvalMode } from '../lib/mode';

const ROOT = path.resolve(__dirname, '../..');
const ci = yaml.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')) as {
  jobs: Record<string, { strategy?: { matrix?: { include?: Array<{ mode: string; tasks: string }> } } }>;
};
const ROWS = ci.jobs['agent-smoke'].strategy?.matrix?.include ?? [];
const tasksOf = (row: { tasks: string }) => row.tasks.split(',').map((s) => s.trim());
const row = (mode: string) => ROWS.find((r) => r.mode === mode)!;

const CI_SET = selectTasks(discoverTasks(path.join(ROOT, 'evals/tasks')), { set: 'ci' });
const byId = new Map(CI_SET.map((t) => [t.id, t.task]));

describe('the agent-smoke matrix', () => {
  it('has the four two-axis treatments and names tasks for each', () => {
    expect(ROWS.map((r) => r.mode)).toEqual([
      'fetched_skill+api_action', 'fetched_skill+mcp_action', 'installed_skill+api_action', 'installed_skill+mcp_action',
    ]);
    for (const r of ROWS) expect(tasksOf(r).length).toBeGreaterThan(0);
  });

  it('names only tasks that exist AND are in the CI set — never a comparison brief', () => {
    for (const r of ROWS) {
      for (const id of tasksOf(r)) expect(byId.has(id), `${r.mode} names ${id}`).toBe(true);
    }
  });

  it('runs the token-less guard on BOTH api_action treatments', () => {
    // The whole point of the task: an agent handed no credential must stop and ask its human, and that
    // is a product regression worth catching on every PR, in both skill-delivery treatments.
    expect(tasksOf(row('fetched_skill+api_action'))).toContain('no-token');
    expect(tasksOf(row('installed_skill+api_action'))).toContain('no-token');
  });

  it('never hands it to an MCP treatment, which refuses it by design', () => {
    expect(tasksOf(row('fetched_skill+mcp_action'))).not.toContain('no-token');
    expect(tasksOf(row('installed_skill+mcp_action'))).not.toContain('no-token');
  });

  it('and every row can actually PLAN every task it names — the general form of the rule above', () => {
    for (const r of ROWS) {
      const mode = r.mode as EvalMode;
      const installed = installsSkills(mode);
      const transport = actionTransport(mode);
      for (const id of tasksOf(r)) {
        const task = byId.get(id)!;
        const start = needsStartDocument(task) ? { id: 'abc123', prompt: 'Help me edit my artifact at http://x.test/a/abc123 using this token: mx_paste' } : null;
        expect(
          () => planAccess({ task, base: 'http://x.test', start, credential: { token: 'mx_account' }, installed, transport }),
          `${r.mode} × ${id}`,
        ).not.toThrow();
      }
    }
  });
});

import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {EvalConfigSchema,TaskSchema} from '../lib/contracts';
import {discoverTasks} from '../lib/task-set';

/**
 * The JSON files an eval run is configured by are validated at load, so a typo
 * fails before a server boots. These pin the shape and the cross-references.
 */

const EVALS = path.resolve(__dirname, '..');
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(EVALS, rel), 'utf8'));

describe('tasks/*.json', () => {
  it('every task validates and lists at least one check', () => {
    const dir = path.join(EVALS, 'tasks');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toEqual(expect.arrayContaining(['scrolly.eval.json', 'report.eval.json', 'deck.eval.json', 'dashboard.eval.json', 'comment.json', 'data.json', 'edit.json', 'cli.json']));
    for (const f of files) {
      const task = TaskSchema.parse(read(`tasks/${f}`));
      expect(task.id).toBe(f.replace(/\.eval\.json$/, '').replace(/\.json$/, ''));
      expect(task.checks.length).toBeGreaterThan(0);
    }
  });

  it('an unknown check is refused', () => {
    expect(() => TaskSchema.parse({ id: 't', brief: 'x', checks: ['not_a_check'] })).toThrow();
  });

  it('a task that seeds a document says what must survive a targeted edit', () => {
    const edit = TaskSchema.parse(read('tasks/edit.json'));
    expect(edit.seed).toBeDefined();
    expect(edit.seed).toContain(edit.seedKeepText!);
  });

  it('a task declares no credential of its own — the mode authenticates every run', () => {
    for (const file of fs.readdirSync(path.join(EVALS, 'tasks'))) {
      const raw = read(`tasks/${file}`) as Record<string, unknown>;
      expect(Object.keys(raw), file).not.toContain('handoff');
    }
  });

  it('tasks do not choose transport, and every charted data task stages its own CSV', () => {
    expect(TaskSchema.parse(read('tasks/cli.json'))).not.toHaveProperty('transport');
    expect(Object.keys(TaskSchema.parse(read('tasks/data.json')).files!)).toEqual(['sales.csv']);
    expect(Object.keys(TaskSchema.parse(read('tasks/dashboard.eval.json')).files!)).toEqual(['support.csv']);
    expect(Object.keys(TaskSchema.parse(read('tasks/deck.eval.json')).files!)).toEqual(['onboarding.csv']);
    expect(Object.keys(TaskSchema.parse(read('tasks/report.eval.json')).files!)).toEqual(['coffee.csv']);
    for (const id of ['dashboard', 'deck', 'report', 'scrolly']) {
      const task = TaskSchema.parse(read(`tasks/${id}.eval.json`));
      // No kind of their own: they are `publish` tasks, which is what the
      // default means, and the dataset checks below are what makes them charted.
      expect(task.kind).toBe('publish');
      expect(task.checks).toEqual(expect.arrayContaining(['dataset_created', 'query_ran', 'chart_marks_drawn']));
    }
  });

  it('the comparison set covers each registered product template exactly once', () => {
    const tasks = ['deck', 'dashboard', 'report', 'scrolly'].map((id) => TaskSchema.parse(read(`tasks/${id}.eval.json`)));
    expect(tasks.map((task) => task.template)).toEqual(['deck', 'dashboard', 'editorial', 'scrolly']);
  });
});

describe('config.json', () => {
  it('validates, and describes only how a run behaves — never which legs exist', () => {
    const config = EvalConfigSchema.parse(read('config.json'));
    expect(config.capture.sizes).toEqual(['laptop', 'mobile']);
    expect(config.capture.renderers).toEqual(['export', 'playwright']);
    // The roster is the caller's business; nothing here names a harness or a model.
    expect(JSON.stringify(config)).not.toMatch(/claude|codex|opencode|\bpi\b/i);
  });

  /**
   * BOTH BOUNDS ARE REAL BOUNDS. The timeout is the ceiling for a process that has HUNG, and the turn
   * cap (`lib/spawn TurnCap`) is the one for a process that is looping. Fifteen minutes was neither: it
   * let a runaway spend a quarter of an hour of paid tokens under the three harnesses with no
   * `--max-turns` of their own, and it is the number to keep down. Five minutes was too tight the
   * other way: in run 34694871143 the slower harnesses (Pi, OpenCode) took 200–300 s on a document
   * task and were cut off one step from publishing, so the cap was scoring speed, not output.
   */
  it('bounds a run in minutes, not quarter-hours, and caps its turns', () => {
    const config = EvalConfigSchema.parse(read('config.json'));
    expect(config.run.timeoutMs).toBeLessThanOrEqual(600_000);
    // …and still above the slowest measured task (~300 s), so a slow model is not scored as a hang.
    expect(config.run.timeoutMs).toBeGreaterThanOrEqual(450_000);
    expect(config.run.maxTurns).toBeGreaterThan(0);
  });
});

describe('the brief title', () => {
  /**
   * A task that GATES `has_title` must say what a title IS.
   *
   * artifactbin has two different things an author can call a title: the document's
   * `<title>` (what a browser tab and a link preview show) and an on-page `<h1>`.
   * An agent told a document is "titled X" often writes the heading and leaves the
   * document titled `artifact` — which is exactly how the `mcp` smoke task failed
   * master while publishing correctly over MCP (9 writes, version 10, no title).
   *
   * The comparison briefs already learned this and each says WHERE the title shows
   * up — "what a browser tab and a shared link preview show". `mcp` said only
   * `titled "Hello over MCP"` and was the one that failed. The guard asserts the
   * idea, not one sentence: the briefs word it differently and are free to, but a
   * task may not GATE a title without telling the agent which title it means.
   */

  const tasks = discoverTasks(path.resolve(__dirname, '..', 'tasks'));

  describe('every task that gates has_title', () => {
    const gating = tasks.filter((t) => t.task.checks.includes('has_title'));

    it('there is at least one, or this guard is vacuous', () => {
      expect(gating.length).toBeGreaterThan(0);
    });

    it.each(gating.map((t) => t.id))('%s says where the title shows, so it cannot be read as the on-page heading', (id) => {
      const brief = gating.find((t) => t.id === id)!.task.brief;
      expect(brief.toLowerCase()).toContain('browser tab');
    });
  });
});

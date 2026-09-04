/**
 * The JSON files an eval run is configured by are validated at load, so a typo
 * fails before a server boots. These pin the shape and the cross-references.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EvalConfigSchema, TaskSchema } from '../lib/contracts';

const EVALS = path.resolve(__dirname, '..');
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(EVALS, rel), 'utf8'));

describe('tasks/*.json', () => {
  it('every task validates and lists at least one check', () => {
    const dir = path.join(EVALS, 'tasks');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toEqual(expect.arrayContaining(['scrolly.eval.json', 'report.eval.json', 'deck.eval.json', 'dashboard.eval.json', 'comment.json', 'data.json', 'edit.json', 'mcp.json']));
    for (const f of files) {
      const task = TaskSchema.parse(read(`tasks/${f}`));
      expect(task.id).toBe(f.replace(/\.eval\.json$/, '').replace(/\.json$/, ''));
      expect(task.checks.length).toBeGreaterThan(0);
    }
  });

  it('an unknown check is refused', () => {
    expect(() => TaskSchema.parse({ id: 't', brief: 'x', checks: ['not_a_check'] })).toThrow();
  });

  it('a token-handoff task that seeds a document says what must survive a targeted edit', () => {
    const edit = TaskSchema.parse(read('tasks/edit.json'));
    expect(edit.handoff).toBe('token');
    expect(edit.seed).toContain(edit.seedKeepText!);
  });

  it('tasks do not choose transport, and every charted data task stages its own CSV', () => {
    expect(TaskSchema.parse(read('tasks/mcp.json'))).not.toHaveProperty('transport');
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

});

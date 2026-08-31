/**
 * The run recorder writes the minusx row schema: one rows file per run, a
 * derived pass row per declared flow, meta.json once per run directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunRecorder, TASK_BRIEF } from '../lib/rows';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-rows-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('RunRecorder', () => {
  it('writes meta.json and a rows file named by the run id, with the pass row derived from finalize()', () => {
    const rec = new RunRecorder(dir, { label: 'claude-code · claude-opus-5', target: 'http://127.0.0.1:3101', harness: 'claude-code', model: 'claude-opus-5' }, 'protocol');
    rec.flow('protocol');
    rec.record('protocol', 'turns', 7);
    rec.record('protocol', 'cost_usd', 0.0123);
    rec.record('protocol', 'first_error', 'invalid_jsx', 'text');
    rec.record('protocol', 'published', true, 'pass');
    rec.finalize(false);

    expect(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))).toMatchObject({ label: 'claude-code · claude-opus-5', harness: 'claude-code' });
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'rows', 'protocol.json'), 'utf8')).rows;
    expect(rows).toContainEqual({ flow: 'protocol', metric: 'turns', value: 7, kind: 'number' });
    expect(rows).toContainEqual({ flow: 'protocol', metric: 'first_error', value: 'invalid_jsx', kind: 'text' });
    expect(rows).toContainEqual({ flow: 'protocol', metric: 'published', value: true, kind: 'pass' });
    expect(rows.at(-1)).toEqual({ flow: 'protocol', metric: 'pass', value: false, kind: 'pass' });
  });

  it('a flow declared before any work still gets its pass row when nothing else was recorded', () => {
    const rec = new RunRecorder(dir, { label: 'x', target: 't' }, 'report');
    rec.flow('report');
    rec.finalize(false);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'rows', 'report.json'), 'utf8')).rows;
    expect(rows).toEqual([{ flow: 'report', metric: 'pass', value: false, kind: 'pass' }]);
  });

  it('screenshot rows carry their variant and a path relative to the run dir under screens/', () => {
    const rec = new RunRecorder(dir, { label: 'x', target: 't' }, 'report');
    rec.flow('report');
    const rel = rec.screenshotPath('report', 'document', { size: 'mobile', renderer: 'export' });
    expect(rel).toBe('screens/report-document-mobile-export.png');
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'png');
    rec.image('report', 'document', rel, { size: 'mobile', renderer: 'export' });
    rec.finalize(true);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'rows', 'report.json'), 'utf8')).rows;
    expect(rows).toContainEqual({ flow: 'report', metric: 'document', value: rel, kind: 'image', variant: { size: 'mobile', renderer: 'export' } });
  });

  it('skips null values (telemetry unavailable) rather than writing a bogus 0', () => {
    const rec = new RunRecorder(dir, { label: 'x', target: 't' }, 'p');
    rec.flow('p');
    rec.record('p', 'cost_usd', null);
    rec.finalize(true);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'rows', 'p.json'), 'utf8')).rows;
    expect(rows.find((r: { metric: string }) => r.metric === 'cost_usd')).toBeUndefined();
  });

  it('records the brief a flow was given as its FIRST row, so the report section opens with what was asked', () => {
    const rec = new RunRecorder(dir, { label: 'x', target: 't' }, 'report');
    rec.flow('report', 'Write and publish a short one-page report.');
    rec.record('report', 'turns', 3);
    rec.finalize(true);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'rows', 'report.json'), 'utf8')).rows;
    expect(rows[0]).toEqual({ flow: 'report', metric: TASK_BRIEF, value: 'Write and publish a short one-page report.', kind: 'text' });
  });

  it('a flow declared with no brief records no brief row', () => {
    const rec = new RunRecorder(dir, { label: 'x', target: 't' }, 'report');
    rec.flow('report');
    rec.finalize(true);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'rows', 'report.json'), 'utf8')).rows;
    expect(rows.some((r: { metric: string }) => r.metric === TASK_BRIEF)).toBe(false);
  });

  it('re-declaring a flow neither duplicates its brief row nor its pass row', () => {
    const rec = new RunRecorder(dir, { label: 'x', target: 't' }, 'report');
    rec.flow('report', 'the brief');
    rec.flow('report', 'the brief');
    rec.finalize(true);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'rows', 'report.json'), 'utf8')).rows;
    expect(rows.filter((r: { metric: string }) => r.metric === TASK_BRIEF)).toHaveLength(1);
    expect(rows.filter((r: { metric: string }) => r.metric === 'pass')).toHaveLength(1);
  });
});

/**
 * A CI flow that fails gets one more turn and is NAMED when it passes there —
 * the gates' rule (scripts/gates.mjs), applied where the verdict is a model's
 * behaviour rather than a race. The comparison matrix never retries: its
 * numbers are the deliverable.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keepFirstAttempt, mergeSecondAttempt, planSecondAttempt, runSecondAttempts, verdictLine, type Outcome } from '../lib/second-attempt';
import type { Task } from '../lib/contracts';

const tasks = (...ids: string[]) => ids.map((id) => ({ id, kind: 'open', brief: '', checks: [] })) as unknown as Task[];

describe('planSecondAttempt', () => {
  it('retries only the failures, and only in CI', () => {
    const v: Outcome[] = [true, false, null, false];
    expect(planSecondAttempt(v, { ci: true, enabled: true }).indexes).toEqual([1, 3]);
    // The matrix is a measurement: re-rolling a column until it looks better is not a comparison.
    expect(planSecondAttempt(v, { ci: false, enabled: true }).indexes).toEqual([]);
    expect(planSecondAttempt(v, { ci: true, enabled: false }).indexes).toEqual([]);
  });
  it('never retries a flow that was deliberately not run, or one that passed', () => {
    expect(planSecondAttempt([null, true], { ci: true, enabled: true }).indexes).toEqual([]);
  });
  it('asks for nothing when everything passed', () => {
    expect(planSecondAttempt([true, true], { ci: true, enabled: true }).indexes).toEqual([]);
  });
});

describe('mergeSecondAttempt', () => {
  it('writes the second attempt over the first and names who moved', () => {
    const t = tasks('data', 'edit', 'mcp');
    const merged = mergeSecondAttempt(t, [false, true, false], new Map<number, Outcome>([[0, true], [2, false]]));
    expect(merged.verdicts).toEqual([true, true, false]);
    expect(merged.recovered).toEqual(['data']);
    expect(merged.failed).toEqual(['mcp']);
  });
  it('a flow that fails twice still fails', () => {
    const t = tasks('data');
    const merged = mergeSecondAttempt(t, [false], new Map<number, Outcome>([[0, false]]));
    expect(merged.failed).toEqual(['data']);
    expect(merged.recovered).toEqual([]);
  });
  it('leaves an untouched run exactly as it was', () => {
    const t = tasks('data', 'edit');
    const merged = mergeSecondAttempt(t, [true, null], new Map());
    expect(merged.verdicts).toEqual([true, null]);
    expect(merged.recovered).toEqual([]);
    expect(merged.failed).toEqual([]);
  });
});

describe('verdictLine', () => {
  it('says a retry out loud — a green that swallowed a flake is the failure mode here', () => {
    const t = tasks('data', 'edit');
    const merged = mergeSecondAttempt(t, [false, true], new Map<number, Outcome>([[0, true]]));
    expect(verdictLine(merged)).toBe('2/2 flows passed — FLAKY (passed on a second attempt): data');
  });
  it('reads exactly as before when nothing was retried', () => {
    expect(verdictLine(mergeSecondAttempt(tasks('data', 'edit'), [true, false], new Map()))).toBe('1/2 flows passed — FAILED: edit');
    expect(verdictLine(mergeSecondAttempt(tasks('data'), [true], new Map()))).toBe('1/1 flows passed');
  });
  it('a flow not run is out of the count, not counted as failed', () => {
    expect(verdictLine(mergeSecondAttempt(tasks('mcp'), [null], new Map()))).toBe('0/0 flows passed');
  });
});

describe('keepFirstAttempt', () => {
  const seed = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'second-attempt-'));
    fs.mkdirSync(path.join(dir, 'runs', 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'rows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'runs', 'data', 'transcript.jsonl'), 'first attempt');
    fs.writeFileSync(path.join(dir, 'rows', 'data.json'), '{"rows":[]}');
    fs.writeFileSync(path.join(dir, 'rows', 'edit.json'), '{"rows":["sibling"]}');
    return dir;
  };

  it('keeps the failed attempt\'s evidence and takes its scorecard OUT of rows/', () => {
    const dir = seed();
    keepFirstAttempt(dir, 'data');
    // The evidence survives, under a name the retry will not write to.
    expect(fs.readFileSync(path.join(dir, 'runs', 'data@1', 'transcript.jsonl'), 'utf8')).toBe('first attempt');
    expect(fs.readFileSync(path.join(dir, 'runs', 'data@1', 'rows.json'), 'utf8')).toBe('{"rows":[]}');
    // The report reduces `pass` across every rows file it finds for a flow with
    // every(...) — a losing scorecard left here would contradict the verdict.
    expect(fs.existsSync(path.join(dir, 'rows', 'data.json'))).toBe(false);
    // The retry writes this path afresh; it must be free.
    expect(fs.existsSync(path.join(dir, 'runs', 'data'))).toBe(false);
    // A sibling task is untouched.
    expect(fs.readFileSync(path.join(dir, 'rows', 'edit.json'), 'utf8')).toBe('{"rows":["sibling"]}');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is safe when there is nothing to keep, and when it has run before', () => {
    const dir = seed();
    keepFirstAttempt(dir, 'data');
    keepFirstAttempt(dir, 'data');
    expect(fs.existsSync(path.join(dir, 'runs', 'data@1'))).toBe(true);
    expect(() => keepFirstAttempt(dir, 'never-ran')).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * The LOOP, not the arithmetic. Both bugs this feature shipped with lived here —
 * a re-run that emptied the whole run directory, and a kept scorecard that made
 * the report contradict the verdict — and neither was visible to a test of the
 * pure helpers. The paid part is injected, so the fail-then-pass case that a
 * live agent cannot be made to perform on demand is exercised for real.
 */
describe('runSecondAttempts — the retry a flaky CI job actually performs', () => {
  const t = tasks('data', 'edit');
  const spy = () => { const kept: string[] = []; return { kept, keep: (_d: string, id: string) => { kept.push(id); } }; };

  it('a flow that fails then PASSES is green, named FLAKY, and its first attempt is kept', async () => {
    const k = spy();
    const ran: string[] = [];
    const merged = await runSecondAttempts(t, [false, true], {
      ci: true, enabled: true, outDir: '/nowhere', keep: k.keep,
      rerun: async (task) => { ran.push(task.id); return true; },
    });
    expect(ran).toEqual(['data']);          // only the failure is re-run — the passing flow is not paid for twice
    expect(k.kept).toEqual(['data']);       // and its evidence is moved aside BEFORE the retry overwrites the path
    expect(merged.verdicts).toEqual([true, true]);
    expect(merged.failed).toEqual([]);      // so the job goes green
    expect(merged.recovered).toEqual(['data']);
    expect(verdictLine(merged)).toBe('2/2 flows passed — FLAKY (passed on a second attempt): data');
  });

  it('a flow that fails TWICE stays red and is not called flaky', async () => {
    const merged = await runSecondAttempts(t, [false, true], {
      ci: true, enabled: true, outDir: '/nowhere', keep: spy().keep, rerun: async () => false,
    });
    expect(merged.failed).toEqual(['data']);
    expect(merged.recovered).toEqual([]);
    expect(verdictLine(merged)).toBe('1/2 flows passed — FAILED: data');
  });

  it('announces every retry — a turn spent silently is the failure mode this exists to avoid', async () => {
    const said: string[] = [];
    await runSecondAttempts(t, [false, false], {
      ci: true, enabled: true, outDir: '/nowhere', keep: spy().keep,
      announce: (task) => said.push(task.id), rerun: async () => true,
    });
    expect(said).toEqual(['data', 'edit']);
  });

  it('spends nothing and keeps nothing when it is off, or outside CI', async () => {
    for (const opts of [{ ci: false, enabled: true }, { ci: true, enabled: false }]) {
      const k = spy();
      let calls = 0;
      const merged = await runSecondAttempts(t, [false, true], {
        ...opts, outDir: '/nowhere', keep: k.keep, rerun: async () => { calls += 1; return true; },
      });
      expect(calls).toBe(0);
      expect(k.kept).toEqual([]);
      expect(merged.verdicts).toEqual([false, true]);   // the measured verdict stands untouched
      expect(merged.failed).toEqual(['data']);
    }
  });

  it('keeps the real artifacts through a genuine fail-then-pass', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'second-attempt-run-'));
    fs.mkdirSync(path.join(dir, 'runs', 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'rows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'runs', 'data', 'transcript.jsonl'), 'the failed attempt');
    fs.writeFileSync(path.join(dir, 'rows', 'data.json'), '{"failed":true}');
    const merged = await runSecondAttempts(tasks('data'), [false], {
      ci: true, enabled: true, outDir: dir,
      rerun: async () => { fs.mkdirSync(path.join(dir, 'runs', 'data'), { recursive: true }); fs.writeFileSync(path.join(dir, 'rows', 'data.json'), '{"failed":false}'); return true; },
    });
    expect(merged.recovered).toEqual(['data']);
    // ONE scorecard per flow in rows/, and it is the winning one: the report reduces
    // `pass` with every(...), so a losing sibling here would contradict this verdict.
    expect(fs.readdirSync(path.join(dir, 'rows'))).toEqual(['data.json']);
    expect(fs.readFileSync(path.join(dir, 'rows', 'data.json'), 'utf8')).toBe('{"failed":false}');
    // The flake is still readable.
    expect(fs.readFileSync(path.join(dir, 'runs', 'data@1', 'transcript.jsonl'), 'utf8')).toBe('the failed attempt');
    expect(fs.readFileSync(path.join(dir, 'runs', 'data@1', 'rows.json'), 'utf8')).toBe('{"failed":true}');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

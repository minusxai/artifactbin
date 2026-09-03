/**
 * The baseline probe: what a leg costs before it has done anything.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BASELINE_FLOW, BASELINE_PROMPT, BASELINE_ROWS_ID, measureBaseline } from '../lib/baseline';
import { planMode } from '../lib/mode';
import { RunRecorder } from '../lib/rows';
import { collectRun } from '../lib/report';
import type { HarnessAdapter } from '../lib/contracts';
import type { Leg } from '../lib/leg';

const leg: Leg = {
  harness: 'pi', model: 'm', envVar: 'SOME_API_KEY', apiKey: 'k', label: 'pi',
  price: null, vision: true, mode: planMode('pi', 'fetched_skill+api_action'),
};

/** A harness that answers instantly, so the probe's own plumbing is what is under test. */
const fake = (stdout: string): HarnessAdapter => ({
  harness: 'pi',
  supportsMcp: false,
  async prepare() {},
  invocation() { return { argv: ['node', '-e', `process.stdout.write(${JSON.stringify(stdout)})`], env: {}, unsetEnv: [] }; },
  reduce() {
    return { ok: true, error: null, turns: 1, toolCalls: 0, docsReadCalls: 0, invocations: [], reportedCostUsd: 0.0031, webSearchCalls: null, finalMessage: 'OK',
             tokens: { input: 20, cacheWrite: 18000, cacheRead: 2169, output: 5 } };
  },
});

describe('measureBaseline', () => {
  it('runs one turn that does nothing, and reports what that cost', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-'));
    const b = await measureBaseline({ leg, adapter: fake('{}'), apiKey: 'k', dir, timeoutMs: 20_000 });
    expect(b.ok).toBe(true);
    expect(b.turns).toBe(1);
    // tokens_in is the same sum the task rows use: input + cache read + cache write.
    expect(b.tokensIn).toBe(20 + 2169 + 18000);
    expect(b.tokensOut).toBe(5);
    expect(b.costUsd).toBe(0.0031);
  });

  it('asks for nothing that could do work — no tools, no files', () => {
    expect(BASELINE_PROMPT).toMatch(/do not use any tool/i);
    expect(BASELINE_PROMPT).toMatch(/not read or write any file/i);
  });

  it('gives the probe its own directory, so it cannot see a task\'s files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-'));
    await measureBaseline({ leg, adapter: fake('{}'), apiKey: 'k', dir, timeoutMs: 20_000 });
    expect(fs.existsSync(path.join(dir, 'cwd'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'home'))).toBe(true);
  });
});

describe('where the baseline lands in the report', () => {
  /**
   * Flows are ordered by the filename their rows were written under
   * (`collectRun` sorts the directory), so the id is what puts the baseline at
   * the TOP — which is the whole point of measuring it.
   */
  it('opens the report: its rows file sorts before every task id', () => {
    for (const task of ['dashboard', 'data', 'deck', 'edit', 'mcp', 'report', 'scrolly']) {
      expect([BASELINE_ROWS_ID, task].sort()[0]).toBe(BASELINE_ROWS_ID);
    }
  });

  /**
   * An empty run is not a task, so it must not join the pass count — otherwise
   * a clean four-task leg reports 4/5.
   */
  it('is recorded without a pass row, so it never becomes part of "4/4 passed"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-rows-'));
    const rec = new RunRecorder(dir, { label: 'l', target: 't' }, BASELINE_ROWS_ID);
    rec.flow(BASELINE_FLOW, undefined, { graded: false });
    rec.record(BASELINE_FLOW, 'tokens_in', 20189);
    rec.finalize(true);
    const rows = collectRun(dir).rows;
    expect(rows.find((r) => r.metric === 'tokens_in')?.value).toBe(20189);
    expect(rows.some((r) => r.metric === 'pass')).toBe(false);
  });
});

/**
 * EVERY HARNESS IS BOUNDED BY THE DRIVER.
 *
 * `config.run.maxTurns` was a flag on one CLI. `claude -p` takes `--max-turns`; `codex exec --help`,
 * `pi --help` and `opencode run --help` document nothing like it, so a looping agent under those three
 * ran until the wall clock — fifteen minutes of paid tokens for a loop that was never going to finish.
 * The driver now counts each harness's own step events off the stream and kills the process tree when
 * the count passes the cap (`lib/spawn TurnCap`, `HarnessAdapter.countsAsTurn`).
 *
 * Two things are proved here, per adapter:
 *
 *  1. THE PREDICATE IS THE REDUCER'S OWN COUNT, checked against real recorded output. If the two ever
 *     disagreed, the `turns` in the report and the number the cap watches would be different numbers
 *     wearing one name.
 *  2. THE CAP FIRES, through the real spawn path, on a process that would otherwise keep running.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInvocation } from '../lib/spawn';
import { adapterFor } from '../lib/harness';
import type { Harness, HarnessAdapter } from '../lib/contracts';

const fx = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const countTurns = (adapter: HarnessAdapter, stream: string) =>
  stream.split('\n').filter((line) => line && adapter.countsAsTurn(line)).length;

/** One line of each harness's real stream that IS a step of the agent's loop. */
const TURN_LINE: Record<Harness, string> = {
  'claude-code': JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking' }] } }),
  codex: JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'thinking' } }),
  pi: JSON.stringify({ type: 'turn_end', message: { role: 'assistant' } }),
  opencode: JSON.stringify({ type: 'step_finish', part: { tokens: { input: 1, output: 1 } } }),
};

/** …and one that is NOT: a line the harness emits between steps, which must never advance the count. */
const NOISE_LINE: Record<Harness, string> = {
  'claude-code': JSON.stringify({ type: 'stream_event', event: { delta: { text: 'a' } } }),
  codex: JSON.stringify({ type: 'item.started', item: { id: 'item_0', type: 'agent_message' } }),
  pi: JSON.stringify({ type: 'message_update', message: { role: 'assistant' } }),
  opencode: JSON.stringify({ type: 'step_start', part: { id: 'prt_1' } }),
};

describe('countsAsTurn is the same count reduce() reports, on real recorded output', () => {
  it('codex: assistant items, over the deck run it actually made', () => {
    const stream = fx('codex.deck.jsonl');
    expect(countTurns(adapterFor('codex'), stream)).toBe(adapterFor('codex').reduce(stream).turns);
    // …and it is a real number, not two zeroes agreeing with each other.
    expect(adapterFor('codex').reduce(stream).turns).toBeGreaterThan(1);
  });

  it('codex: the one-turn stream too', () => {
    const stream = fx('codex.events.jsonl');
    expect(countTurns(adapterFor('codex'), stream)).toBe(adapterFor('codex').reduce(stream).turns);
  });

  it('pi: turn_end, over the recorded stream', () => {
    const stream = fx('pi.events.jsonl');
    expect(countTurns(adapterFor('pi'), stream)).toBe(adapterFor('pi').reduce(stream).turns);
    expect(adapterFor('pi').reduce(stream).turns).toBeGreaterThan(0);
  });

  it('opencode: step_finish, over the recorded stream', () => {
    const stream = fx('opencode.events.jsonl');
    expect(countTurns(adapterFor('opencode'), stream)).toBe(adapterFor('opencode').reduce(stream).turns);
    expect(adapterFor('opencode').reduce(stream).turns).toBeGreaterThan(0);
  });

  /**
   * Claude is the one adapter where the two numbers are not equal BY DESIGN: `num_turns` on its result
   * line also counts the user turns that carry tool results, so the driver's count of assistant
   * messages is the smaller of the two. That is what a backstop wants — `--max-turns` stops the run
   * first, and the driver only fires if it did not.
   */
  it('claude-code: assistant messages, never more than the num_turns it reports', () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      TURN_LINE['claude-code'],
      NOISE_LINE['claude-code'],
      TURN_LINE['claude-code'],
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, result: 'done' }),
    ].join('\n');
    const counted = countTurns(adapterFor('claude-code'), stream);
    expect(counted).toBe(2);
    expect(counted).toBeLessThanOrEqual(adapterFor('claude-code').reduce(stream).turns!);
  });

  it('nothing between the steps counts — a partial message is not a turn', () => {
    for (const harness of Object.keys(TURN_LINE) as Harness[]) {
      const adapter = adapterFor(harness);
      expect(adapter.countsAsTurn(TURN_LINE[harness]), harness).toBe(true);
      expect(adapter.countsAsTurn(NOISE_LINE[harness]), harness).toBe(false);
      expect(adapter.countsAsTurn('not json at all'), harness).toBe(false);
      expect(adapter.countsAsTurn(''), harness).toBe(false);
    }
  });
});

describe('the cap fires — for every harness, through the real spawn path', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-cap-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const paths = () => ({ stdoutPath: path.join(dir, 'transcript.jsonl'), stderrPath: path.join(dir, 'stderr.log') });

  /** A harness that will not stop: it emits step after step and then holds the process open. */
  const runaway = (harness: Harness, lines = 12) => {
    const script = `const l=${JSON.stringify(TURN_LINE[harness])},n=${JSON.stringify(NOISE_LINE[harness])};`
      + `let i=0;const t=setInterval(()=>{console.log(n);console.log(l);if(++i>=${lines})clearInterval(t);},10);`
      + 'setTimeout(()=>{},60000)';
    const adapter = adapterFor(harness);
    return runInvocation(
      { argv: ['node', '-e', script], env: {}, unsetEnv: [], ...(adapter.keepLine ? { keepLine: (l: string) => adapter.keepLine!(l) } : {}) },
      {
        cwd: dir, baseEnv: process.env, timeoutMs: 30_000, ...paths(),
        turnCap: { maxTurns: 3, countsAsTurn: (line) => adapter.countsAsTurn(line) },
      },
    );
  };

  for (const harness of Object.keys(TURN_LINE) as Harness[]) {
    it(`${harness}: killed once it goes past the cap, and it is NOT reported as a timeout`, async () => {
      const r = await runaway(harness);
      expect(r.turnCapped).toBe(true);
      // Strictly past the cap: the kill fires on the turn AFTER the allowance, so a run that used
      // exactly its allowance keeps the result event the reducer needs.
      expect(r.turns).toBe(4);
      // A runaway is structural, not slow: the wall clock was 30 s and nothing came near it.
      expect(r.timedOut).toBe(false);
      expect(r.durationMs).toBeLessThan(30_000);
      // The tree is gone rather than left running — SIGKILL, so there is no exit code.
      expect(r.exitCode).toBeNull();
    });
  }

  it('a run that stays inside the cap is untouched, and its turns are counted anyway', async () => {
    const adapter = adapterFor('pi');
    const script = `console.log(${JSON.stringify(TURN_LINE.pi)});console.log(${JSON.stringify(TURN_LINE.pi)});`;
    const r = await runInvocation({ argv: ['node', '-e', script], env: {}, unsetEnv: [] }, {
      cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths(),
      turnCap: { maxTurns: 3, countsAsTurn: (line) => adapter.countsAsTurn(line) },
    });
    expect(r.turnCapped).toBe(false);
    expect(r.turns).toBe(2);
    expect(r.exitCode).toBe(0);
  });

  it('a run that spends EXACTLY its allowance is not killed — the last turn is the one that finishes', async () => {
    const adapter = adapterFor('pi');
    const line = JSON.stringify(TURN_LINE.pi);
    const r = await runInvocation({ argv: ['node', '-e', `for(let i=0;i<3;i++)console.log(${line});`], env: {}, unsetEnv: [] }, {
      cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths(),
      turnCap: { maxTurns: 3, countsAsTurn: (line) => adapter.countsAsTurn(line) },
    });
    expect(r.turns).toBe(3);
    expect(r.turnCapped).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  it('no cap asked for, no cap applied — the count is still reported', async () => {
    const line = JSON.stringify(TURN_LINE.pi);
    const r = await runInvocation({ argv: ['node', '-e', `for(let i=0;i<9;i++)console.log(${line});`], env: {}, unsetEnv: [] }, {
      cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths(),
    });
    expect(r.turnCapped).toBe(false);
    expect(r.turns).toBe(0);
    expect(r.exitCode).toBe(0);
  });
});

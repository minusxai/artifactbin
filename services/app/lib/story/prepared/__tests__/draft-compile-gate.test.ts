import { describe, expect, it } from 'vitest';
import { createDraftCompileGate } from '../draft-compile-gate';
import { createDraftCompilePool } from '../draft-compile-pool';
import type { PrepareStoryInput } from '../prepare-runtime.server';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const after = <T>(ms: number, value: T) => () => sleep(ms).then(() => value);

describe('the draft compile gate', () => {
  it('answers older drafts of a session superseded at once and compiles the newest', async () => {
    const gate = createDraftCompileGate({ concurrency: 2, waitMs: 2_000 });
    let runs = 0;
    const work = (v: string) => () => { runs++; return sleep(50).then(() => v); };
    const first = gate.run(gate.arrive('s'), work('a'));
    await sleep(10); // `a` is running
    const second = gate.run(gate.arrive('s'), work('b'));
    const third = gate.run(gate.arrive('s'), work('c'));
    const answered = await Promise.race([first, sleep(20).then(() => 'late')]);
    expect(answered).toEqual({ ok: false, reason: 'superseded' });
    expect(await second).toEqual({ ok: false, reason: 'superseded' });
    expect(await third).toEqual({ ok: true, value: 'c' });
    expect(runs).toBe(2); // `a` ran to its end with its result dropped; `b` never ran
  });

  it('supersedes a draft that a newer one overtook before reaching the gate', async () => {
    const gate = createDraftCompileGate({ concurrency: 1, waitMs: 2_000 });
    const older = gate.arrive('s');
    const newer = gate.arrive('s');
    expect(await gate.run(older, after(1, 'old'))).toEqual({ ok: false, reason: 'superseded' });
    expect(await gate.run(newer, after(1, 'new'))).toEqual({ ok: true, value: 'new' });
  });

  it('runs one compile per session and at most `concurrency` across sessions, answering busy past the wait', async () => {
    const gate = createDraftCompileGate({ concurrency: 1, waitMs: 100 });
    const a = gate.run(gate.arrive('a'), after(300, 'a'));
    await sleep(10);
    const b = gate.run(gate.arrive('b'), after(1, 'b'));
    expect(await b).toEqual({ ok: false, reason: 'busy' });
    expect(await a).toEqual({ ok: true, value: 'a' });
    expect(await gate.run(gate.arrive('b'), after(1, 'b2'))).toEqual({ ok: true, value: 'b2' });
  });

  it('fails only the caller of a failed compile', async () => {
    const gate = createDraftCompileGate({ concurrency: 1, waitMs: 1_000 });
    await expect(gate.run(gate.arrive('s'), () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await gate.run(gate.arrive('s'), after(1, 'ok'))).toEqual({ ok: true, value: 'ok' });
  });
});

describe('the draft compile pool', () => {
  it('compiles on worker threads while the request thread keeps answering', async () => {
    const pool = createDraftCompilePool({ url: new URL('./spin-worker.mjs', import.meta.url), workers: 2 });
    const input = (source: string, ms: number) => ({ source, title: String(ms) }) as unknown as PrepareStoryInput;
    try {
      await pool.compile(input('warm', 1));
      let maxGap = 0;
      let last = performance.now();
      const ticker = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 10);
      const started = performance.now();
      const html = await Promise.all([pool.compile(input('one', 400)), pool.compile(input('two', 400))]);
      clearInterval(ticker);
      expect(html).toEqual(['<p>one</p>', '<p>two</p>']);
      expect(performance.now() - started).toBeLessThan(750); // in parallel, not one after the other
      expect(maxGap).toBeLessThan(100); // the event loop never stalled behind a compile
      await expect(pool.compile(input('fail', 1))).rejects.toThrow('draft source is incomplete');
    } finally {
      await pool.close();
    }
  });
});

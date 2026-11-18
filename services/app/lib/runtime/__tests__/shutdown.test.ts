/**
 * lib/shutdown.ts: the steps run in order on the first signal, exit is called
 * once, a second signal is ignored, a throwing step does not stop the rest.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installShutdown } from '..';

const fakeProcess = () => {
  const emitter = new EventEmitter();
  const exit = vi.fn();
  return { emitter, process: { once: emitter.once.bind(emitter) as NodeJS.Process['once'], exit: exit as unknown as NodeJS.Process['exit'] }, exit };
};

describe('installShutdown', () => {
  it('runs the steps in order on SIGTERM, then exits 0 exactly once — even under a second signal', async () => {
    const { emitter, process, exit } = fakeProcess();
    const order: string[] = [];
    // The first step's own work is held until both signals have arrived; the returned close is the run they started.
    let finish!: () => void;
    const work = new Promise<void>((resolve) => { finish = resolve; });
    const close = installShutdown({
      process,
      steps: [
        async () => { await work; order.push('flush events'); },
        async () => { order.push('close listener'); },
      ],
    });
    emitter.emit('SIGTERM');
    emitter.emit('SIGINT');
    expect(order).toEqual([]);
    finish();
    await close();
    expect(order).toEqual(['flush events', 'close listener']);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
  it('a throwing step is logged and the next step still runs; the returned close is the same idempotent path', async () => {
    const { process, exit } = fakeProcess();
    const log = vi.fn();
    const ran: string[] = [];
    const close = installShutdown({
      process,
      log,
      steps: [async () => { throw new Error('flush failed'); }, async () => { ran.push('listener'); }],
    });
    await close();
    await close();
    expect(ran).toEqual(['listener']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

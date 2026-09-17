/**
 * lib/shutdown.ts: the steps run in order on the first signal, exit is called
 * once, a second signal is ignored, a throwing step does not stop the rest.
 *
 * Seeded RED by the orchestrator.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installShutdown } from '@/lib/shutdown';

const fakeProcess = () => {
  const emitter = new EventEmitter();
  const exit = vi.fn();
  return { emitter, process: { once: emitter.once.bind(emitter) as NodeJS.Process['once'], exit: exit as unknown as NodeJS.Process['exit'] }, exit };
};
const tick = () => new Promise((r) => setTimeout(r, 30));

describe('installShutdown', () => {
  it('runs the steps in order on SIGTERM, then exits 0 exactly once — even under a second signal', async () => {
    const { emitter, process, exit } = fakeProcess();
    const order: string[] = [];
    installShutdown({
      process,
      steps: [
        async () => { await tick(); order.push('flush events'); },
        async () => { order.push('close listener'); },
      ],
    });
    emitter.emit('SIGTERM');
    emitter.emit('SIGINT');
    await tick(); await tick();
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

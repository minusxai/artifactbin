import { describe, expect, it } from 'vitest';
import { createSessionRequestQueue } from '../src/session-request-queue';

describe('session request backpressure', () => {
  it('queues page-load bursts, bounds active work, and drains in arrival order', async () => {
    const queue = createSessionRequestQueue(2, 3);
    const releases: (() => void)[] = [];
    const started: number[] = [];
    const jobs = Array.from({ length: 5 }, (_, index) => queue.run(async () => {
      started.push(index);
      await new Promise<void>(resolve => releases.push(resolve));
    }));
    expect(started).toEqual([0, 1]);
    await expect(queue.run(async () => {})).rejects.toThrow('Request queue limit exceeded');
    releases.shift()!();
    await jobs[0];
    expect(started).toEqual([0, 1, 2]);
    queue.close();
    const queued = Promise.allSettled(jobs.slice(3));
    releases.splice(0).forEach(release => release());
    await Promise.all(jobs.slice(0, 3));
    expect(await queued).toMatchObject([{ status: 'rejected' }, { status: 'rejected' }]);
    await expect(queue.run(async () => {})).rejects.toThrow('Session closed');
  });
});

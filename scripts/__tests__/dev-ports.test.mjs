import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextAvailableDevelopmentPair, portIsAvailable, unavailableDevelopmentPorts } from '../lib/dev-ports.mjs';

describe('development port preflight', () => {
  let occupied;
  let blocker;

  beforeAll(async () => {
    blocker = net.createServer();
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, () => {
        const address = blocker.address();
        occupied = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => blocker.close(() => resolve()));
  });

  it('finds an occupied app or HMR socket and suggests a free adjacent pair', async () => {
    expect(await portIsAvailable(occupied)).toBe(false);
    expect(await unavailableDevelopmentPorts(occupied, occupied)).toEqual([occupied]);
    const pair = await nextAvailableDevelopmentPair(occupied);
    expect(pair).not.toBeNull();
    expect(pair.hmrPort).toBe(pair.appPort + 1);
    expect(await unavailableDevelopmentPorts(pair.appPort, pair.hmrPort)).toEqual([]);
  });
});

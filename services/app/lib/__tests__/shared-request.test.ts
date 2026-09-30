import { expect, it, vi } from 'vitest';
import { forgetShared, primeShared, sharedRequest } from '../shared-request';

it('shares one request between concurrent askers, honours the ttl, and refetches after a forget or force', async () => {
  const run = vi.fn(async () => ({ n: run.mock.calls.length }));
  const [a, b, c] = await Promise.all([sharedRequest('k', run, { ttl: 1000 }), sharedRequest('k', run, { ttl: 1000 }), sharedRequest('k', run, { force: true })]);
  expect(run).toHaveBeenCalledTimes(1);
  expect([a, b, c]).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }]);
  await sharedRequest('k', run, { ttl: 1000 });
  expect(run).toHaveBeenCalledTimes(1);
  await sharedRequest('k', run, { ttl: 1000, force: true });
  expect(run).toHaveBeenCalledTimes(2);
  forgetShared('k');
  await sharedRequest('k', run, { ttl: 1000 });
  expect(run).toHaveBeenCalledTimes(3);
  primeShared('k', { n: 99 });
  expect(await sharedRequest('k', run, { ttl: 1000 })).toEqual({ n: 99 });
  expect(run).toHaveBeenCalledTimes(3);
});

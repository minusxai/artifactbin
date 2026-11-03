import { afterEach, expect, it, vi } from 'vitest';
import { SERVING_POOL } from '@artifactbin/utils';
import { eventsPool } from '../src/index';

let pool: ReturnType<typeof eventsPool> | undefined;
afterEach(async () => { await pool?.end(); pool = undefined; });

it('opens a small bounded pool: five connections and the serving timeouts', () => {
  pool = eventsPool('postgresql://events@127.0.0.1:1/events');
  const { connectionString, ...options } = pool.options as unknown as Record<string, unknown>;
  expect(connectionString).toBe('postgresql://events@127.0.0.1:1/events');
  expect(options).toMatchObject({ ...SERVING_POOL, max: 5 });
});

it('logs a lost idle connection instead of crashing the process', () => {
  pool = eventsPool('postgresql://events@127.0.0.1:1/events');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(pool.listenerCount('error')).toBe(1);
  expect(() => pool!.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
  expect(log).toHaveBeenCalledWith('[db] idle connection lost:', 'terminating connection due to administrator command');
  log.mockRestore();
});

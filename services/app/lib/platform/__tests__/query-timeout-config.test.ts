/** The operator read budget fails at boot instead of silently producing an unbounded timer. */
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it('defaults the application read timeout to 30 seconds', async () => {
  vi.resetModules(); vi.stubEnv('SQL__QUERY_TIMEOUT_MS', undefined);
  const config = await import('../config');
  expect(config.QUERY_TIMEOUT_MS).toBe(30_000);
  expect(config.SQL_READ_WALL_TIMEOUT_MS).toBe(45_000);
  expect(config.SQL_MUTATION_TIMEOUT_MS).toBe(5_000);
});
it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '120001', '9007199254740992'])('refuses malformed or excessive SQL__QUERY_TIMEOUT_MS=%s', async value => {
  vi.resetModules(); vi.stubEnv('SQL__QUERY_TIMEOUT_MS', value);
  await expect(import('../config')).rejects.toThrow(/SQL__QUERY_TIMEOUT_MS/);
});

it('keeps the write cap at 5 seconds whatever the read cap is', async () => {
  vi.resetModules(); vi.stubEnv('SQL__QUERY_TIMEOUT_MS', '7000');
  const config = await import('../config');
  expect(config.QUERY_TIMEOUT_MS).toBe(7000);
  expect(config.SQL_READ_WALL_TIMEOUT_MS).toBe(22000);
  expect(config.SQL_MUTATION_TIMEOUT_MS).toBe(5_000);
});

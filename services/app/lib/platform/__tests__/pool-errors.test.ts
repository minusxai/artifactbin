import { expect, it, vi } from 'vitest';
import pg from 'pg';
import { SERVING_POOL, withPoolErrors } from '../db';

// An idle client's error during a database restart or failover must not take the process down.
it('a lost idle connection is logged, not thrown', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const pool = withPoolErrors(new pg.Pool({ ...SERVING_POOL }));
  expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
  expect(log).toHaveBeenCalledWith('[db] idle connection lost:', 'terminating connection due to administrator command');
  log.mockRestore();
});

it('the serving pool fails fast instead of queueing forever', () => {
  expect(SERVING_POOL.connectionTimeoutMillis).toBeGreaterThan(0);
  expect(SERVING_POOL.statement_timeout).toBeGreaterThan(0);
});

it('the serving pool bounds idle transactions (30 s) and lock waits (10 s) and keeps the 60 s statement timeout', () => {
  expect(SERVING_POOL.idle_in_transaction_session_timeout).toBe(30_000);
  expect(SERVING_POOL.lock_timeout).toBe(10_000);
  expect(SERVING_POOL.statement_timeout).toBe(60_000);
});

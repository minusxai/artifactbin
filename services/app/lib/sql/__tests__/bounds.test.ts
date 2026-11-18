/**
 * THE CALLER MAY ASK FOR LESS, NEVER FOR MORE.
 *
 * `limit` and `timeoutMs` come from the caller. In-process that is the
 * app talking to itself; behind `SQL__SERVICE_URL` the same fields arrive in a
 * REQUEST BODY, and "hold this connection open for an hour" is then something
 * a caller can simply ask for (CodeQL js/resource-exhaustion, twice — the read
 * timer and the write timer). The bound is the configured ceiling, applied in
 * the engine so both shapes and both statements get it from one place.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ROWS_LIMIT, QUERY_TIMEOUT_MS } from '@/lib/platform';
import { queryBounds } from '../engine';

describe('queryBounds', () => {
  it('bounds a WINDOW the same way — a page is a caller-supplied limit too', () => {
    expect(queryBounds({ limit: 50 }, { limit: MAX_ROWS_LIMIT * 4 }).limit).toBe(MAX_ROWS_LIMIT);
    expect(queryBounds({ limit: 50 }, { limit: 20 }).limit).toBe(20);
  });

  it('defaults to the configured ceilings', () => {
    expect(queryBounds({})).toEqual({ limit: MAX_ROWS_LIMIT, timeoutMs: QUERY_TIMEOUT_MS });
  });

  it('honours a SMALLER request', () => {
    expect(queryBounds({ limit: 5, timeoutMs: 250 })).toEqual({ limit: 5, timeoutMs: 250 });
  });

  it('clamps a larger one to the ceiling', () => {
    expect(queryBounds({ limit: MAX_ROWS_LIMIT * 10, timeoutMs: 60 * 60_000 }))
      .toEqual({ limit: MAX_ROWS_LIMIT, timeoutMs: QUERY_TIMEOUT_MS });
  });

  it('preserves existing row-limit normalization separately from strict deadlines', () => {
    expect(queryBounds({ limit: 0 })).toEqual({ limit: 1, timeoutMs: QUERY_TIMEOUT_MS });
    expect(queryBounds({ limit: -3 })).toEqual({ limit: 1, timeoutMs: QUERY_TIMEOUT_MS });
    expect(queryBounds({ limit: 2.7 })).toEqual({ limit: 2, timeoutMs: QUERY_TIMEOUT_MS });
    expect(queryBounds({ limit: Number.NaN }))
      .toEqual({ limit: MAX_ROWS_LIMIT, timeoutMs: QUERY_TIMEOUT_MS });
  });
  it.each([0,-1,2.7,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])('rejects malformed timeout %s rather than silently repairing it',timeoutMs=>{
    expect(()=>queryBounds({timeoutMs})).toThrow(/timeoutMs/);
  });
});

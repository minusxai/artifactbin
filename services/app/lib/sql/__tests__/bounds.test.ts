/**
 * THE CALLER MAY ASK FOR LESS, NEVER FOR MORE.
 *
 * `limit` and `timeoutMs` used to be taken as given. In-process that was the
 * app talking to itself; behind `SQL__SERVICE_URL` the same fields arrive in a
 * REQUEST BODY, and "hold this connection open for an hour" is then something
 * a caller can simply ask for (CodeQL js/resource-exhaustion, twice — the read
 * timer and the write timer). The bound is the configured ceiling, applied in
 * the engine so both shapes and both statements get it from one place.
 */
import { describe, expect, it } from 'vitest';
import { MAX_QUERY_ROWS, QUERY_TIMEOUT_MS } from '@/lib/config';
import { queryBounds } from '../engine';

describe('queryBounds', () => {
  it('bounds a WINDOW the same way — a page is a caller-supplied limit too', () => {
    expect(queryBounds({ limit: 50 }, { limit: MAX_QUERY_ROWS * 4 }).limit).toBe(MAX_QUERY_ROWS);
    expect(queryBounds({ limit: 50 }, { limit: 20 }).limit).toBe(20);
  });

  it('defaults to the configured ceilings', () => {
    expect(queryBounds({})).toEqual({ limit: MAX_QUERY_ROWS, timeoutMs: QUERY_TIMEOUT_MS });
  });

  it('honours a SMALLER request', () => {
    expect(queryBounds({ limit: 5, timeoutMs: 250 })).toEqual({ limit: 5, timeoutMs: 250 });
  });

  it('clamps a larger one to the ceiling', () => {
    expect(queryBounds({ limit: MAX_QUERY_ROWS * 10, timeoutMs: 60 * 60_000 }))
      .toEqual({ limit: MAX_QUERY_ROWS, timeoutMs: QUERY_TIMEOUT_MS });
  });

  it('refuses nonsense: zero, negative, fractional and NaN all land on something usable', () => {
    expect(queryBounds({ limit: 0, timeoutMs: 0 })).toEqual({ limit: 1, timeoutMs: 1 });
    expect(queryBounds({ limit: -3, timeoutMs: -1 })).toEqual({ limit: 1, timeoutMs: 1 });
    expect(queryBounds({ limit: 2.7, timeoutMs: 2.7 })).toEqual({ limit: 2, timeoutMs: 2 });
    expect(queryBounds({ limit: Number.NaN, timeoutMs: Number.NaN }))
      .toEqual({ limit: MAX_QUERY_ROWS, timeoutMs: QUERY_TIMEOUT_MS });
  });
});

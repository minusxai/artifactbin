import { describe, expect, it } from 'vitest';
import { resolveHmrPort } from '@/lib/config';

describe('resolveHmrPort — Vite HMR websocket port beside the app port', () => {
  it('defaults to the app port + 1, so two checkouts never share Vite\'s 24678', () => {
    expect(resolveHmrPort(undefined, 3050)).toBe(3051);
    expect(resolveHmrPort('', 3030)).toBe(3031);
  });
  it('honours an explicit APP__HMR_PORT', () => {
    expect(resolveHmrPort('24999', 3050)).toBe(24999);
  });
  it('falls back to the default on a value that is not a port', () => {
    expect(resolveHmrPort('abc', 3050)).toBe(3051);
    expect(resolveHmrPort('0', 3050)).toBe(3051);
  });
});

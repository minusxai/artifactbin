/**
 * ENV READS ARE AUDITED. `env()` records every name asked for so that a
 * misspelt name (AUTH__SECERT) shows up as UNKNOWN at boot instead of silently
 * unset — which only works if every package reads its env EAGERLY at
 * construction, never lazily.
 */
import { describe, expect, it } from 'vitest';
import { createEnv } from '@artifactbin/utils';

describe('createEnv', () => {
  const source = { AUTH__SECRET: 's', AUTH__SECERT: 'typo', RATE_LIMITER__MINT_MAX: '5', PATH: '/usr/bin', AUTH_SECRET: 'old' };
  const e = createEnv(source, { consumedByPrefix: ['RATE_LIMITER__'], retired: { AUTH_SECRET: 'AUTH__SECRET' } });
  it('reads MODULE__NAME and records the read', () => {
    expect(e.env('AUTH', 'SECRET')).toBe('s');
    expect([...e.namesRead()]).toEqual(['AUTH__SECRET']);
  });
  it('names the unknown ones of our shape, not the machine\'s', () => {
    expect(e.unknownNames()).toEqual(['AUTH__SECERT']);
  });
  it('names a retired name in use and its replacement', () => {
    expect(e.retiredInUse()).toEqual([{ name: 'AUTH_SECRET', replacement: 'AUTH__SECRET' }]);
  });
  it('insists on a name when asked to', () => {
    expect(() => e.must('AUTH', 'MISSING')).toThrow(/AUTH__MISSING/);
  });
});

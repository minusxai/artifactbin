/** A bad author-supplied number format must never take the document down. */
import { describe, expect, it } from 'vitest';
import { numberFormatter } from '../number-format';

describe('numberFormatter', () => {
  it('formats with d3 for a valid spec', () => {
    expect(numberFormatter(',.0f')(1493.4)).toBe('1,493');
    expect(numberFormatter('.1%')(0.184)).toBe('18.4%');
  });

  it('falls back to the default for invalid or empty specs', () => {
    const formatted = numberFormatter(undefined)(1493.4);
    expect(formatted).toMatch(/1,?493\.4/);
    for (const spec of [',0', '0,0', '#,##0', 'not-a-format-%%%', '']) {
      expect(numberFormatter(spec)(1493.4)).toBe(formatted);
    }
  });
});

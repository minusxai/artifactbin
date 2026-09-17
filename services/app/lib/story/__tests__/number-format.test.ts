/**
 * A number format spec is AUTHOR input, and a wrong one must never take the
 * document down. Found by the agent eval on production: Pi wrote
 * `<Number format=",0" />` (d3-format wants ",.0f"), publish accepted it, and
 * every render of the document — page, raw, export — was a 500 from d3
 * throwing inside SSR. ONE module answers "is this spec valid" for the publish
 * door and "format this number" for every renderer, so the two cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { isNumberFormat, numberFormatter, NUMBER_FORMAT_HINT } from '../number-format';

describe('isNumberFormat', () => {
  it('accepts d3-format specs', () => {
    for (const ok of [',.0f', '$,.2f', '.1%', ',d', '.2s', '', undefined]) expect(isNumberFormat(ok)).toBe(true);
  });
  it('refuses what an agent guesses', () => {
    for (const bad of [',0', '0,0', '#,##0', 'not-a-format-%%%']) expect(isNumberFormat(bad)).toBe(false);
  });
});

describe('numberFormatter', () => {
  it('formats with d3 for a valid spec', () => {
    expect(numberFormatter(',.0f')(1493.4)).toBe('1,493');
    expect(numberFormatter('.1%')(0.184)).toBe('18.4%');
  });
  it('NEVER throws: an invalid spec falls back to the default number format', () => {
    expect(numberFormatter(',0')(1493.4)).toBe(numberFormatter(undefined)(1493.4));
    expect(numberFormatter(undefined)(1493.4)).toMatch(/1,?493\.4/);
  });
  it('names the fix', () => {
    expect(NUMBER_FORMAT_HINT).toMatch(/,\.0f/);
  });
});

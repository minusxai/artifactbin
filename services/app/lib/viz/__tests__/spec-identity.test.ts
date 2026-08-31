/**
 * specSignature — the test of "same chart, or a different one?".
 *
 * Getting this wrong in either direction is visible: too loose and a real spec
 * change never reaches the chart; too tight and an untouched chart rebuilds on
 * every keystroke somewhere else in the document.
 */
import { describe, expect, it } from 'vitest';
import { specSignature } from '../spec-identity';

const envelope = (spec: unknown) => ({ version: 2, source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec } });
const SPEC = { mark: 'bar', encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'revenue', type: 'quantitative' } } };

describe('specSignature', () => {
  it('is equal for a re-parsed copy of the same spec (the whole point)', () => {
    expect(specSignature(envelope(structuredClone(SPEC)))).toBe(specSignature(envelope(SPEC)));
  });

  it('ignores key ORDER, which a re-parse does not preserve meaningfully', () => {
    const a = { mark: 'bar', encoding: { y: { type: 'quantitative', field: 'revenue' }, x: { field: 'month', type: 'temporal' } } };
    expect(specSignature(envelope(a))).toBe(specSignature(envelope(SPEC)));
  });

  it('changes when the spec changes at any depth', () => {
    const deep = structuredClone(SPEC) as typeof SPEC;
    deep.encoding.y.field = 'profit';
    expect(specSignature(envelope(deep))).not.toBe(specSignature(envelope(SPEC)));
    expect(specSignature(envelope({ ...SPEC, mark: 'line' }))).not.toBe(specSignature(envelope(SPEC)));
  });

  it('keeps ARRAY order, which is meaningful (layers, series, sort)', () => {
    expect(specSignature({ layer: [1, 2] })).not.toBe(specSignature({ layer: [2, 1] }));
  });

  it('distinguishes an absent key from an explicit null, but not from undefined', () => {
    expect(specSignature({ a: 1 })).toBe(specSignature({ a: 1, b: undefined }));
    expect(specSignature({ a: 1 })).not.toBe(specSignature({ a: 1, b: null }));
  });

  it('separates values JSON would flatten together', () => {
    expect(specSignature({ v: Number.NaN })).not.toBe(specSignature({ v: null }));
    expect(specSignature({ v: Number.POSITIVE_INFINITY })).not.toBe(specSignature({ v: Number.NEGATIVE_INFINITY }));
    expect(specSignature({ v: '1' })).not.toBe(specSignature({ v: 1 }));
  });

  it('handles the empty and primitive cases without throwing', () => {
    expect(specSignature(null)).toBe(specSignature(null));
    expect(specSignature(undefined)).toBe(specSignature(undefined));
    expect(specSignature({})).not.toBe(specSignature([]));
  });
});

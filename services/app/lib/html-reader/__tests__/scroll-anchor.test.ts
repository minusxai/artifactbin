/**
 * The reading position, as a place in the document rather than a pixel offset.
 *
 * The failure this prevents is quiet: an anchor that resolves to the wrong
 * element does not error, it just puts the reader somewhere else — which is
 * indistinguishable from the scroll loss it replaced.
 */
import { describe, expect, it } from 'vitest';
import { anchorAt, type AnchorCandidate } from '../scroll-anchor';

/** A document: a wrapper holding three paragraphs, as the interpreter stamps it. */
const DOC: AnchorCandidate[] = [
  { path: '0', top: 0, height: 900 },      // the wrapper, containing everything
  { path: '0.0', top: 0, height: 100 },
  { path: '0.1', top: 100, height: 400 },
  { path: '0.2', top: 500, height: 400 },
];

describe('anchorAt', () => {
  it('names the most specific element under the viewport top, never the wrapper', () => {
    expect(anchorAt(DOC, 200)).toEqual({ path: '0.1', fraction: 0.25 });
  });

  it('measures how far INTO that element the reader is', () => {
    expect(anchorAt(DOC, 100)!.fraction).toBe(0);
    expect(anchorAt(DOC, 300)!.fraction).toBe(0.5);
    expect(anchorAt(DOC, 499)!.fraction).toBeCloseTo(0.9975, 3);
  });

  it('moves to the next element exactly at its boundary', () => {
    expect(anchorAt(DOC, 500)).toEqual({ path: '0.2', fraction: 0 });
  });

  it('at the very top, names the first element', () => {
    expect(anchorAt(DOC, 0)).toEqual({ path: '0.0', fraction: 0 });
  });

  it('ignores STRUCTURE: a wrapper taller than the window is not where the reader is', () => {
    // The reader is in the margin between two paragraphs — inside the wrapper,
    // inside nothing else. Anchoring to the wrapper puts them anywhere at all.
    const spaced: AnchorCandidate[] = [
      { path: '0', top: 0, height: 4000 },       // the document wrapper
      { path: '0.0', top: 0, height: 100 },
      { path: '0.1', top: 140, height: 100 },    // a 40px margin above it
    ];
    expect(anchorAt(spaced, 120, 800)).toEqual({ path: '0.1', fraction: 0 });
  });

  it('falls back to the container when nothing smaller can hold the reader', () => {
    const only: AnchorCandidate[] = [{ path: '0', top: 0, height: 4000 }];
    expect(anchorAt(only, 1000, 800)).toEqual({ path: '0', fraction: 0.25 });
  });

  it('in a GAP between elements, names the one the reader is about to read', () => {
    const gapped: AnchorCandidate[] = [
      { path: '0.0', top: 0, height: 100 },
      { path: '0.1', top: 300, height: 100 },
    ];
    expect(anchorAt(gapped, 200)).toEqual({ path: '0.1', fraction: 0 });
  });

  it('past the end of the document, names the last element', () => {
    expect(anchorAt(DOC, 5000)).toEqual({ path: '0.2', fraction: 1 });
  });

  it('prefers the deeper of two boxes that start together', () => {
    const nested: AnchorCandidate[] = [
      { path: '0', top: 0, height: 500 },
      { path: '0.0', top: 0, height: 200 },
      { path: '0.0.0', top: 0, height: 50 },
    ];
    expect(anchorAt(nested, 10)!.path).toBe('0.0.0');
  });

  it('survives a zero-height element without dividing by it', () => {
    const flat: AnchorCandidate[] = [{ path: '0.0', top: 0, height: 0 }, { path: '0.1', top: 10, height: 10 }];
    const a = anchorAt(flat, 0);
    expect(a).not.toBeNull();
    expect(Number.isFinite(a!.fraction)).toBe(true);
  });

  it('returns nothing for an empty document', () => {
    expect(anchorAt([], 0)).toBeNull();
  });
});


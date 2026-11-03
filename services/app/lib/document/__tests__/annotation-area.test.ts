/**
 * A DRAWN AREA IS THE SECOND KIND OF RANGE — same column, same wire field,
 * tagged by `kind`. This pins the grammar the door accepts.
 */
import { describe, expect, it } from 'vitest';
import { isAreaRange, parseAnnotationRange } from '../annotation-range';


describe('the area range grammar', () => {
  it('parses an area range and keeps text ranges exactly as they were', () => {
    const area = parseAnnotationRange({ v: 1, kind: 'area', box: { x: 0.2, y: 0.05, w: 0.5, h: 0.4 } });
    expect(area).toEqual({ v: 1, kind: 'area', box: { x: 0.2, y: 0.05, w: 0.5, h: 0.4 } });
    expect(isAreaRange(area)).toBe(true);
    const text = parseAnnotationRange({ v: 1, parts: [{ rel: '', start: 0, end: 3, text: 'Rev' }] });
    expect(text).toEqual({ v: 1, parts: [{ rel: '', start: 0, end: 3, text: 'Rev' }] });
    expect(isAreaRange(text)).toBe(false);
    expect(parseAnnotationRange({ v: 1, kind: 'text', parts: [{ rel: '', start: 0, end: 3, text: 'Rev' }] })).toMatchObject({ parts: [{ text: 'Rev' }] });
  });

  it('refuses a box outside the unit square, without size, or with anything but numbers', () => {
    const box = (value: unknown) => parseAnnotationRange({ v: 1, kind: 'area', box: value });
    expect(box({ x: 0.2, y: 0.1, w: 0.5, h: 0.4 })).toEqual({ v: 1, kind: 'area', box: { x: 0.2, y: 0.1, w: 0.5, h: 0.4 } });
    expect(box({ x: 1.2, y: 0.1, w: 0.5, h: 0.4 })).toBeNull();
    expect(box({ x: 0.6, y: 0.1, w: 0.5, h: 0.4 })).toBeNull();   // runs past the right edge
    expect(box({ x: 0.2, y: 0.1, w: 0, h: 0.4 })).toBeNull();
    expect(box({ x: -0.1, y: 0.1, w: 0.5, h: 0.4 })).toBeNull();
    expect(box({ x: '0.2', y: 0.1, w: 0.5, h: 0.4 })).toBeNull();
    expect(box({ x: NaN, y: 0.1, w: 0.5, h: 0.4 })).toBeNull();
    expect(box(null)).toBeNull();
    expect(parseAnnotationRange({ v: 1, kind: 'area' })).toBeNull();
    expect(parseAnnotationRange({ v: 1, kind: 'circle', box: { x: 0, y: 0, w: 1, h: 1 } })).toBeNull();
  });
});

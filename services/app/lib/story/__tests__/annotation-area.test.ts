/**
 * A DRAWN AREA IS THE SECOND KIND OF RANGE — same column, same wire field,
 * tagged by `kind`. This pins the pure half: the grammar the door accepts,
 * the fraction round trip that lets a box survive a reflow, and the rule
 * that turns a rubber band over some blocks into ONE anchor node.
 */
import { describe, expect, it } from 'vitest';
import {
  areaTarget, boxFromRects, isAreaRange, parseAnnotationBox, parseAnnotationRange, rectFromBox,
} from '../annotation-range';

const SECTION = { x: 20, y: 100, width: 400, height: 200 };

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
    expect(parseAnnotationBox({ x: 0.2, y: 0.1, w: 0.5, h: 0.4 })).toEqual({ x: 0.2, y: 0.1, w: 0.5, h: 0.4 });
    expect(parseAnnotationBox({ x: 1.2, y: 0.1, w: 0.5, h: 0.4 })).toBeNull();
    expect(parseAnnotationBox({ x: 0.6, y: 0.1, w: 0.5, h: 0.4 })).toBeNull();   // runs past the right edge
    expect(parseAnnotationBox({ x: 0.2, y: 0.1, w: 0, h: 0.4 })).toBeNull();
    expect(parseAnnotationBox({ x: -0.1, y: 0.1, w: 0.5, h: 0.4 })).toBeNull();
    expect(parseAnnotationBox({ x: '0.2', y: 0.1, w: 0.5, h: 0.4 })).toBeNull();
    expect(parseAnnotationBox({ x: NaN, y: 0.1, w: 0.5, h: 0.4 })).toBeNull();
    expect(parseAnnotationBox(null)).toBeNull();
    expect(parseAnnotationRange({ v: 1, kind: 'area' })).toBeNull();
    expect(parseAnnotationRange({ v: 1, kind: 'circle', box: { x: 0, y: 0, w: 1, h: 1 } })).toBeNull();
  });
});

describe('fractions of the anchor', () => {
  it('round-trips a band through the anchor box', () => {
    const box = boxFromRects(SECTION, { x: 100, y: 110, width: 200, height: 80 });
    expect(box).toEqual({ x: 0.2, y: 0.05, w: 0.5, h: 0.4 });
    expect(rectFromBox(SECTION, box!)).toEqual({ x: 100, y: 110, width: 200, height: 80 });
  });

  it('clips the band to the anchor, and answers null when they do not meet', () => {
    expect(boxFromRects(SECTION, { x: 0, y: 0, width: 220, height: 150 })).toEqual({ x: 0, y: 0, w: 0.5, h: 0.25 });
    expect(boxFromRects(SECTION, { x: 300, y: 250, width: 500, height: 500 })).toEqual({ x: 0.7, y: 0.75, w: 0.3, h: 0.25 });
    expect(boxFromRects(SECTION, { x: 500, y: 500, width: 10, height: 10 })).toBeNull();
    expect(boxFromRects({ ...SECTION, width: 0 }, { x: 20, y: 100, width: 10, height: 10 })).toBeNull();
  });

  it('rounds to four decimals so a box is a hint, not a survey', () => {
    const box = boxFromRects({ x: 0, y: 0, width: 3, height: 3 }, { x: 1, y: 1, width: 1, height: 1 });
    expect(box).toEqual({ x: 0.3333, y: 0.3333, w: 0.3333, h: 0.3333 });
  });
});

describe('which node a drawn area is about', () => {
  // A section holding two paragraphs, and a heading above it.
  const nodes = [
    { path: '0', rect: { x: 0, y: 0, width: 600, height: 400 } },          // the document wrapper
    { path: '0.0', rect: { x: 20, y: 20, width: 400, height: 40 } },        // h1
    { path: '0.1', rect: SECTION },                                          // section
    { path: '0.1.0', rect: { x: 20, y: 100, width: 400, height: 40 } },    // p
    { path: '0.1.1', rect: { x: 20, y: 160, width: 400, height: 40 } },    // p
  ];

  it('is the paragraph for a band inside one, and the section for a band across two', () => {
    expect(areaTarget(nodes, { x: 100, y: 110, width: 100, height: 20 })).toBe('0.1.0');
    expect(areaTarget(nodes, { x: 100, y: 110, width: 200, height: 80 })).toBe('0.1');
  });

  it('is the container itself for a band over its padding only, and the wrapper across sections', () => {
    expect(areaTarget(nodes, { x: 100, y: 210, width: 100, height: 50 })).toBe('0.1');   // section padding, no paragraph
    expect(areaTarget(nodes, { x: 100, y: 30, width: 100, height: 100 })).toBe('0');      // h1 + first p
  });

  it('is nothing when the band touches nothing', () => {
    expect(areaTarget(nodes, { x: 700, y: 700, width: 10, height: 10 })).toBeNull();
  });

  it('when the hits share no ancestor, is the block the band covers most — a drag is never a dead end', () => {
    const twoRoots = [
      { path: '0', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { path: '1', rect: { x: 0, y: 200, width: 100, height: 100 } },
    ];
    // 50px of the first root, 100px of the second.
    expect(areaTarget(twoRoots, { x: 10, y: 50, width: 20, height: 250 })).toBe('1');
    // …and the other way round.
    expect(areaTarget(twoRoots, { x: 10, y: 0, width: 20, height: 220 })).toBe('0');
  });

  it('across two top-level sections, is the SECTION the band covers most — not a stray heading inside it', () => {
    const twoSections = [
      { path: '0', rect: { x: 0, y: 0, width: 600, height: 150 } },
      { path: '0.1', rect: { x: 20, y: 60, width: 400, height: 40 } },
      { path: '1', rect: { x: 0, y: 200, width: 600, height: 300 } },
      { path: '1.0', rect: { x: 20, y: 220, width: 500, height: 60 } },   // a wide h2
      { path: '1.1', rect: { x: 20, y: 300, width: 400, height: 40 } },
      { path: '1.2', rect: { x: 20, y: 360, width: 400, height: 40 } },
    ];
    expect(areaTarget(twoSections, { x: 30, y: 70, width: 200, height: 328 })).toBe('1');
  });
});

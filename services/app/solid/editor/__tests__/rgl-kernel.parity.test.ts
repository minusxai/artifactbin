/**
 * Proves rgl-kernel.ts's vendored moveElement/compact produce EXACTLY the layouts react-grid-layout's
 * own kernel would, on the same inputs — the thing that lets us drop the `react-grid-layout` import
 * from the Solid editor without risking a silent drag/resize/compaction regression.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — RGL ships no types for build/utils; see the old rgl-kernel.ts this replaces.
import * as rgl from 'react-grid-layout/build/utils';
import { compact, moveElement, type LayoutItem } from '../rgl-kernel';

const real = (rgl as { default?: typeof rgl }).default ?? rgl;

// A tiny deterministic PRNG so fuzz failures reproduce without a seed dependency.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomLayout(rng: () => number, n: number, cols: number): LayoutItem[] {
  // Stack items in separate rows so the starting layout is overlap-free by construction.
  return Array.from({ length: n }, (_, i) => {
    const w = 1 + Math.floor(rng() * cols);
    const h = 1 + Math.floor(rng() * 3);
    const x = Math.floor(rng() * (cols - w + 1));
    return { i: `item-${i}`, x, y: i * 3, w, h };
  });
}

const cloneLayout = (layout: LayoutItem[]): LayoutItem[] => layout.map((l) => ({ ...l }));

describe('rgl-kernel matches react-grid-layout on named scenarios', () => {
  it('moves an item across another and compacts the displaced sibling below it', () => {
    const ours: LayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 6, h: 2 }, { i: 'b', x: 6, y: 0, w: 6, h: 2 }];
    const theirs = cloneLayout(ours);
    const oursItem = ours.find((l) => l.i === 'b')!;
    const theirsItem = theirs.find((l) => l.i === 'b')!;
    const oursNext = compact(moveElement(ours, oursItem, 0, 0, true, false, 'vertical', 12), 'vertical', 12);
    const theirsNext = real.compact(real.moveElement(theirs, theirsItem, 0, 0, true, false, 'vertical', 12), 'vertical', 12);
    expect(oursNext).toEqual(theirsNext);
  });

  it('keyboard-nudges an item right by one column, cascading collision with its neighbor', () => {
    const ours: LayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 6, h: 2 }, { i: 'b', x: 6, y: 0, w: 6, h: 2 }];
    const theirs = cloneLayout(ours);
    const oursItem = ours.find((l) => l.i === 'a')!;
    const theirsItem = theirs.find((l) => l.i === 'a')!;
    const oursNext = compact(moveElement(ours, oursItem, 1, 0, true, false, 'vertical', 12), 'vertical', 12);
    const theirsNext = real.compact(real.moveElement(theirs, theirsItem, 1, 0, true, false, 'vertical', 12), 'vertical', 12);
    expect(oursNext).toEqual(theirsNext);
  });

  it('resizes an item taller, pushing the item below it down', () => {
    const ours: LayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 6, h: 2 }, { i: 'b', x: 0, y: 2, w: 6, h: 2 }];
    const theirs = cloneLayout(ours);
    ours[0]!.h = 4; theirs[0]!.h = 4;
    expect(compact(ours, 'vertical', 12)).toEqual(real.compact(theirs, 'vertical', 12));
  });

  it('preventCollision reverts a move that would collide', () => {
    const ours: LayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 6, h: 2 }, { i: 'b', x: 6, y: 0, w: 6, h: 2 }];
    const theirs = cloneLayout(ours);
    const oursNext = moveElement(ours, ours.find((l) => l.i === 'a')!, 6, 0, true, true, 'vertical', 12);
    const theirsNext = real.moveElement(theirs, theirs.find((l: LayoutItem) => l.i === 'a')!, 6, 0, true, true, 'vertical', 12);
    expect(oursNext).toEqual(theirsNext);
  });

  it('compacts a layout with a gap between rows', () => {
    const ours: LayoutItem[] = [{ i: 'a', x: 0, y: 3, w: 4, h: 2 }, { i: 'b', x: 4, y: 5, w: 4, h: 1 }, { i: 'c', x: 8, y: 0, w: 4, h: 4 }];
    const theirs = cloneLayout(ours);
    expect(compact(ours, 'vertical', 12)).toEqual(real.compact(theirs, 'vertical', 12));
  });
});

describe('rgl-kernel matches react-grid-layout under fuzzing', () => {
  const rng = mulberry32(20260930);
  const cols = 12;
  for (let trial = 0; trial < 200; trial++) {
    it(`trial ${trial}`, () => {
      const n = 2 + Math.floor(rng() * 5);
      let ours = randomLayout(rng, n, cols);
      let theirs = cloneLayout(ours);
      const steps = 1 + Math.floor(rng() * 4);
      for (let step = 0; step < steps; step++) {
        const key = `item-${Math.floor(rng() * n)}`;
        const x = Math.floor(rng() * cols);
        const y = Math.floor(rng() * 6);
        const isUserAction = rng() < 0.7;
        const preventCollision = rng() < 0.2;
        const oursItem = ours.find((l) => l.i === key);
        const theirsItem = theirs.find((l) => l.i === key);
        if (!oursItem || !theirsItem) continue;
        ours = moveElement(ours, oursItem, x, y, isUserAction, preventCollision, 'vertical', cols);
        theirs = real.moveElement(theirs, theirsItem, x, y, isUserAction, preventCollision, 'vertical', cols);
        expect(ours).toEqual(theirs);
        if (rng() < 0.5) {
          ours = compact(ours, 'vertical', cols);
          theirs = real.compact(theirs, 'vertical', cols);
          expect(ours).toEqual(theirs);
        }
      }
    });
  }
});

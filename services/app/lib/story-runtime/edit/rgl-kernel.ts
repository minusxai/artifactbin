/**
 * The collision/compaction KERNEL react-grid-layout uses for pointer and keyboard moves
 * (`moveElement`, `compact`), vendored so the Solid editor never imports the `react-grid-layout`
 * package (whose component and even its `build/utils` module pull in React). Ported from
 * react-grid-layout@1.5.4's `build/utils.js` (functions: bottom, cloneLayoutItem, collides, compact,
 * compactItem, resolveCompactionCollision, getStatics, getFirstCollision, getAllCollisions,
 * sortLayoutItems, moveElement, moveElementAwayFromCollision), trimmed to what this editor ever
 * exercises: only vertical compaction (the horizontal/off dispatch branches, and the axis parameter
 * they needed, are dropped as dead code — this codebase never requested them, even through the old
 * react-grid-layout-backed kernel this replaces); only the LayoutItem fields this editor ever sets
 * (no minW/maxW/isDraggable/etc.); and no debug `log()` calls (console output gated behind an env
 * flag we never set — never part of a returned layout).
 * solid/editor/__tests__/grid-edit.test.tsx covers the layouts it produces.
 *
 * react-grid-layout is MIT licensed:
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 Samuel Reed
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export interface LayoutItem { i: string; x: number; y: number; w: number; h: number; static?: boolean; moved?: boolean }
// Only 'vertical' compaction is ever requested from this codebase (GridEdit.tsx, and the old
// react-grid-layout Kernel type this replaces, both hardcode it) — horizontal/off dispatch branches
// are dropped rather than vendored as dead code.
type CompactType = 'vertical';

function bottom(layout: LayoutItem[]): number {
  let max = 0;
  for (const item of layout) max = Math.max(max, item.y + item.h);
  return max;
}

function cloneLayoutItem(item: LayoutItem): LayoutItem {
  return { i: item.i, x: item.x, y: item.y, w: item.w, h: item.h, static: Boolean(item.static), moved: Boolean(item.moved) };
}

function collides(l1: LayoutItem, l2: LayoutItem): boolean {
  if (l1.i === l2.i) return false;
  if (l1.x + l1.w <= l2.x) return false;
  if (l1.x >= l2.x + l2.w) return false;
  if (l1.y + l1.h <= l2.y) return false;
  if (l1.y >= l2.y + l2.h) return false;
  return true;
}

function getStatics(layout: LayoutItem[]): LayoutItem[] {
  return layout.filter((l) => l.static);
}

function getFirstCollision(layout: LayoutItem[], item: LayoutItem): LayoutItem | undefined {
  return layout.find((l) => collides(l, item));
}

function getAllCollisions(layout: LayoutItem[], item: LayoutItem): LayoutItem[] {
  return layout.filter((l) => collides(l, item));
}

/** Sort by row ascending, then column ascending. Does not modify `layout`. */
function sortLayoutItems(layout: LayoutItem[]): LayoutItem[] {
  return layout.slice(0).sort((a, b) => {
    if (a.y > b.y || (a.y === b.y && a.x > b.x)) return 1;
    if (a.y === b.y && a.x === b.x) return 0;
    return -1;
  });
}

/** Before moving an item down, push whatever it would collide with down first. Modifies `layout` items in place. */
function resolveCompactionCollision(layout: LayoutItem[], item: LayoutItem, moveToCoord: number): void {
  item.y += 1;
  const itemIndex = layout.map((l) => l.i).indexOf(item.i);
  for (let i = itemIndex + 1; i < layout.length; i++) {
    const other = layout[i]!;
    if (other.static) continue;
    if (other.y > item.y + item.h) break;
    if (collides(item, other)) resolveCompactionCollision(layout, other, moveToCoord + item.h);
  }
  item.y = moveToCoord;
}

/** Compact a single item against `compareWith`. Modifies and returns `l`. */
function compactItem(compareWith: LayoutItem[], l: LayoutItem, fullLayout: LayoutItem[], b: number): LayoutItem {
  l.y = Math.min(b, l.y);
  while (l.y > 0 && !getFirstCollision(compareWith, l)) l.y--;
  let collision: LayoutItem | undefined;
  while ((collision = getFirstCollision(compareWith, l))) {
    resolveCompactionCollision(fullLayout, l, collision.y + collision.h);
  }
  l.y = Math.max(l.y, 0);
  l.x = Math.max(l.x, 0);
  return l;
}

/** Compact a layout: remove vertical gaps between items, statics fixed. Does not modify input items. */
export function compact(layout: LayoutItem[], _compactType: CompactType, _cols: number): LayoutItem[] {
  // _compactType/_cols: kept so call sites (GridEdit.tsx) read like RGL's own 3-arg kernel; vertical
  // compaction (the only mode vendored) doesn't consume either.
  const compareWith = getStatics(layout);
  let b = bottom(compareWith);
  const sorted = sortLayoutItems(layout);
  const out: LayoutItem[] = Array(layout.length);
  for (const sortedItem of sorted) {
    let l = cloneLayoutItem(sortedItem);
    if (!l.static) {
      l = compactItem(compareWith, l, sorted, b);
      b = Math.max(b, l.y + l.h);
      compareWith.push(l);
    }
    out[layout.indexOf(sortedItem)] = l;
    l.moved = false;
  }
  return out;
}

/**
 * Move an element to (x, y), cascading collisions to the items it displaces. Modifies layout items
 * in place; returns the (possibly same) layout array.
 */
export function moveElement(
  layout: LayoutItem[],
  l: LayoutItem,
  x: number | undefined,
  y: number | undefined,
  isUserAction: boolean,
  preventCollision: boolean,
  compactType: CompactType,
  cols: number,
): LayoutItem[] {
  if (l.static) return layout;
  if (l.y === y && l.x === x) return layout;
  const oldX = l.x;
  const oldY = l.y;
  if (typeof x === 'number') l.x = x;
  if (typeof y === 'number') l.y = y;
  l.moved = true;
  let sorted = sortLayoutItems(layout);
  const movingUp = typeof y === 'number' ? oldY >= y : false;
  if (movingUp) sorted = sorted.reverse();
  const collisions = getAllCollisions(sorted, l);
  if (collisions.length > 0 && preventCollision) {
    l.x = oldX;
    l.y = oldY;
    l.moved = false;
    return layout;
  }
  for (const collision of collisions) {
    if (collision.moved) continue;
    if (collision.static) layout = moveElementAwayFromCollision(layout, collision, l, isUserAction, compactType, cols);
    else layout = moveElementAwayFromCollision(layout, l, collision, isUserAction, compactType, cols);
  }
  return layout;
}

/** Move `itemToMove` away from `collidesWith`: up if there's room, otherwise down. Recurses via moveElement. */
function moveElementAwayFromCollision(
  layout: LayoutItem[],
  collidesWith: LayoutItem,
  itemToMove: LayoutItem,
  isUserAction: boolean,
  compactType: CompactType,
  cols: number,
): LayoutItem[] {
  const preventCollision = Boolean(collidesWith.static);
  // isUserAction only ever applies to the "main" collision: if there's room above the
  // collision, try moving there first; every recursive/fallthrough call below is not a user action.
  if (isUserAction) {
    const fakeItem: LayoutItem = { x: itemToMove.x, y: Math.max(collidesWith.y - itemToMove.h, 0), w: itemToMove.w, h: itemToMove.h, i: '-1' };
    const firstCollision = getFirstCollision(layout, fakeItem);
    if (!firstCollision) return moveElement(layout, itemToMove, undefined, fakeItem.y, false, preventCollision, compactType, cols);
  }
  return moveElement(layout, itemToMove, undefined, itemToMove.y + 1, false, preventCollision, compactType, cols);
}

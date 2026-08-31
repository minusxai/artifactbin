'use client';

/**
 * Dragging and resizing a `<Grid>`'s tiles, in the document.
 *
 * It has to happen here: react-grid-layout works in PIXELS, and only the
 * document knows how wide its own columns are — the grid sits inside whatever
 * gutter and measure the author gave it. So the drag is local and the RESULT
 * travels: a set of rects the page writes back into the source, exactly as it
 * writes back a paragraph.
 *
 * Ported from the canvas's GridAdapter. The one real change is where the width
 * comes from: there it was the canvas's fixed measure, here it is the element's
 * own, re-read when the window changes.
 */
import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import RGL, { type Layout } from 'react-grid-layout';

import { Grid, gridItemChildren, type GridProps, type GridItemProps } from '@/components/kit/grid';
import {
  diffLayouts, gridCols, gridItemRect, gridRowHeight, type GridItemRect,
} from '@/lib/story-ui/grid-layout';
import { STORY_GRID_EDIT_CSS } from '@/lib/story-ui/grid-css';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import type { StoryLayoutRect } from '../contract';

export interface GridEditProps {
  props: Record<string, unknown>;
  /** Report the rects a drag or resize produced. Several at once: compaction moves siblings. */
  onLayout: (rects: StoryLayoutRect[]) => void;
}

export function GridEdit({ props, onLayout }: GridEditProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const w = wrapRef.current?.clientWidth;
      if (w) setWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // The document re-renders around us; re-measure after each one.
  useEffect(() => {
    const w = wrapRef.current?.clientWidth;
    if (w) setWidth((prev) => (prev === w ? prev : w));
  });

  const gridProps = props as unknown as GridProps;
  const astPath = props[AST_PATH_ATTR];
  const nCols = gridCols(gridProps.cols);
  const rh = gridRowHeight(gridProps.rowHeight);
  const items = gridItemChildren(gridProps.children).filter(
    (el: ReactElement) => typeof (el.props as Record<string, unknown>)[AST_PATH_ATTR] === 'string',
  );
  // Nothing addressable to drag: render it as the reader sees it.
  if (items.length === 0 || width === null) {
    return <div ref={wrapRef} className="w-full" {...{ [AST_PATH_ATTR]: astPath }}><Grid {...gridProps} /></div>;
  }

  const rects = new Map<string, GridItemRect>(items.map((el: ReactElement) => [
    (el.props as Record<string, unknown>)[AST_PATH_ATTR] as string,
    gridItemRect(el.props as Record<string, unknown>, nCols),
  ]));
  const layout: Layout[] = [...rects].map(([i, r]) => ({ i, ...r, resizeHandles: ['se' as const] }));
  const commit = (next: Layout[]) => {
    const changed = diffLayouts(next, rects);
    if (changed.length > 0) {
      onLayout(changed.map((c) => ({ path: c.astPath, x: c.x, y: c.y, w: c.w, h: c.h })));
    }
  };

  return (
    <div
      {...{ [AST_PATH_ATTR]: astPath }}
      className="w-full"
      ref={wrapRef}
      /*
       * A tile drag is a react-grid-layout MOUSE drag; any NATIVE drag starting
       * inside it is a hijack — an embed title is an <a href>, natively
       * draggable, so dragging a tile by its title dragged the LINK too (URL
       * ghost, drop-navigation).
       */
      onDragStartCapture={(e) => e.preventDefault()}
    >
      {/* RGL's structural CSS, inside this document — head styles never reach it. */}
      <style data-mx-grid-css="">{STORY_GRID_EDIT_CSS}</style>
      <RGL
        width={width}
        cols={nCols}
        rowHeight={rh}
        margin={[0, 0]}
        containerPadding={[0, 0]}
        compactType="vertical"
        layout={layout}
        onDragStop={commit}
        onResizeStop={commit}
        isDraggable
        isResizable
      >
        {items.map((el: ReactElement) => {
          const path = (el.props as Record<string, unknown>)[AST_PATH_ATTR] as string;
          // RGL positions this wrapper; the cloned tile stops positioning itself.
          return <div key={path}>{cloneElement(el as ReactElement, { editing: true } as Partial<GridItemProps>)}</div>;
        })}
      </RGL>
    </div>
  );
}

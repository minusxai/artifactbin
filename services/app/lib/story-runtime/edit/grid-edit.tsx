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
import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type KeyboardEvent,
} from 'react';
import RGL, { type Layout } from 'react-grid-layout';

import { Grid, gridItemChildren, type GridProps, type GridItemProps } from '@/components/kit/grid';
import { diffLayouts, gridCols, gridItemRect, gridRowHeight, type GridItemRect } from '@/lib/story-ui/grid-layout';
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
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (wrapRef.current) observer?.observe(wrapRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
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
  // The reader's @max-2xl container rule is 42rem. Reuse its stacked
  // rendering below that width; responsive presentation never writes geometry.
  const stackBelow = 42 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  if (gridProps.mode === 'flow' || items.length === 0 || width === null || width < stackBelow) {
    return (
      <div ref={wrapRef} className="w-full" {...{ [AST_PATH_ATTR]: astPath }}>
        <Grid {...gridProps} />
      </div>
    );
  }

  return (
    <PositionedGridEdit
      width={width}
      nCols={nCols}
      rh={rh}
      items={items}
      astPath={astPath}
      onLayout={onLayout}
      wrapRef={wrapRef}
    />
  );
}

/** Positioned interaction is isolated from the flow renderer and public component vocabulary. */
function PositionedGridEdit({
  width,
  nCols,
  rh,
  items,
  astPath,
  onLayout,
  wrapRef,
}: {
  width: number;
  nCols: number;
  rh: number;
  items: ReactElement[];
  astPath: unknown;
  onLayout: GridEditProps['onLayout'];
  wrapRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [draft, setDraft] = useState<Layout[] | null>(null);
  const cancelled = useRef(false),
    activeGesture = useRef(false);
  const itemKey = (el: ReactElement) =>
    String((el.props as Record<string, unknown>).id ?? el.key ?? (el.props as Record<string, unknown>)[AST_PATH_ATTR]);
  const paths = new Map(
    items.map((el) => [itemKey(el), (el.props as Record<string, unknown>)[AST_PATH_ATTR] as string]),
  );
  const rects = new Map<string, GridItemRect>(
    items.map((el: ReactElement) => [itemKey(el), gridItemRect(el.props as Record<string, unknown>, nCols)]),
  );
  const layout: Layout[] = [...rects].map(([i, r]) => ({ i, ...r, resizeHandles: ['se' as const] }));
  const current = draft ?? layout;
  // RGL publicly exports the same collision/compaction kernel it uses for pointer moves.
  const utils = (
    RGL as typeof RGL & {
      utils: {
        moveElement(
          layout: Layout[],
          item: Layout,
          x: number,
          y: number,
          user: boolean,
          prevent: boolean,
          compact: string,
          cols: number,
        ): Layout[];
        compact(layout: Layout[], type: string, cols: number): Layout[];
      };
    }
  ).utils;
  const cancel = () => {
    if (!activeGesture.current && !draft) return;
    cancelled.current = true;
    activeGesture.current = false;
    setDraft(null);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  };
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && (activeGesture.current || draft)) {
        e.preventDefault();
        cancel();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  });
  const sourceGeometry = JSON.stringify(layout),
    previousGeometry = useRef(sourceGeometry);
  useLayoutEffect(() => {
    if (previousGeometry.current !== sourceGeometry) {
      cancel();
      previousGeometry.current = sourceGeometry;
    }
  }, [sourceGeometry]);
  const commit = (next: Layout[]) => {
    activeGesture.current = false;
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const changed = diffLayouts(next, rects);
    if (changed.length > 0) {
      onLayout(changed.map((c) => ({ path: paths.get(c.astPath)!, x: c.x, y: c.y, w: c.w, h: c.h })));
    }
  };

  const keyAction = (event: KeyboardEvent, path: string, resize = false) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === 'Enter' && draft) {
      event.preventDefault();
      commit(draft);
      return;
    }
    const delta =
      event.key === 'ArrowLeft'
        ? [-1, 0]
        : event.key === 'ArrowRight'
          ? [1, 0]
          : event.key === 'ArrowUp'
            ? [0, -1]
            : event.key === 'ArrowDown'
              ? [0, 1]
              : null;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    cancelled.current = false;
    const next = current.map((r) => ({ ...r })),
      item = next.find((r) => r.i === path);
    if (!item) return;
    if (resize) {
      item.w = Math.max(1, Math.min(nCols - item.x, item.w + delta[0]));
      item.h = Math.max(1, item.h + delta[1]);
      setDraft(utils.compact(next, 'vertical', nCols));
    } else
      setDraft(
        utils.compact(
          utils.moveElement(
            next,
            item,
            Math.min(nCols - item.w, Math.max(0, item.x + delta[0])),
            Math.max(0, item.y + delta[1]),
            true,
            false,
            'vertical',
            nCols,
          ),
          'vertical',
          nCols,
        ),
      );
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
        layout={current}
        onDragStart={() => {
          cancelled.current = false;
          activeGesture.current = true;
        }}
        onResizeStart={() => {
          cancelled.current = false;
          activeGesture.current = true;
        }}
        onDrag={(next) => setDraft(next.map((r) => ({ ...r })))}
        onResize={(next) => setDraft(next.map((r) => ({ ...r })))}
        resizeHandle={(axis, ref) => (
          <span
            ref={(element) => {
              if (typeof ref === 'function') ref(element);
              else if (ref) (ref as { current: HTMLElement | null }).current = element;
            }}
            role="button"
            tabIndex={0}
            aria-label="Resize positioned tile"
            className={`react-resizable-handle react-resizable-handle-${axis}`}
            onKeyDown={(event) => {
              const path = event.currentTarget.parentElement
                ?.querySelector(`[${AST_PATH_ATTR}]`)
                ?.getAttribute(AST_PATH_ATTR);
              if (path) {
                const key = [...paths].find(([, p]) => p === path)?.[0];
                if (key) keyAction(event, key, true);
              }
            }}
          />
        )}
        onDragStop={commit}
        onResizeStop={commit}
        draggableHandle=".mx-grid-grip"
        draggableCancel="[contenteditable],input,textarea,select,button:not(.mx-grid-grip)"
        isDraggable
        isResizable
      >
        {items.map((el: ReactElement) => {
          const path = (el.props as Record<string, unknown>)[AST_PATH_ATTR] as string;
          // RGL positions this wrapper; the cloned tile stops positioning itself.
          return (
            <div key={itemKey(el)}>
              {cloneElement(el as ReactElement, { editing: true } as Partial<GridItemProps>)}
              <button
                type="button"
                className="mx-grid-grip"
                aria-label={`Move GridItem ${path}`}
                onKeyDown={(event) => keyAction(event, itemKey(el))}
              >
                ⠿
              </button>
            </div>
          );
        })}
      </RGL>
    </div>
  );
}

import { arrow as arrowMiddleware, autoUpdate, computePosition, flip, limitShift, offset, shift, size, type Middleware, type Placement } from '@floating-ui/dom';

/**
 * Radix Popper's placement (PopperContent), framework-free: floating-ui with the same strategy and
 * middleware, written to the same elements as Radix writes them — the content wrapper's fixed-position
 * style and CSS variables, the arrow's offset, and the placed side/align the anchor and content carry.
 */
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'start' | 'center' | 'end';
export interface Placed { side: Side; align: Align; arrowX?: number; arrowY?: number; hideArrow: boolean }
interface PopperOptions { side: Side; align: Align; sideOffset: number; collisionPadding: number; arrowWidth: number; arrowHeight: number; onPlaced: (placed: Placed) => void }

const sideAndAlign = (placement: Placement): [Side, Align] => { const [side, align = 'center'] = placement.split('-'); return [side as Side, align as Align]; };

/** Radix's transformOrigin middleware. */
const transformOrigin = (arrowWidthOption: number, arrowHeightOption: number): Middleware => ({
  name: 'transformOrigin',
  fn({ placement, rects, middlewareData }) {
    const hidden = middlewareData.arrow?.centerOffset !== 0;
    const arrowWidth = hidden ? 0 : arrowWidthOption; const arrowHeight = hidden ? 0 : arrowHeightOption;
    const [side, align] = sideAndAlign(placement);
    const noArrowAlign = { start: '0%', center: '50%', end: '100%' }[align];
    const cx = (middlewareData.arrow?.x ?? 0) + arrowWidth / 2; const cy = (middlewareData.arrow?.y ?? 0) + arrowHeight / 2;
    let x = ''; let y = '';
    if (side === 'bottom') { x = hidden ? noArrowAlign : `${cx}px`; y = `${-arrowHeight}px`; }
    else if (side === 'top') { x = hidden ? noArrowAlign : `${cx}px`; y = `${rects.floating.height + arrowHeight}px`; }
    else if (side === 'right') { x = `${-arrowHeight}px`; y = hidden ? noArrowAlign : `${cy}px`; }
    else { x = `${rects.floating.width + arrowHeight}px`; y = hidden ? noArrowAlign : `${cy}px`; }
    return { data: { x, y } };
  },
});

const roundByDPR = (value: number) => { const dpr = window.devicePixelRatio || 1; return Math.round(value * dpr) / dpr; };

/** Place `wrapper` against `anchor` until the returned cleanup runs (autoUpdate, as Radix's whileElementsMounted). */
export function placePopper(anchor: HTMLElement, wrapper: HTMLElement, arrow: HTMLElement | null, options: PopperOptions): () => void {
  const padding = options.collisionPadding;
  const middleware = [
    offset({ mainAxis: options.sideOffset + options.arrowHeight, alignmentAxis: 0 }),
    shift({ mainAxis: true, crossAxis: false, limiter: limitShift(), padding }),
    flip({ padding }),
    size({ padding, apply({ elements, rects, availableWidth, availableHeight }) {
      const style = elements.floating.style;
      style.setProperty('--radix-popper-available-width', `${availableWidth}px`);
      style.setProperty('--radix-popper-available-height', `${availableHeight}px`);
      style.setProperty('--radix-popper-anchor-width', `${rects.reference.width}px`);
      style.setProperty('--radix-popper-anchor-height', `${rects.reference.height}px`);
    } }),
    ...(arrow ? [arrowMiddleware({ element: arrow, padding: 0 })] : []),
    transformOrigin(options.arrowWidth, options.arrowHeight),
  ];
  const placement = (options.side + (options.align !== 'center' ? `-${options.align}` : '')) as Placement;
  const update = () => void computePosition(anchor, wrapper, { strategy: 'fixed', placement, middleware }).then(({ x, y, placement: placed, middlewareData }) => {
    wrapper.style.transform = `translate(${roundByDPR(x)}px, ${roundByDPR(y)}px)`;
    const origin = middlewareData.transformOrigin as { x?: string; y?: string } | undefined;
    wrapper.style.setProperty('--radix-popper-transform-origin', [origin?.x, origin?.y].join(' '));
    const [side, align] = sideAndAlign(placed);
    options.onPlaced({ side, align, arrowX: middlewareData.arrow?.x, arrowY: middlewareData.arrow?.y, hideArrow: middlewareData.arrow?.centerOffset !== 0 });
  });
  // Without ResizeObserver (an old engine, jsdom) placement still follows scroll and window resizes.
  return autoUpdate(anchor, wrapper, update, { elementResize: typeof ResizeObserver !== 'undefined' });
}

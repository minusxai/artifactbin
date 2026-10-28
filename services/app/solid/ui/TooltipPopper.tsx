/* @jsxImportSource solid-js */
/** Positioning and painted tooltip content load only when a trigger is used. */
import {createEffect,onCleanup,type JSX} from 'solid-js';
import {placePopper,type Placed,type Side} from '@/lib/islands/kit/popper';
import {ARROW_ORIGIN,ARROW_TRANSFORM} from '@/lib/islands/kit/tooltip-core';
import {appearanceOf} from './theme';
import {LAYER} from './layers';
export interface TooltipPopperProps { anchor: HTMLElement | undefined; id: string; side: Side; placed: () => Placed | undefined; setPlaced: (placed: Placed | undefined) => void; children: JSX.Element }

export default function TooltipPopper(p: TooltipPopperProps): JSX.Element {
  let wrapper!: HTMLDivElement; let arrow!: HTMLSpanElement;
  createEffect(() => {
    if (!p.anchor) return;
    const stop = placePopper(p.anchor, wrapper, arrow, { side: p.side, align: 'center', sideOffset: 6, collisionPadding: 8, arrowWidth: 10, arrowHeight: 5, onPlaced: p.setPlaced });
    onCleanup(() => { stop(); p.setPlaced(undefined); });
  });
  const side = () => p.placed()?.side ?? p.side;
  return <div data-mx-theme-host="" data-app-appearance={appearanceOf(p.anchor)}>
    <div ref={wrapper} data-radix-popper-content-wrapper="" style={{ position: 'fixed', left: '0px', top: '0px', transform: 'translate(0, -200%)', 'min-width': 'max-content', 'z-index': String(LAYER.tooltip) }}>
      <div role="tooltip" id={p.id} data-side={p.placed()?.side} data-slot="tooltip-content" data-story-floating=""
        class="pointer-events-none w-max max-w-[min(28rem,calc(100vw-1rem))] whitespace-normal rounded-control border border-edge-bright bg-surface px-2.5 py-1.5 text-left text-xs leading-normal text-fg shadow-md">
        {p.children}
        <span ref={arrow} style={{ position: 'absolute', left: side() === 'right' ? '0px' : p.placed()?.arrowX !== undefined ? `${p.placed()!.arrowX}px` : undefined, top: side() === 'bottom' ? '0px' : p.placed()?.arrowY !== undefined ? `${p.placed()!.arrowY}px` : undefined, right: side() === 'left' ? '0px' : undefined, bottom: side() === 'top' ? '0px' : undefined, 'transform-origin': ARROW_ORIGIN[side()] || undefined, transform: ARROW_TRANSFORM[side()], visibility: p.placed()?.hideArrow ? 'hidden' : undefined }}>
          <svg stroke="var(--color-edge-bright)" stroke-width="1" stroke-linejoin="round" class="fill-surface" width="10" height="5" viewBox="0 0 30 10" preserveAspectRatio="none" style={{ display: 'block' }}><polygon points="0,0 30,0 15,10" /></svg>
        </span>
      </div>
    </div>
  </div>;
}

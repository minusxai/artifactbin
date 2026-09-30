import { createEffect, createSignal, createUniqueId, onCleanup, untrack } from 'solid-js';
import type { Side } from './popper';

/**
 * THE TOOLTIP'S TIMING, ONCE — shared by the reader kit's Tooltip (./disclosure) and the app's
 * (solid/components/Tooltip), so both follow Radix's provider as one: open on hover after the delay
 * (300ms; at once within 100ms of any tooltip closing), at once on focus; close on Escape and when
 * any other tooltip opens. Type-only popper import: the kit keeps placement a lazy chunk.
 */
const TOOLTIP_OPEN = 'mx:tooltip-open';
const provider = { closedAt: 0 };

export type TooltipTiming = { state: () => 'closed' | 'delayed-open' | 'instant-open'; enter: () => void; openNow: () => void; close: () => void };

export function createTooltipTiming(o: { open: () => boolean; setOpen: (value: boolean) => void; delay?: () => number | undefined }): TooltipTiming {
  const id = createUniqueId();
  const [delayed, setDelayed] = createSignal(false);
  let timer = 0;
  const set = (value: boolean) => {
    if (value === untrack(o.open)) return;
    if (value) document.dispatchEvent(new CustomEvent(TOOLTIP_OPEN, { detail: id })); else provider.closedAt = Date.now();
    o.setOpen(value);
  };
  const openNow = () => { clearTimeout(timer); timer = 0; setDelayed(false); set(true); };
  const close = () => { clearTimeout(timer); timer = 0; set(false); };
  const enter = () => {
    if (Date.now() - provider.closedAt < 100) { openNow(); return; }
    clearTimeout(timer); timer = window.setTimeout(() => { setDelayed(true); set(true); timer = 0; }, o.delay?.() ?? 300);
  };
  onCleanup(() => clearTimeout(timer));
  createEffect(() => {
    if (!o.open()) return;
    const other = (e: Event) => { if ((e as CustomEvent).detail !== id) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener(TOOLTIP_OPEN, other); document.addEventListener('keydown', esc);
    onCleanup(() => { document.removeEventListener(TOOLTIP_OPEN, other); document.removeEventListener('keydown', esc); });
  });
  return { state: () => (o.open() ? (delayed() ? 'delayed-open' : 'instant-open') : 'closed'), enter, openNow, close };
}

/** Radix's arrow: the SVG points down, turned to face the trigger from the placed side. */
export const ARROW_TRANSFORM: Record<Side, string> = { top: 'translateY(100%)', right: 'translateY(50%) rotate(90deg) translateX(-50%)', bottom: 'rotate(180deg)', left: 'translateY(50%) rotate(-90deg) translateX(50%)' };
export const ARROW_ORIGIN: Record<Side, string> = { top: '', right: '0 0', bottom: 'center 0', left: '100% 0' };
export const OPPOSITE: Record<Side, Side> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };

import { createEffect, on, onCleanup, onMount, untrack } from 'solid-js';

/**
 * Radix's CollapsibleContent measurement (CollapsibleContentImpl), which Accordion and Collapsible
 * content both run in the retired React kit. Once mounted, and on every open/close, it writes through the
 * CSSOM — so the served `style` string comes back in the CSSOM's form, as it does on today's page:
 *  - `transition-duration: 0s; animation-name: none` while it measures, kept for content that was
 *    open on mount until its first change after the first frame, restored (removed) otherwise;
 *  - the measured size as `--radix-collapsible-content-height/-width`, written when it changed and
 *    the content has a size (closing content keeps the size it was measured at while open).
 */
export function collapsibleStyle(node: () => HTMLElement | undefined, open: () => boolean): void {
  let prevented = untrack(open);
  let originals: { transitionDuration: string; animationName: string } | undefined;
  const written: { height?: string; width?: string } = {};
  const measure = () => {
    const el = node();
    if (!el) return;
    originals ??= { transitionDuration: el.style.transitionDuration, animationName: el.style.animationName };
    el.style.transitionDuration = '0s';
    el.style.animationName = 'none';
    const rect = el.getBoundingClientRect();
    if (!prevented) {
      el.style.transitionDuration = originals.transitionDuration;
      el.style.animationName = originals.animationName;
    }
    if (!rect.height && !rect.width) return;
    const height = rect.height ? `${rect.height}px` : undefined;
    const width = rect.width ? `${rect.width}px` : undefined;
    for (const [key, value] of [['height', height], ['width', width]] as const) {
      if (value === written[key]) continue;
      if (value === undefined) el.style.removeProperty(`--radix-collapsible-content-${key}`);
      else el.style.setProperty(`--radix-collapsible-content-${key}`, value);
      written[key] = value;
    }
  };
  onMount(() => {
    const frame = requestAnimationFrame(() => { prevented = false; });
    onCleanup(() => cancelAnimationFrame(frame));
    createEffect(on(open, measure));
  });
}

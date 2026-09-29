/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';

type P = Omit<JSX.HTMLAttributes<HTMLElement>, 'ref'>;
export function Skeleton(props: P) { return <div data-slot="skeleton" {...props} />; }
/**
 * Today's React wrapper (components/kit/progress) destructures `value` off the props it spreads onto
 * ProgressPrimitive.Root, so Radix's Root NEVER sees a value — it always computes state from `null`
 * ("indeterminate", no aria-valuenow/data-value) — only the indicator's inline transform uses the real
 * number. Ported as-is: this IS today's render, not the state a value would earn from an unmodified Root.
 */
export function Progress(props: P & { value?: number | string }) {
  const { value, ...rest } = props;
  const n = Number(value) || 0;
  return <div data-state="indeterminate" data-max="100" data-slot="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" {...rest}><div data-state="indeterminate" data-max="100" data-slot="progress-indicator" class="h-full w-full flex-1 bg-primary transition-all" style={{ transform: `translateX(-${100 - n}%)` }} /></div>;
}
export function Separator(props: P & { orientation?: 'horizontal' | 'vertical'; decorative?: boolean }) {
  const { orientation = 'horizontal', decorative = true, ...rest } = props;
  return <div data-orientation={orientation} aria-orientation={!decorative && orientation === 'vertical' ? 'vertical' : undefined} role={decorative ? 'none' : 'separator'} data-slot="separator" {...rest} />;
}
export function SlideDeck(props: P) { return <div {...props} />; }
export function Slide(props: P & { title?: string }) {
  const { title, ...rest } = props;
  return <section data-mx-slide="" data-mx-slide-title={title} {...rest} />;
}

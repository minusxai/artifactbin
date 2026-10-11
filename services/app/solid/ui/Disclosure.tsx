/* @jsxImportSource solid-js */
/**
 * THE DISCLOSURE: a native <details>/<summary>, so the browser keeps its open state, keyboard toggle and
 * find-in-page, drawn in the app's look instead of the native triangle — the summary is a row whose chevron turns
 * when it opens. `summary` is that row's content (a label, optionally a hint after it); `open` is the initial state.
 * `size` follows the controls (md in forms, sm in chrome); `inset` pads the summary for a disclosure that is a flush
 * Panel's whole body. Every other attribute (`hidden`, `id`, `class` for layout, data-*) lands on the <details>.
 */
import { splitProps, type JSX } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import type { ControlSize } from './control-styles';

const SUMMARY = {
  md: 'gap-2 font-sans text-sm font-medium',
  sm: 'gap-1.5 font-mono text-xs',
} as const;

type DisclosureProps = Omit<JSX.DetailsHtmlAttributes<HTMLDetailsElement>, 'children' | 'class'> & {
  summary: JSX.Element; size?: ControlSize; inset?: boolean; class?: string; children: JSX.Element;
};

export function Disclosure(props: DisclosureProps): JSX.Element {
  const [own, rest] = splitProps(props, ['summary', 'size', 'inset', 'class', 'children']);
  const size = () => own.size ?? 'md';
  return <details {...rest} class={`group ${own.class ?? ''}`}>
    <summary class={`flex w-full cursor-pointer list-none items-center rounded-chip text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/30 [&::-webkit-details-marker]:hidden ${SUMMARY[size()]} ${own.inset ? 'px-4 py-3 sm:px-5' : ''}`}>
      <ChevronRight size={size() === 'md' ? 15 : 13} aria-hidden="true" class="shrink-0 text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      {own.summary}
    </summary>
    {own.children}
  </details>;
}

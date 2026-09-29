/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
export default function StepHeader(props: { n: number; title: string; children?: JSX.Element }): JSX.Element {
  return <header class="border-b border-edge p-4 sm:p-5">
    <p class="text-[10px] font-medium tracking-widest text-accent uppercase">Step {props.n}</p>
    <h2 class="mt-0.5 text-sm font-semibold text-fg">{props.title}</h2>
    {props.children && <p class="mt-1 text-xs leading-5 text-muted">{props.children}</p>}
  </header>;
}

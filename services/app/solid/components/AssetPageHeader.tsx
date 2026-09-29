/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
import type { Component } from 'solid-js';
import { LINK } from './ui';

export default function AssetPageHeader(props: {
  icon: Component<{ size?: number }>;
  eyebrow: string;
  title: string;
  link: { href: string; label: string; text: string };
  actions?: JSX.Element;
}): JSX.Element {
  const Icon = props.icon;
  return <header class="mb-7 flex flex-wrap items-center justify-between gap-4">
    <div class="flex min-w-0 items-center gap-3">
      <span class="rounded-xl border border-edge bg-surface p-2.5 text-accent"><Icon size={22} /></span>
      <div class="min-w-0"><p class="mb-1 text-[10px] font-medium tracking-widest text-muted uppercase">{props.eyebrow}</p><h1 class="truncate text-2xl font-semibold tracking-tight text-fg">{props.title}</h1></div>
    </div>
    <div class="flex flex-wrap items-center gap-3">{props.actions}<a href={props.link.href} aria-label={props.link.label} class={`font-mono text-xs ${LINK}`}>{props.link.text} →</a></div>
  </header>;
}

/* @jsxImportSource solid-js */
/** The page's one h1 with its description and actions, the one h2 size every section uses, and FormPage, the narrow card a login or import page sits in. */
import { Show, type JSX } from 'solid-js';

export function PageHeader(props: { title: JSX.Element; description?: JSX.Element; actions?: JSX.Element; leading?: JSX.Element; badge?: JSX.Element; children?: JSX.Element; class?: string }): JSX.Element {
  return <header class={`flex flex-col gap-4 font-sans ${props.class ?? ''}`}>
    <div class="flex items-start gap-4">
      <Show when={props.leading}>{props.leading}</Show>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="break-words text-3xl font-semibold tracking-tight text-fg">{props.title}</h1>
          <Show when={props.badge}>{props.badge}</Show>
        </div>
        <Show when={props.description}><div class="mt-1 max-w-2xl break-words text-sm leading-relaxed text-muted">{props.description}</div></Show>
      </div>
      <Show when={props.actions}><div class="flex shrink-0 flex-wrap items-center gap-2">{props.actions}</div></Show>
    </div>
    <Show when={props.children}>{props.children}</Show>
  </header>;
}

export function SectionHeading(props: { id?: string; class?: string; children: JSX.Element }): JSX.Element {
  return <h2 id={props.id} class={`font-sans text-lg font-semibold text-fg ${props.class ?? ''}`}>{props.children}</h2>;
}

/** The login/import page spacing: a centred column holding one card (`narrow`, a single form) or a wider stack of sections. */
export function FormPage(props: { narrow?: boolean; children: JSX.Element }): JSX.Element {
  return <main class="mx-auto my-10 w-full max-w-2xl px-5 font-sans sm:my-16 sm:px-8"><div class={props.narrow ? 'mx-auto max-w-md rounded-2xl border border-edge bg-surface p-6 shadow-sm sm:p-8' : 'space-y-6 rounded-xl border border-edge bg-surface p-6 text-sm text-fg sm:p-8'}>{props.children}</div></main>;
}

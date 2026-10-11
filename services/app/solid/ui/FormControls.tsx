/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
/** First-party form presentation, independent of accounts and transports. */
export const FORM_INPUT = 'w-full min-h-11 rounded-lg border border-edge-bright bg-surface px-3 py-2 font-sans text-sm text-fg placeholder:text-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60';
export const FORM_PRIMARY_BUTTON = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-action bg-action px-4 py-2 font-sans text-sm font-semibold text-action-ink transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';
export const FORM_SECONDARY_BUTTON = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-edge-bright bg-surface px-4 py-2 font-sans text-sm font-medium text-fg transition-colors hover:border-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';
export const FORM_DANGER_BUTTON = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-edge-bright bg-surface px-4 py-2 font-sans text-sm font-medium text-danger transition-colors hover:border-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-50';

/** The same login/import page spacing, kept in the app's scanned presentation boundary. */
export function FormPage(props: { narrow?: boolean; children: JSX.Element }): JSX.Element {
  return <main class="mx-auto my-10 w-full max-w-2xl px-5 font-sans sm:my-16 sm:px-8"><div class={props.narrow ? 'mx-auto max-w-md rounded-2xl border border-edge bg-surface p-6 shadow-sm sm:p-8' : 'space-y-6 rounded-xl border border-edge bg-surface p-6 text-sm text-fg sm:p-8'}>{props.children}</div></main>;
}

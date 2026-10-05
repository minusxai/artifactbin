/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
/** First-party form presentation, independent of accounts and transports. */
export const FORM_INPUT = 'w-full rounded-[4px] border border-edge bg-surface px-3 py-1.5 font-mono text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none';
export const FORM_PRIMARY_BUTTON = 'cursor-pointer rounded-[4px] border border-accent bg-accent px-3 py-1.5 font-mono text-xs font-semibold text-bg transition-colors hover:brightness-110 disabled:opacity-50';
export const FORM_SECONDARY_BUTTON = 'cursor-pointer rounded-[4px] border border-edge bg-surface px-3 py-1.5 font-mono text-xs font-semibold text-fg transition-colors hover:bg-raised disabled:opacity-50';

/** The same login/import page spacing, kept in the app's scanned presentation boundary. */
export function FormPage(props: { narrow?: boolean; children: JSX.Element }): JSX.Element {
  return <main class="mx-auto mt-16 max-w-xl px-6"><div class={props.narrow ? 'mx-auto max-w-sm' : 'space-y-5 font-mono text-sm text-fg'}>{props.children}</div></main>;
}

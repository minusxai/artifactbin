/* @jsxImportSource solid-js */
import { createEffect, createUniqueId, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';

/** One modal confirmation; the caller owns mutation and refusal state. */
export function ConfirmDialog(props: { title: string; description: JSX.Element; action: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; busy?: boolean; error?: string | null; onConfirm: () => void; onCancel: () => void }): JSX.Element {
  let panel!: HTMLDivElement;
  let cancel!: HTMLButtonElement;
  const heading = createUniqueId();
  const detail = createUniqueId();
  createEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!props.busy) props.onCancel(); return; }
      if (event.key !== 'Tab') return;
      const stops = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])')];
      if (!stops.length) { event.preventDefault(); return; }
      const first = stops[0]!; const last = stops[stops.length - 1]!;
      const active = (panel.getRootNode() as Document | ShadowRoot).activeElement;
      if (!panel.contains(active) || (event.shiftKey ? active === first : active === last)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    };
    window.addEventListener('keydown', key, true);
    onCleanup(() => { window.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus(); });
  });
  return <Portal mount={trustedPortalOf(document) ?? document.body}><div class="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onMouseDown={event => { if (event.target === event.currentTarget && !props.busy) props.onCancel(); }}><div ref={panel} role="dialog" aria-modal="true" aria-labelledby={heading} aria-describedby={detail} aria-busy={props.busy} class="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-edge-bright bg-surface p-6 text-fg shadow-2xl"><h2 id={heading} class="text-base font-semibold">{props.title}</h2><div id={detail} class="mt-3 break-words text-sm leading-relaxed text-muted">{props.description}</div><Show when={props.error}><p role="alert" class="mt-3 text-sm text-danger">{props.error}</p></Show><div class="mt-6 flex justify-end gap-3"><button ref={cancel} type="button" aria-label={props.cancelLabel} disabled={props.busy} onClick={props.onCancel} class="rounded-md border border-edge px-4 py-2 text-sm text-muted">Cancel</button><button type="button" aria-label={props.confirmLabel} disabled={props.busy} onClick={props.onConfirm} class={`rounded-md border px-4 py-2 text-sm font-medium ${props.danger ? 'border-danger/40 bg-danger-soft text-danger' : 'border-accent/40 bg-accent-soft text-accent'}`}>{props.action}{props.busy ? '…' : ''}</button></div></div></div></Portal>;
}

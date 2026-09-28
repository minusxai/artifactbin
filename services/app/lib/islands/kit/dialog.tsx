/* @jsxImportSource solid-js */
import { createContext, createEffect, createSignal, splitProps, onCleanup, useContext, type JSX } from 'solid-js';
import { TrustedOverlay } from './trusted-overlay';

type DialogState = { open: () => boolean; setOpen: (value: boolean) => void; trigger: () => HTMLElement | null; setTrigger: (value: HTMLElement | null) => void };
const Context = createContext<DialogState>();
const state = () => { const ctx = useContext(Context); if (!ctx) throw new Error('Dialog child outside Dialog'); return ctx; };
export function Dialog(props: JSX.HTMLAttributes<HTMLSpanElement> & { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [local, setLocal] = createSignal(!!props.defaultOpen); const [trigger, setTrigger] = createSignal<HTMLElement | null>(null);
  const ctx: DialogState = { open: () => props.open ?? local(), setOpen: next => { setLocal(next); props.onOpenChange?.(next); }, trigger, setTrigger };
  const [localProps, rest] = splitProps(props, ['open', 'defaultOpen', 'onOpenChange', 'children']);
  return <Context.Provider value={ctx}><span {...(rest as unknown as JSX.HTMLAttributes<HTMLSpanElement>)} class={`contents ${props.class ?? ''}`}>{localProps.children}</span></Context.Provider>;
}
type TriggerProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & { wrapsControl?: boolean };
export function DialogTrigger(props: TriggerProps) {
  const ctx = state(); const { wrapsControl, type: _type, ref: _ref, ...rest } = props;
  const act = (target: EventTarget | null) => { ctx.setTrigger((target as HTMLElement)?.closest?.('button, input, select, textarea, a[href], [tabindex="0"]') ?? null); ctx.setOpen(true); };
  if (wrapsControl) return <span {...(rest as unknown as JSX.HTMLAttributes<HTMLSpanElement>)} class={`contents ${props.class ?? ''}`} on:click={event => { if (!props.disabled) act(event.target); }}>{props.children}</span>;
  return <button {...rest} type="button" disabled={props.disabled} on:click={event => act(event.currentTarget)}>{props.children}</button>;
}
export function DialogClose(props: TriggerProps) {
  const ctx = state(); const { wrapsControl, type: _type, ref: _ref, ...rest } = props;
  if (wrapsControl) return <span {...(rest as unknown as JSX.HTMLAttributes<HTMLSpanElement>)} class={`contents ${props.class ?? ''}`} on:click={() => ctx.setOpen(false)}>{props.children}</span>;
  return <button {...rest} type="button" on:click={() => ctx.setOpen(false)}>{props.children}</button>;
}
export function DialogContent(props: JSX.DialogHtmlAttributes<HTMLDialogElement> & { run?: unknown; onSubmitMutation?: () => Promise<unknown>; unavailable?: JSX.Element; conflictMessage?: string }) {
  const ctx = state(); let dialog!: HTMLDialogElement; let openedDialog: HTMLDialogElement | null = null;
  const { run: _run, onSubmitMutation: _onSubmitMutation, unavailable: _unavailable, conflictMessage: _conflictMessage, onKeyDown: _onKeyDown, ...rest } = props;
  createEffect(() => {
    if (ctx.open()) { if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); } openedDialog = dialog; }
    else if (openedDialog?.open) { if (typeof openedDialog.close === 'function') openedDialog.close(); else openedDialog.removeAttribute('open'); openedDialog = null; queueMicrotask(() => ctx.trigger()?.focus()); }
  });
  onCleanup(() => { if (openedDialog?.open && typeof openedDialog.close === 'function') openedDialog.close(); });
  return <TrustedOverlay open={ctx.open}><dialog ref={dialog} role={ctx.open() ? 'dialog' : undefined} aria-modal="true" tabIndex={props.tabIndex ?? -1} {...rest} on:keydown={event => {
    if (event.key === 'Escape') { event.preventDefault(); ctx.setOpen(false); }
    if (event.key === 'Tab') {
      const stops = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')].filter(el => !el.closest('[hidden], [inert], fieldset[disabled]'));
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (!stops.length || document.activeElement === edge || document.activeElement === dialog) { event.preventDefault(); (event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus(); }
    }
  }} on:cancel={event => { event.preventDefault(); ctx.setOpen(false); }} on:close={() => ctx.setOpen(false)}>{props.children}</dialog></TrustedOverlay>;
}

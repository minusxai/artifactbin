/* @jsxImportSource solid-js */
import { Show, createContext, createEffect, createSignal, splitProps, onCleanup, onMount, useContext, type JSX } from 'solid-js';
import { refName, resolveBindings, type BindingSource } from '@/lib/story/data/dataflow';
import { refusalText } from '@/lib/story/reader/sign-in-required';
import { useIsland } from '../context';
import { ACCESS_PENDING, hydratedRead } from './store-read';

type DialogState = { open: () => boolean; setOpen: (value: boolean) => void; trigger: () => HTMLElement | null; setTrigger: (value: HTMLElement | null) => void; busy: () => boolean; setBusy: (value: boolean) => void };
const Context = createContext<DialogState>();
const state = () => { const ctx = useContext(Context); if (!ctx) throw new Error('Dialog child outside Dialog'); return ctx; };
export function Dialog(props: JSX.HTMLAttributes<HTMLSpanElement> & { open?: boolean | string; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const island = useIsland();
  const [local, setLocal] = createSignal(!!props.defaultOpen); const [trigger, setTrigger] = createSignal<HTMLElement | null>(null); const [busy, setBusy] = createSignal(false);
  const name = refName(props.open);
  const ctx: DialogState = {
    open: () => name ? island.value(name) === true : typeof props.open === 'boolean' ? props.open : local(),
    setOpen: next => { if (name) island.setValue(name, next); else setLocal(next); props.onOpenChange?.(next); },
    trigger, setTrigger, busy, setBusy,
  };
  const [localProps, rest] = splitProps(props, ['open', 'defaultOpen', 'onOpenChange', 'children']);
  return <Context.Provider value={ctx}><span {...(rest as unknown as JSX.HTMLAttributes<HTMLSpanElement>)} class={`contents ${props.class ?? ''}`}>{localProps.children}</span></Context.Provider>;
}
type TriggerProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & { wrapsControl?: boolean };
export function DialogTrigger(props: TriggerProps) {
  const ctx = state(); const { wrapsControl, type: _type, ref: _ref, ...rest } = props;
  const act = (target: EventTarget | null) => { if (ctx.busy()) return; ctx.setTrigger((target as HTMLElement)?.closest?.('button, input, select, textarea, a[href], [tabindex="0"]') ?? null); ctx.setOpen(true); };
  if (wrapsControl) return <span {...(rest as unknown as JSX.HTMLAttributes<HTMLSpanElement>)} class={`contents ${props.class ?? ''}`} on:click={event => { if (!props.disabled) act(event.target); }}>{props.children}</span>;
  return <button {...rest} type="button" disabled={props.disabled || ctx.busy()} on:click={event => act(event.currentTarget)}>{props.children}</button>;
}
export function DialogClose(props: TriggerProps) {
  const ctx = state(); const { wrapsControl, type: _type, ref: _ref, ...rest } = props;
  if (wrapsControl) return <span {...(rest as unknown as JSX.HTMLAttributes<HTMLSpanElement>)} data-mx-dialog-close="" class={`contents ${props.class ?? ''}`} on:click={() => { if (!ctx.busy()) ctx.setOpen(false); }}>{props.children}</span>;
  return <button {...rest} data-mx-dialog-close="" type="button" disabled={props.disabled || ctx.busy()} on:click={() => ctx.setOpen(false)}>{props.children}</button>;
}
/**
 * `<DialogContent run="$add" args={{…}}>`: the dialog is a FORM that performs the named `<Mutation>` on
 * submit (today's DialogContentAdapter and components/kit/dialog): its fields sit in a `display:contents`
 * fieldset disabled while the write is in flight or refused, a refusal the reader cannot act on says why
 * (`role="status"`: a guest's `$_me` write is "Unavailable while signed out."), a saved write closes the
 * dialog, and a failed one is shown in a `role="alert"` with the dialog left open.
 */
function MutationForm(props: { name: string; args: unknown; stacked: boolean; children: JSX.Element }) {
  const ctx = state(); const island = useIsland(); const store = island.store();
  const unavailable = hydratedRead(() => island.mutationUnavailable(props.name), { value: ACCESS_PENDING });
  const [error, setError] = createSignal<string | null>(null);
  let submitting = false;
  const read = () => props.args && typeof props.args === 'object' && store
    ? resolveBindings(props.args as Record<string, BindingSource>, (ref) => (ref === '_me.id' ? (() => { const v = island.viewer(); return v && 'id' in v ? v.id : null; })() : store.getValue(ref)))
    : undefined;
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (submitting || unavailable() !== null || !store || !form.reportValidity()) return;
    submitting = true; ctx.setBusy(true); setError(null);
    store.mutate(props.name, read()).then(() => { ctx.setBusy(false); ctx.setOpen(false); }, (failure: unknown) => setError(failure instanceof Error ? failure.message : 'That did not save'))
      .finally(() => { submitting = false; ctx.setBusy(false); });
  };
  return <form class={props.stacked ? 'contents' : undefined} on:submit={submit}>
    <fieldset disabled={ctx.busy() || unavailable() !== null || !store} class="contents">{props.children}</fieldset>
    <Show when={unavailable()}><p role="status">{refusalText(unavailable())}</p></Show>
    <Show when={error()}><p role="alert" class="text-destructive">{error()}</p></Show>
  </form>;
}

export function DialogContent(props: JSX.DialogHtmlAttributes<HTMLDialogElement> & { run?: unknown; args?: unknown; stacked?: boolean; onSubmitMutation?: () => Promise<unknown>; unavailable?: JSX.Element; conflictMessage?: string }) {
  const ctx = state(); const island = useIsland(); let dialog!: HTMLDialogElement; let openedDialog: HTMLDialogElement | null = null;
  const { run: _run, args: _args, stacked: _stacked, onSubmitMutation: _onSubmitMutation, unavailable: _unavailable, conflictMessage: _conflictMessage, onKeyDown: _onKeyDown, ...rest } = props;
  const mutation = typeof props.run === 'string' ? refName(props.run) : null;
  onMount(() => {
    const closeFromServedNode = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-mx-dialog-close]') : null;
      if (target && dialog.contains(target) && !ctx.busy()) ctx.setOpen(false);
    };
    dialog.addEventListener('click', closeFromServedNode);
    const home = document.createComment('dialog-home'); dialog.before(home);
    createEffect(() => {
      const open = ctx.open();
      // Native modal top-layer state belongs to the current portal; close it before reparenting.
      if (!open && openedDialog?.open) {
        if (typeof openedDialog.close === 'function') openedDialog.close(); else openedDialog.removeAttribute('open');
        openedDialog = null;
        queueMicrotask(() => ctx.trigger()?.focus());
      }
      const destination = open ? island.trustedPortal() : null;
      if (destination) destination.append(dialog);
      else home.parentNode?.insertBefore(dialog, home.nextSibling);
      if (open) {
        if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
        openedDialog = dialog;
        // React and native dialog focus differ inside a framed reader; honor the authored field after opening.
        requestAnimationFrame(() => {
          if (dialog.open) (dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])'))?.focus();
        });
      }
    });
    onCleanup(() => { dialog.removeEventListener('click', closeFromServedNode); home.remove(); });
  });
  onCleanup(() => { if (openedDialog?.open && typeof openedDialog.close === 'function') openedDialog.close(); });
  return <dialog ref={dialog} role={ctx.open() ? 'dialog' : undefined} aria-modal="true" tabIndex={props.tabIndex ?? -1} {...rest} on:click={event => { if (event.target === dialog && !ctx.busy()) ctx.setOpen(false); }} on:keydown={event => {
    if (event.key === 'Escape') { event.preventDefault(); if (!ctx.busy()) ctx.setOpen(false); }
    if (event.key === 'Tab') {
      const stops = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')].filter(el => !el.closest('[hidden], [inert], fieldset[disabled]'));
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (!stops.length || document.activeElement === edge || document.activeElement === dialog) { event.preventDefault(); (event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus(); }
    }
  }} on:cancel={event => { event.preventDefault(); if (!ctx.busy()) ctx.setOpen(false); }} on:close={() => { if (!ctx.busy()) ctx.setOpen(false); }}>{mutation ? <MutationForm name={mutation} args={props.args} stacked={props.stacked ?? !props.class}>{props.children}</MutationForm> : props.children}</dialog>;
}

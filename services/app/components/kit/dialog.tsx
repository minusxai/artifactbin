import React, {createContext, useContext, useEffect, useRef, useState} from 'react';

interface DialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
  trigger: React.RefObject<HTMLElement | null>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}
const Context = createContext<DialogState | null>(null);
const ArtifactScope = createContext(false);
/** Inline documents may cover their content, but must leave app chrome usable. */
export function ArtifactDialogScope({children}: {children: React.ReactNode}) {
  return <ArtifactScope.Provider value>{children}</ArtifactScope.Provider>;
}

export function Dialog({open, defaultOpen = false, onOpenChange, children, ...props}: Omit<React.HTMLAttributes<HTMLSpanElement>, 'onChange'> & {open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void}) {
  const [local, setLocal] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const setOpen = (next: boolean) => {setLocal(next); onOpenChange?.(next);};
  return <Context.Provider value={{open: typeof open === 'boolean' ? open : local, setOpen, trigger, busy, setBusy}}><span {...props} className={`contents ${props.className ?? ''}`}>{children}</span></Context.Provider>;
}

export function DialogTrigger({children, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(Context);
  return <button {...props} type="button" disabled={props.disabled || !context || context.busy} onClick={event => {
    if (!context) return;
    context.trigger.current = event.currentTarget;
    context.setOpen(true);
  }}>{children}</button>;
}

export function DialogClose({children, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(Context);
  return <button {...props} type="button" disabled={props.disabled || !context || context.busy} onClick={() => context?.setOpen(false)}>{children}</button>;
}

export interface DialogContentProps extends React.DialogHTMLAttributes<HTMLDialogElement> {
  run?: unknown;
  onSubmitMutation?: () => Promise<unknown>;
  unavailable?: string | null;
  conflictMessage?: string;
}

export function DialogContent({children, run, onSubmitMutation, unavailable, conflictMessage, ...props}: DialogContentProps) {
  const context = useContext(Context);
  const ref = useRef<HTMLDialogElement>(null);
  const artifactScoped = useContext(ArtifactScope);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const open = context?.open ?? false;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setError(null);
      if (artifactScoped) dialog.show(); else dialog.showModal();
      // show() performs the native dialog focusing steps too. Preserve its
      // chosen field: React autoFocus does not leave an [autofocus] attribute,
      // so focusing the container here would silently undo that choice.
      dialog.querySelector<HTMLElement>('[autofocus]')?.focus({preventScroll: true});
    }
    if (!open && dialog.open) {
      dialog.close();
      queueMicrotask(() => {
        if (context?.trigger.current?.isConnected) context.trigger.current.focus({preventScroll: true});
      });
    }
  }, [open, context, artifactScoped]);
  return <>
  {artifactScoped && open && <div aria-hidden="true" data-artifact-dialog-backdrop="" style={{position:'fixed', inset:0, zIndex:2147482000, background:'rgb(0 0 0 / .45)'}} onClick={() => {if (!submitting.current) context?.setOpen(false);}} />}
  <dialog {...props} ref={ref} tabIndex={props.tabIndex ?? -1}
    style={artifactScoped ? {...props.style, position:'fixed', inset:0, margin:'auto', zIndex:2147482001} : props.style}
    onKeyDown={event => {
      props.onKeyDown?.(event);
      if (!artifactScoped || event.defaultPrevented) return;
      if (event.key === 'Escape') {event.preventDefault(); if (!submitting.current) context?.setOpen(false);}
      if (event.key === 'Tab') {
        const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')].filter(el => !el.closest('[hidden], [inert], fieldset[disabled]'));
        const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
        if (!stops.length || document.activeElement === edge || document.activeElement === event.currentTarget) {
          event.preventDefault();
          (event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
        }
      }
    }} onCancel={event => {
    event.preventDefault();
    if (!submitting.current) context?.setOpen(false);
  }} onClose={() => {if (open && !submitting.current) context?.setOpen(false);}}>
    {run || onSubmitMutation ? <form onSubmit={event => {
      event.preventDefault();
      if (submitting.current || unavailable || !onSubmitMutation || !event.currentTarget.reportValidity()) return;
      submitting.current = true;
      context?.setBusy(true);
      setError(null);
      Promise.resolve().then(onSubmitMutation).then(() => {
        // Re-enable the trigger in the same render that closes the dialog;
        // browsers cannot focus a disabled button during close restoration.
        context?.setBusy(false);
        context?.setOpen(false);
      }).catch((failure: unknown) => {
        const message = failure instanceof Error ? failure.message : 'That did not save';
        setError(conflictMessage && /row_changed|changed/.test(message) ? conflictMessage : message);
      }).finally(() => {submitting.current = false; context?.setBusy(false);});
    }}><fieldset disabled={context?.busy || !!unavailable || !onSubmitMutation} className="contents">{children}</fieldset>
      {unavailable ? <p role="status">{unavailable}</p> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </form> : children}
  </dialog></>;
}

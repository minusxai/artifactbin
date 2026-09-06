import React, {createContext, useContext, useEffect, useRef, useState} from 'react';

interface DialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
  trigger: React.RefObject<HTMLElement | null>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}
const Context = createContext<DialogState | null>(null);

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
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const open = context?.open ?? false;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setError(null); dialog.showModal();
      dialog.querySelector<HTMLElement>('[autofocus]')?.focus({preventScroll: true});
    }
    if (!open && dialog.open) {
      dialog.close();
      if (context?.trigger.current?.isConnected) context.trigger.current.focus({preventScroll: true});
    }
  }, [open, context]);
  return <dialog {...props} ref={ref} onCancel={event => {
    event.preventDefault();
    if (!submitting.current) context?.setOpen(false);
  }} onClose={() => {if (open && !submitting.current) context?.setOpen(false);}}>
    {run || onSubmitMutation ? <form onSubmit={event => {
      event.preventDefault();
      if (submitting.current || unavailable || !onSubmitMutation || !event.currentTarget.reportValidity()) return;
      submitting.current = true;
      context?.setBusy(true);
      setError(null);
      Promise.resolve().then(onSubmitMutation).then(() => context?.setOpen(false)).catch((failure: unknown) => {
        const message = failure instanceof Error ? failure.message : 'That did not save';
        setError(conflictMessage && /row_changed|changed/.test(message) ? conflictMessage : message);
      }).finally(() => {submitting.current = false; context?.setBusy(false);});
    }}><fieldset disabled={context?.busy || !!unavailable || !onSubmitMutation} className="contents">{children}</fieldset>
      {unavailable ? <p role="status">{unavailable}</p> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </form> : children}
  </dialog>;
}

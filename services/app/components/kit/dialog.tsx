import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {buttonVariants} from './button';
import {cn} from './cn';

/**
 * What a `<dialog>` looks like when the author styled nothing.
 *
 * Tailwind's preflight strips the UA's dialog padding and border, so an
 * unstyled dialog is a square white box flush against its own text. These are
 * the kit's own chrome, merged so an author `className` wins on conflict:
 * `p-0` replaces the padding rather than fighting it. `m-auto` centres it on the
 * unscoped `showModal()` path, where preflight has zeroed the UA margin; the
 * scoped inline `style` (position/inset/margin/zIndex) is separate and untouched.
 */
const DIALOG_CONTENT_CLASS = 'm-auto max-h-[calc(100svh-4rem)] w-fit max-w-[min(32rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-lg';

interface DialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
  trigger: React.RefObject<HTMLElement | null>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}
const Context = createContext<DialogState | null>(null);
/**
 * Everything a reader can reach with the keyboard: the Tab trap's stops inside
 * an open dialog, and — for a trigger that delegates to the control the author
 * put inside it — which element was actually clicked, so closing can hand the
 * focus back to it.
 */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]';
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

/**
 * A trigger DRAWS a `<button>` — unless the author already put a control
 * inside it, and then it must not.
 *
 * `<DialogTrigger><Button>Add task</Button></DialogTrigger>` is the shape an
 * author reaches for (the Radix `asChild` habit), and two nested `<button>`s
 * are not HTML: parsing the served page closes the outer one and PROMOTES the
 * inner one to its sibling, so the browser's DOM and React's tree disagree and
 * hydration dies with error 418. With a control inside, the trigger becomes a `display:contents`
 * span that acts when that control is clicked: one button in the DOM — the
 * author's, with its own id and styling — and the same markup on both sides.
 *
 * `wrapsControl` is decided by the interpreter (lib/story-ui/interpreter),
 * which knows the authored tag names; a `child.type` check here would have to
 * track every adapter the runtime registry substitutes for them.
 */
type TriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {wrapsControl?: boolean};

function ControlDelegate({children, act, ...props}: TriggerProps & {act: (control: HTMLElement | null) => void}) {
  const {disabled, type: _type, ...rest} = props;
  return <span {...rest} className={`contents ${props.className ?? ''}`} onClick={event => {
    if (disabled) return;
    act((event.target as HTMLElement).closest<HTMLElement>(FOCUSABLE));
  }}>{children}</span>;
}

export function DialogTrigger({children, wrapsControl, ...props}: TriggerProps) {
  const context = useContext(Context);
  const open = (control: HTMLElement | null) => {
    if (!context || context.busy) return;
    context.trigger.current = control;
    context.setOpen(true);
  };
  if (wrapsControl) return <ControlDelegate {...props} act={open}>{children}</ControlDelegate>;
  // A trigger the kit DRAWS is a button, so it looks like one. An author who
  // passes a className is styling it themselves and gets exactly that: this is
  // the default look, not a base the author has to undo. An EMPTY className
  // (`class=""` survives the interpreter's attribute pass) is not styling, so
  // it still takes the default rather than rendering the trigger as bare text.
  return <button {...props} type="button" className={props.className || buttonVariants()} disabled={props.disabled || !context || context.busy} onClick={event => {
    if (!context) return;
    context.trigger.current = event.currentTarget;
    context.setOpen(true);
  }}>{children}</button>;
}

export function DialogClose({children, wrapsControl, ...props}: TriggerProps) {
  const context = useContext(Context);
  if (wrapsControl) return <ControlDelegate {...props} act={() => {if (!context?.busy) context?.setOpen(false);}}>{children}</ControlDelegate>;
  // The same rule as the trigger: a drawn Close is a button, quieter than the action beside it.
  return <button {...props} type="button" className={props.className || buttonVariants({variant: 'outline'})} disabled={props.disabled || !context || context.busy} onClick={() => context?.setOpen(false)}>{children}</button>;
}

interface DialogContentProps extends React.DialogHTMLAttributes<HTMLDialogElement> {
  run?: unknown;
  onSubmitMutation?: () => Promise<unknown>;
  /**
   * Why this dialog cannot save. A NODE, not only a string: the one refusal a
   * reader can act on is drawn as the sign-in door itself rather than as a
   * sentence about it (lib/story/sign-in-required).
   */
  unavailable?: React.ReactNode;
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
    className={cn(DIALOG_CONTENT_CLASS, props.className)}
    style={artifactScoped ? {...props.style, position:'fixed', inset:0, margin:'auto', zIndex:2147482001} : props.style}
    onKeyDown={event => {
      props.onKeyDown?.(event);
      if (!artifactScoped || event.defaultPrevented) return;
      if (event.key === 'Escape') {event.preventDefault(); if (!submitting.current) context?.setOpen(false);}
      if (event.key === 'Tab') {
        const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.closest('[hidden], [inert], fieldset[disabled]'));
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

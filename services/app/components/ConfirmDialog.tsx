import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTrustedPortalContainer } from './TrustedUi';

/** Callers own consequences and mutations; the dialog owns safe interaction. */
interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  action: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, description, action, confirmLabel, cancelLabel, danger, busy, children, onConfirm, onCancel }: ConfirmDialogProps) {
  const container = useTrustedPortalContainer();
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const detail = useId();
  const latest = useRef({ busy, onCancel });
  latest.current = { busy, onCancel };
  useEffect(() => {
    const root = panel.current?.getRootNode() as Document | ShadowRoot;
    const previous = root?.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!latest.current.busy) latest.current.onCancel();
      }
      if (event.key !== 'Tab') return;
      const stops = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]') ?? [])];
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      const active = root.activeElement;
      if (!panel.current?.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={heading} aria-describedby={detail} aria-busy={busy}
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-edge-bright bg-surface p-6 text-fg shadow-2xl">
        <h2 id={heading} className="text-base font-semibold">{title}</h2>
        <div id={detail} className="mt-3 break-words text-sm leading-relaxed text-muted">{description}</div>
        {children}
        <div className="mt-6 flex justify-end gap-3">
          <button ref={cancel} type="button" aria-label={cancelLabel} disabled={busy} onClick={onCancel}
            className="cursor-pointer rounded-md border border-edge px-4 py-2 text-sm text-muted hover:bg-raised disabled:opacity-50">Cancel</button>
          <button type="button" aria-label={confirmLabel} disabled={busy} onClick={onConfirm}
            className={`cursor-pointer rounded-md border px-4 py-2 text-sm font-medium disabled:cursor-wait disabled:opacity-50 ${danger ? 'border-danger/40 bg-danger-soft text-danger hover:border-danger' : 'border-accent/40 bg-accent-soft text-accent hover:border-accent'}`}>
            {action}{busy && <span aria-hidden="true">…</span>}
          </button>
        </div>
      </div>
    </div>, container ?? document.body,
  );
}

type Confirmation = Pick<ConfirmDialogProps, 'title' | 'description' | 'action' | 'danger' | 'confirmLabel' | 'cancelLabel'>;
type Pending = { options: Confirmation; perform: () => Promise<void>; resolve: (ok: boolean) => void };

/** One request at a time; cancellation/unmount resolve false. Errors allow retry. */
export function useConfirmation() {
  const pending = useRef<Pending | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  const [request, setRequest] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; pending.current?.resolve(false); pending.current = null; };
  }, []);
  const confirmAction = useCallback((options: Confirmation, perform: () => Promise<void>): Promise<boolean> => {
    if (!alive.current || pending.current) return Promise.resolve(false);
    return new Promise(resolve => {
      const next = { options, perform, resolve };
      pending.current = next;
      setError(null);
      setRequest(next);
    });
  }, []);
  const close = () => {
    pending.current?.resolve(false);
    pending.current = null;
    setRequest(null);
  };
  const execute = async () => {
    const current = pending.current;
    if (!current || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await current.perform();
      if (pending.current !== current) return;
      current.resolve(true);
      pending.current = null;
      setRequest(null);
    } catch (cause) {
      if (pending.current === current) setError(cause instanceof Error ? cause.message : 'Could not complete this action. Try again.');
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { confirmAction, confirmation: request && <ConfirmDialog {...request.options} busy={busy} onCancel={close} onConfirm={() => void execute()}>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </ConfirmDialog> };
}

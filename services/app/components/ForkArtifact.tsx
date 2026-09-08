'use client';

/**
 * "make this mine" — the ONE owner of the fork request and its three answers.
 *
 * There are two surfaces onto the same act (the artifact-controls row, and the
 * confirm dialog a `?intent=fork` address opens on mount), so the POST and its
 * outcomes live here once: a second hand-written copy of a fetch with three
 * branches is how two doors drift apart.
 *
 *  - 201 → the copy exists; go to it. A whole-page navigation, not a router
 *    push: the answer is an ABSOLUTE url under the new owner's handle, and the
 *    page being left holds a live document frame that nothing should try to
 *    carry across.
 *  - 400 → the door refused BY NAME (an unownable <Mutation> target, a private
 *    ref). The refusal is the useful part — it names what the forker would have
 *    to change — so it is shown rather than swallowed into "try again".
 *  - 409 `sign_in_required` → a fork needs an owner and this browser has no
 *    account; go to /login and come back to THIS address still asking to fork
 *    (lib/intent), so the person does the work once.
 */
import { GitFork } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { withIntent } from '@/lib/intent';

/** What the last attempt produced: the refusal lines, or nothing. */
export interface ForkState {
  /** In flight — the surfaces disable themselves rather than firing twice. */
  busy: boolean;
  /** The door's own words, when it refused. Null while nothing is wrong. */
  refusal: string[] | null;
  fork: () => void;
  dismiss: () => void;
}

/** The row and the dialog share this — see the note above the module. */
const CONTROL_ROW = 'flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs text-muted transition-colors hover:bg-raised hover:text-fg disabled:cursor-default disabled:opacity-60';

/**
 * Where /login sends them back to: the address they are looking at, still
 * asking. Read from `window.location` and not from a prop, because the whole
 * point is the address bar the person would otherwise have to find again —
 * including the `$` values of whatever they had narrowed the document to.
 */
const loginBack = (): string =>
  `/login?callbackUrl=${encodeURIComponent(window.location.pathname + withIntent(window.location.search, 'fork') + window.location.hash)}`;

/**
 * The request, its outcomes and the two navigations, as a hook so both
 * surfaces share one implementation.
 */
export function useForkArtifact(id: string): ForkState {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string[] | null>(null);
  /** A navigation is in flight after a 201; nothing may set state into it. */
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  /**
   * The re-entrancy guard is a REF, not the `busy` state, and that is the
   * whole of it: `setBusy(true)` takes effect at the next render, so two
   * clicks inside one tick both read `busy === false` and `disabled` has not
   * applied to the button yet — and this door creates a real artifact per
   * call. `busy` stays, but only to say so on the surface.
   */
  const inFlight = useRef(false);

  const fork = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRefusal(null);
    /** This attempt ends in a navigation, so the guard never reopens. */
    let leaving = false;
    void (async () => {
      try {
        const res = await fetch(`/api/my/artifacts/${id}/fork`, { method: 'POST', credentials: 'same-origin' });
        const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; details?: string[] };
        if (res.status === 201 && body.url) {
          leaving = true;
          window.location.href = body.url;
          return;
        }
        if (res.status === 409 && body.error === 'sign_in_required') {
          leaving = true;
          window.location.href = loginBack();
          return;
        }
        if (!alive.current) return;
        setRefusal(body.details?.length ? body.details : [body.error ?? `could not fork (${res.status})`]);
      } catch {
        if (alive.current) setRefusal(['could not fork — try again']);
      } finally {
        // A 201 or `sign_in_required` LEAVES: the guard stays closed and the
        // label stays busy through the navigation, because a button that
        // re-enables itself while the browser is already on its way to the
        // copy is a second copy.
        if (!leaving) {
          inFlight.current = false;
          if (alive.current) setBusy(false);
        }
      }
    })();
  }, [id]);

  return { busy, refusal, fork, dismiss: useCallback(() => setRefusal(null), []) };
}

/** The refusal, said where the act was asked for. */
function Refusal({ lines, onDismiss }: { lines: string[]; onDismiss: () => void }) {
  return (
    <div aria-label="Fork refused" role="status" className="mt-1 rounded-[5px] border border-edge bg-raised px-2 py-2 font-mono text-[11px] text-muted">
      {lines.map((line) => <p key={line} className="whitespace-pre-wrap">{line}</p>)}
      <button
        type="button"
        aria-label="Dismiss fork refusal"
        onClick={onDismiss}
        className="mt-1 cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] text-accent"
      >
        dismiss
      </button>
    </div>
  );
}

/**
 * The artifact-controls row. Offered to EVERYONE the shell is served to — a
 * fork needs only the right to READ, and the door agrees (it decides on the
 * read ACL there, not on ownership).
 *
 * Unlike every other row here it does NOT close the sheet on click, and that
 * is deliberate: two of the three outcomes navigate away (the copy, or the
 * login door), so closing buys nothing, and the third — a refusal naming what
 * the forker would have to change — has to be READ. Closing first would put
 * the answer behind a panel that shut a moment earlier.
 */
export default function ForkArtifact({ id }: {
  id: string;
  /** `menu` renders as a full-width document-control row (CopyAgentPrompt's precedent). */
  variant?: 'menu';
}) {
  const { busy, refusal, fork, dismiss } = useForkArtifact(id);
  return (
    <>
      <button
        type="button"
        aria-label="Fork artifact"
        aria-live="polite"
        disabled={busy}
        onClick={fork}
        className={CONTROL_ROW}
      >
        <GitFork size={14} strokeWidth={1.75} />
        <span className="flex-1">{busy ? 'forking…' : 'fork'}</span>
      </button>
      {refusal && <Refusal lines={refusal} onDismiss={dismiss} />}
    </>
  );
}

/**
 * The confirm dialog a `?intent=fork` address opens.
 *
 * It asks because the instruction arrived in a URL: a fork writes a copy into
 * somebody's account, and an address anyone may hand over must not be able to
 * do that silently. Focus goes to the confirm and stays inside the dialog,
 * Escape is cancel — the house dialog contract (components/ShareLink).
 */
export function ForkConfirm({ id, title, onClose }: { id: string; title: string | null; onClose: () => void }) {
  const { busy, refusal, fork, dismiss } = useForkArtifact(id);
  const panel = useRef<HTMLDivElement | null>(null);
  const confirm = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { confirm.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      // The trap: a dialog asking to write into your account should not be
      // possible to tab behind and forget about.
      const stops = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (stops.length === 0) return;
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-8">
      <button
        type="button"
        aria-label="Cancel fork by clicking outside"
        onClick={onClose}
        className="absolute inset-0 cursor-default border-0 bg-black/45 p-0 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Fork this artifact"
        className="relative z-10 w-full max-w-md rounded-[9px] border border-edge-bright bg-surface p-5 font-mono text-xs shadow-2xl"
      >
        <h2 className="text-sm font-semibold text-fg">Fork this artifact?</h2>
        <p className="mt-2 text-[11px] text-muted">
          {`A copy of “${title ?? 'this artifact'}” is added to your artifacts. Comments, history and sharing stay with the original.`}
        </p>
        {refusal && <Refusal lines={refusal} onDismiss={dismiss} />}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            aria-label="Cancel fork"
            onClick={onClose}
            className="cursor-pointer rounded-[5px] border border-edge bg-transparent px-3 py-1.5 text-muted hover:border-edge-bright hover:text-fg"
          >
            cancel
          </button>
          <button
            ref={confirm}
            type="button"
            aria-label="Confirm fork"
            disabled={busy}
            onClick={fork}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[5px] border border-edge-bright bg-raised px-3 py-1.5 text-accent hover:border-accent disabled:cursor-default disabled:opacity-60"
          >
            <GitFork size={13} strokeWidth={1.75} />
            {busy ? 'forking…' : 'fork'}
          </button>
        </div>
      </div>
    </div>
  );
}

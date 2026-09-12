'use client';

/**
 * "make this mine" — the ONE owner of the fork request and its three answers.
 *
 * There are two surfaces onto the same act (the artifact-controls row, and the
 * confirm dialog a `?intent=fork` address opens on mount), so the POST and its
 * outcomes live here once: a second hand-written copy of a fetch with three
 * branches is how two doors drift apart.
 *
 *  - 201 → the copy exists; navigate through the app router, which owns the
 *    old artifact's guarded teardown and the new document lifetime.
 *  - 400 → the door refused BY NAME (an unownable <Mutation> target, a private
 *    ref). The refusal is the useful part — it names what the forker would have
 *    to change — so it is shown rather than swallowed into "try again".
 *  - 409 `sign_in_required` → a fork needs an owner and this browser has no
 *    account; go to /login and come back to THIS address still asking to fork
 *    (lib/intent), so the person does the work once.
 */
import ConfirmDialog from './ConfirmDialog';
import { Tooltip } from './Tooltip';
import { GitFork } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { withIntent } from '@/lib/intent';
import { useRouter } from '@/lib/navigation';

/** What the last attempt produced: the refusal lines, or nothing. */
interface ForkState {
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
function useForkArtifact(id: string): ForkState {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string[] | null>(null);
  /** A navigation is in flight after a 201; nothing may set state into it. */
  const alive = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current += 1; };
  }, [id]);
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
    const started = generation.current;
    const current = () => alive.current && started === generation.current;
    /** This attempt ends in a navigation, so the guard never reopens. */
    let leaving = false;
    void (async () => {
      try {
        const res = await fetch(`/api/my/artifacts/${id}/fork`, { method: 'POST', credentials: 'same-origin' });
        const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; details?: string[] };
        if (!current()) return;
        if (res.status === 201 && body.url) {
          leaving = true;
          router.push(body.url);
          return;
        }
        if (res.status === 401 || (res.status === 409 && body.error === 'sign_in_required')) {
          leaving = true;
          router.push(loginBack());
          return;
        }
        setRefusal(body.details?.length ? body.details : [body.error ?? `could not fork (${res.status})`]);
      } catch {
        if (current()) setRefusal(['could not fork — try again']);
      } finally {
        // A 201 or `sign_in_required` LEAVES: the guard stays closed and the
        // label stays busy through the navigation, because a button that
        // re-enables itself while the browser is already on its way to the
        // copy is a second copy.
        if (!leaving && current()) {
          inFlight.current = false;
          setBusy(false);
        }
      }
    })();
  }, [id, router]);

  return { busy, refusal, fork, dismiss: useCallback(() => setRefusal(null), []) };
}

/** The refusal, said where the act was asked for. */
function ForkRefusal({ lines, onDismiss }: { lines: string[]; onDismiss: () => void }) {
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

/** Fork is offered to every reader; the server decides the read ACL.
 * The bar variant keeps refusals visible beside the initiating control. */
export default function ForkArtifact({ id, title = null, variant = 'menu' }: {
  id: string;
  title?: string | null;
  /** Settings row or compact app-bar button. */
  variant?: 'menu' | 'bar';
}) {
  const [asked, setAsked] = useState(false);
  return (
    <div className="relative">
      <Tooltip content="Fork artifact"><button
        type="button" aria-label="Fork artifact" onClick={() => setAsked(true)}
        className={variant === 'bar' ? 'flex h-9 w-9 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent text-muted hover:bg-raised hover:text-fg' : CONTROL_ROW}
      >
        <GitFork size={14} strokeWidth={1.75} />
        <span className={variant === 'bar' ? 'sr-only' : 'flex-1'}>fork</span>
      </button></Tooltip>
      {asked && <ForkConfirm id={id} title={title} onClose={() => setAsked(false)} />}
    </div>
  );
}

/**
 * The confirm dialog a `?intent=fork` address opens.
 *
 * It asks because the instruction arrived in a URL: a fork writes a copy into
 * somebody's account, and an address anyone may hand over must not be able to
 * do that silently. Focus goes to Cancel and stays inside the dialog,
 * Escape is cancel — the house dialog contract (components/ShareLink).
 */
export function ForkConfirm({ id, title, onClose }: { id: string; title: string | null; onClose: () => void }) {
  const { busy, refusal, fork, dismiss } = useForkArtifact(id);
  return <ConfirmDialog title="Fork this artifact?"
    description={`A copy of “${title ?? 'this artifact'}” will be added to your artifacts. You’ll open the new copy after forking. Comments, history and sharing stay with the original.`}
    action="Fork and open copy" confirmLabel="Confirm fork" cancelLabel="Cancel fork"
    busy={busy} onConfirm={fork} onCancel={onClose}>
    {refusal && <ForkRefusal lines={refusal} onDismiss={dismiss} />}
  </ConfirmDialog>;
}

/**
 * THE HEART on a document's toolbar: the count for everyone, the toggle for an
 * account. A click asks `/api/my/artifacts/:id/like` (POST to like, DELETE to
 * unlike) and renders whatever the door answers — the answer IS the state, no
 * optimistic guess to roll back. Anonymous readers get a link to /login.
 *
 * WHY NO OPTIMISM. The door returns `{ liked, count }` for both verbs
 * precisely so a button never has to compute the number itself: guessing
 * `count + 1` is wrong the moment anyone else has liked since the page loaded,
 * and a refusal then has to be un-guessed. A refused call leaves the control
 * exactly as it was.
 */
import { Heart } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

/** The document-control row, as every other entry in that sheet spells it (ForkArtifact's precedent). */
const CONTROL_ROW = 'flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs text-muted no-underline transition-colors hover:bg-raised hover:text-fg disabled:cursor-default disabled:opacity-60';

export function LikeButton({ artifactId, liked, count, signedIn }: {
  artifactId: string;
  liked: boolean;
  count: number;
  signedIn: boolean;
}) {
  const [state, setState] = useState({ liked, count });
  const [busy, setBusy] = useState(false);
  /**
   * The re-entrancy guard is a REF, not `busy`: `setBusy(true)` takes effect at
   * the next render, so two clicks inside one tick both read `false` and the
   * second one flips the state straight back (ForkArtifact learned this the
   * same way).
   */
  const inFlight = useRef(false);

  const toggle = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch(`/api/my/artifacts/${artifactId}/like`, {
          method: state.liked ? 'DELETE' : 'POST',
          credentials: 'same-origin',
        });
        // A refusal (the session went, the document stopped being readable) is
        // silent on purpose: a heart is not where someone learns that.
        if (res.ok) setState((await res.json()) as { liked: boolean; count: number });
      } catch {
        // Offline is not a state change either.
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    })();
  }, [artifactId, state.liked]);

  const label = state.liked ? 'Unlike' : 'Like';
  /*
   * The count travels on BOTH faces — it is the number a reader came for — and
   * the anonymous face is a LINK rather than a disabled button, so the act
   * survives the login round-trip instead of dead-ending.
   */
  const body = (
    <>
      <Heart size={14} strokeWidth={1.75} {...(state.liked ? { fill: 'currentColor' } : {})} />
      <span className="flex-1">{label.toLowerCase()}</span>
      <span>{state.count}</span>
    </>
  );
  if (!signedIn) return <a href="/login" aria-label={label} className={CONTROL_ROW}>{body}</a>;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={state.liked}
      disabled={busy}
      onClick={toggle}
      className={`${CONTROL_ROW} ${state.liked ? 'text-accent' : ''}`}
    >
      {body}
    </button>
  );
}

export default LikeButton;

/**
 * FOLLOW on a public profile: the count for everyone, the toggle for an
 * account, `/api/users/:id/follow` (POST / DELETE), the answer is the state.
 * Anonymous readers get a link to /login. Never rendered on the owner's own
 * listing.
 *
 * The answer is the state, and a refusal leaves the current state intact.
 */
import {appFetch as fetch} from '@/web/api-origin';
import { useCallback, useRef, useState } from 'react';

const PILL = 'inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-edge bg-surface px-3 py-1 font-mono text-xs text-muted no-underline transition-colors hover:border-accent hover:text-fg disabled:cursor-default disabled:opacity-60';

export function FollowButton({ userId, following, count, signedIn }: {
  userId: string;
  following: boolean;
  count: number;
  signedIn: boolean;
}) {
  const [state, setState] = useState({ following, count });
  const [busy, setBusy] = useState(false);
  /** A ref, not `busy`: two clicks in one tick both read the pre-render value. */
  const inFlight = useRef(false);

  const toggle = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch(`/api/users/${userId}/follow`, {
          method: state.following ? 'DELETE' : 'POST',
          credentials: 'same-origin',
        });
        if (res.ok) setState((await res.json()) as { following: boolean; count: number });
      } catch {
        // A network that is not there has not changed who follows whom.
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    })();
  }, [userId, state.following]);

  const label = state.following ? 'Unfollow' : 'Follow';
  const body = (
    <>
      <span>{label.toLowerCase()}</span>
      <span className="text-faint">{state.count}</span>
    </>
  );
  if (!signedIn) return <a href="/login" aria-label={label} className={PILL}>{body}</a>;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={state.following}
      disabled={busy}
      onClick={toggle}
      className={`${PILL} ${state.following ? 'border-accent text-accent' : ''}`}
    >
      {body}
    </button>
  );
}

export default FollowButton;

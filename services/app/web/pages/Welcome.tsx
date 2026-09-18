/**
 * THE WELCOME PAGE — seen once, by a brand-new account, from wherever the app
 * shell intercepted them (web/OnboardingGate).
 *
 * Deliberately three things: the picture, the handle, Confirm. Everything else
 * a person might want to set has a home on the account page and can wait; what
 * cannot wait is that they arrive somewhere with an auto-assigned handle and a
 * blank circle and never learn either is theirs to change.
 *
 * Confirm saves BOTH in one PATCH — the handle and `welcome_pending: false` —
 * so a refused handle leaves them here with the reason and the page intact,
 * rather than half-confirmed with a name they did not pick. The picture is
 * already saved by then: it goes to its own door the moment it is chosen, so
 * Confirm never has bytes to wait on.
 */
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import AvatarCircle from '@/components/AvatarCircle';
import { HANDLE_REFUSALS } from '@/components/UsernameCard';
import { Button, Input, MicroLabel } from '@/components/ui';
import { useRouter, useSearchParams } from '@/lib/navigation';
import { internalRedirectTarget } from '@/lib/safe-redirect';
import { pageDataChanged } from '@/web/page-data-events';
import { useSession } from '../session';

interface Profile { username: string | null; image: string | null }

export function WelcomePage() {
  const { session, reload } = useSession();
  const search = useSearchParams();
  const router = useRouter();
  const callbackUrl = search.get('callbackUrl');

  const [username, setUsername] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Once Confirm has been answered, this page is leaving. The "already
  // onboarded" guard below must not fire in the gap and steal the callback.
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch('/api/my/profile', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((profile: Profile | null) => {
        if (!alive || !profile) return;
        setUsername(profile.username ?? '');
        setImage(profile.image);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!leaving && session && !session.user) {
    // Back HERE afterwards, callback and all: the destination the shell was
    // holding for this person must survive the detour through the login page.
    const here = `/welcome${search.toString() ? `?${search.toString()}` : ''}`;
    return <Navigate to={`/login?callbackUrl=${encodeURIComponent(here)}`} replace />;
  }
  if (!leaving && session?.user && session.onboarded) return <Navigate to="/account" replace />;

  const confirm = async () => {
    setBusy(true);
    setStatus(null);
    const res = await fetch('/api/my/profile', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, welcome_pending: false }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setStatus('could not reach the server');
    const body = (await res.json().catch(() => ({}))) as { username?: string; error?: string };
    if (!res.ok) return setStatus(HANDLE_REFUSALS[body.error ?? ''] ?? 'could not save that handle');

    setLeaving(true);
    pageDataChanged();
    // The session's `onboarded` bit is stale the moment this succeeds, and it
    // is what the gate reads — re-read it before anything navigates.
    reload();
    router.replace(internalRedirectTarget(callbackUrl, window.location.origin));
  };

  return (
    <main className="mx-auto mt-16 max-w-xl px-6">
      <div className="mx-auto max-w-sm">
        {/* The heading, then the three controls — nothing else. The circle and
          * the handle field say what they are, and a screen somebody sees
          * exactly once should be done with before it is read. */}
        <h1 className="text-base font-semibold"><span className="text-accent">&gt;</span> welcome</h1>

        <div className="mt-6">
          <AvatarCircle
            image={image}
            initial={username || 'a'}
            userId={session?.user?.id ?? ''}
            onChange={setImage}
          />
        </div>

        <form
          className="mt-6"
          onSubmit={(e) => { e.preventDefault(); void confirm(); }}
        >
          <MicroLabel>handle</MicroLabel>
          <div className="mt-2 flex items-center gap-2">
            <span className="w-4 text-center font-mono text-sm text-muted">@</span>
            <span className="min-w-0 flex-1">
              <Input
                aria-label="Username"
                autoComplete="off"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </span>
          </div>
          {status && <p role="status" className="mt-2 ml-6 font-mono text-xs text-danger">{status}</p>}
          <div className="mt-6">
            <Button type="submit" disabled={busy || !username.trim()}>Confirm</Button>
          </div>
        </form>
      </div>
    </main>
  );
}

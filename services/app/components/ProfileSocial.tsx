/**
 * THE PROFILE'S SOCIAL HEADER, copied from X: `2 Following · 4 Followers` for
 * everyone; for a signed-in stranger, a "Follows you" badge, a button that says
 * Follow, Follow back or Following (Unfollow on hover), and "Followed by …"
 * naming the people they follow who follow this profile. Anonymous readers get
 * a Follow link to /login. The owner gets the counts alone.
 *
 * The button's answer from `/api/users/:id/follow` is the state — of the button
 * AND the follower count beside it — and a refusal leaves both intact. Never
 * drawn on a custom domain, which has no session and no `/api`.
 */
import { useCallback, useRef, useState } from 'react';
import Avatar from '@/components/Avatar';
import { loginHref, useLoginHref } from '@/lib/login-href';
import type { ProfileRelation, ProfileSocial } from '@/lib/profile-social';
import { refusedForSignIn } from '@/lib/story/sign-in-required';
import { pageDataChanged } from '@/web/page-data-events';

const BUTTON = 'group inline-flex min-w-24 cursor-pointer items-center justify-center rounded-full border px-4 py-1.5 text-sm font-semibold no-underline transition-colors disabled:cursor-default disabled:opacity-60';
/** Not following yet: the filled call to action. */
const SOLID = `${BUTTON} border-fg bg-fg text-bg hover:opacity-85`;
/** Following: outlined, and red on hover where it reads Unfollow. */
const OUTLINE = `${BUTTON} border-edge bg-transparent text-fg hover:border-danger hover:bg-danger-soft hover:text-danger`;

export function ProfileSocialHeader({ userId, social, signedIn }: {
  userId: string;
  social: ProfileSocial;
  signedIn: boolean;
}) {
  const [state, setState] = useState({ youFollow: social.relation?.youFollow ?? false, followers: social.followers });
  const relation = social.relation;
  // The owner is the one signed-in reader with no relation to describe.
  const followable = !!relation || !signedIn;
  return (
    <div role="group" aria-label="Follows" className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
          <Stat value={social.following} label="Following" />
          <Stat value={state.followers} label={state.followers === 1 ? 'Follower' : 'Followers'} />
          {relation?.followsYou && (
            <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">Follows you</span>
          )}
        </p>
        {followable && (
          <FollowButton
            userId={userId}
            following={state.youFollow}
            followsYou={relation?.followsYou ?? false}
            signedIn={signedIn}
            onAnswer={(answer) => setState({ youFollow: answer.following, followers: answer.count })}
          />
        )}
      </div>
      {relation && relation.knownTotal > 0 && <KnownFollowers relation={relation} />}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span data-stat="">
      <span className="font-semibold text-fg">{value.toLocaleString('en-US')}</span> {label}
    </span>
  );
}

/** "Followed by ann, bob and 2 others you follow", behind their stacked faces. */
function KnownFollowers({ relation }: { relation: ProfileRelation }) {
  const { known, knownTotal } = relation;
  const rest = knownTotal - known.length;
  const names = known.map((person) => (
    <a key={person.id} href={`/@${person.username}`} className="font-medium text-fg no-underline hover:underline">{person.username}</a>
  ));
  const parts: React.ReactNode[] = [];
  names.forEach((name, i) => {
    if (i > 0) parts.push(rest === 0 && i === names.length - 1 ? ' and ' : ', ');
    parts.push(name);
  });
  if (rest > 0) parts.push(` and ${rest} other${rest === 1 ? '' : 's'} you follow`);
  return (
    <div className="flex items-center gap-2">
      <span className="flex">
        {known.map((person, i) => (
          <span key={person.id} className={`rounded-full ring-2 ring-bg ${i > 0 ? '-ml-1.5' : ''}`}>
            <Avatar userId={person.id} image={person.image} initial={person.username} size={20} />
          </span>
        ))}
      </span>
      <p className="text-xs text-muted">Followed by {parts}</p>
    </div>
  );
}

function FollowButton({ userId, following, followsYou, signedIn, onAnswer }: {
  userId: string;
  following: boolean;
  followsYou: boolean;
  signedIn: boolean;
  onAnswer: (answer: { following: boolean; count: number }) => void;
}) {
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
          method: following ? 'DELETE' : 'POST',
          credentials: 'same-origin',
        });
        // A GUEST holds a credential and is still not somebody who can follow
        // anyone: the door says so by name, and the answer is the login page
        // and back to this profile — the same place the signed-out link points
        // (lib/story/sign-in-required).
        if (await refusedForSignIn(res)) { window.location.assign(loginHref(window.location)); return; }
        if (res.ok) { pageDataChanged(); onAnswer((await res.json()) as { following: boolean; count: number }); }
      } catch {
        // A network that is not there has not changed who follows whom.
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    })();
  }, [userId, following, onAnswer]);

  const login = useLoginHref();
  const label = followsYou ? 'Follow back' : 'Follow';
  if (!signedIn) return <a {...login} aria-label="Follow" className={SOLID}>Follow</a>;
  if (following) {
    return (
      // The name is the state, as a pressed toggle; hovering says what a press does.
      <button type="button" aria-label="Following" aria-pressed disabled={busy} onClick={toggle} className={OUTLINE}>
        <span className="group-hover:hidden">Following</span>
        <span className="hidden group-hover:inline">Unfollow</span>
      </button>
    );
  }
  return (
    <button type="button" aria-label={label} aria-pressed={false} disabled={busy} onClick={toggle} className={SOLID}>
      {label}
    </button>
  );
}

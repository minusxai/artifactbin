import { useCallback, useEffect, useState } from 'react';
import { useRefreshable } from '@/lib/navigation';
import { ActivityFeed } from '@/components/ActivityFeed';
import ClaimBanner from '@/components/ClaimBanner';
import Dashboard from '@/components/Dashboard';
import GetStarted from '@/components/GetStarted';
import Landing from '@/components/Landing';
import LoginForm from '@/components/LoginForm';
import SharedWithYou from '@/components/SharedWithYou';
import Shelf from '@/components/Shelf';
import UseCarousel from '@/components/UseCarousel';
import type { FeedItem } from '@/lib/feed-wire';
import { PAGE_COLUMN } from '@/components/ui';
import { useSession } from '@/web/session';

type Home =
  | { signedIn: false; drafts?: Parameters<typeof Shelf>[0]['rows'] }
  | { signedIn: true; artifacts: Array<Record<string, unknown> & { id: string }>; shared: Parameters<typeof SharedWithYou>[0]['items']; feed?: { mine: FeedItem[]; following: FeedItem[] } };

/**
 * THE EMPTY LIBRARY IS THE ONLY PAGE THAT SAYS WHAT TO DO FIRST.
 *
 * Signed in with nothing published, the dashboard used to be one closed strip
 * on an empty column — the page was literally blank under it. It leads with
 * the act instead, keeps the same panel every other surface shows, and then
 * borrows other people's documents as the proof of what to ask for, since
 * there is nothing of the reader's own to look at yet.
 */
function FirstArtifact() {
  // The greeting rides the session the chrome already read — a name is worth
  // no second request, and a page that has not learned it yet simply greets
  // nobody rather than flashing a placeholder in.
  const { session } = useSession();
  const name = session?.user?.email?.split('@')[0] ?? '';
  const greeting = `${name ? `hi ${name}, l` : 'l'}et\u2019s create your first artifact!`;
  return (
    <>
      <div className="mb-8 sm:mb-10">
        {/* SERIF STATES, MONO LABELS, SANS EXPLAINS — the landing's rule, and
          * this is the page making a claim in its own words. The accessible
          * name is the line itself: an aria-label that says something else
          * would REPLACE what a screen reader hears. */}
        <h1
          aria-label={greeting}
          className="font-serif text-[clamp(1.6rem,3.4vw,2.25rem)] leading-[1.15] font-medium tracking-[-0.01em] text-fg"
        >
          {greeting}
        </h1>
        <p className="mt-1.5 font-sans text-sm text-muted">
          Hand an agent the instruction below along with what artifact you want, and follow along.
        </p>
      </div>
    </>
  );
}

export function HomePage() {
  const [home, setHome] = useState<Home | null>(null);
  const load = useCallback(() => { void fetch('/api/page/home', { credentials: 'same-origin' }).then((r) => r.json()).then(setHome).catch(() => null); }, []);
  useEffect(load, [load]);
  // A claim adds artifacts to this library; re-read rather than reload.
  useRefreshable(load);
  if (!home) return <main className={`${PAGE_COLUMN} mt-8 pb-24`} aria-busy="true" />;
  if (!home.signedIn) {
    if (home.drafts?.length) {
      return (
        <main className={`${PAGE_COLUMN} mt-8 pb-24`}>
          <div className="mb-6 flex flex-wrap items-baseline justify-start gap-x-4 gap-y-1">
            <h1 className="font-mono text-sm tracking-[0.14em] text-fg uppercase">Drafts held by this browser · </h1>
            <a className="font-sans text-sm text-accent underline underline-offset-2" href="/login">Log in to keep them</a>
          </div>
          <Shelf actions="full" rows={home.drafts} />
          <div className="mt-8"><GetStarted /></div>
          {/* Keeping the drafts is the second act, so it follows the panel
            * rather than competing with it. */}
          <div className="reveal mt-3 rounded-[6px] border border-edge bg-surface px-4 pt-4 pb-4">
            <h2 className="mb-2.5 font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Log in</h2>
            <LoginForm />
          </div>
        </main>
      );
    }
    // A stranger has nothing to log into yet: the landing proves the product
    // and hands over the instruction; the masthead keeps the login door.
    return <Landing />;
  }
  const empty = home.artifacts.length === 0 && home.shared.length === 0;
  return (
    <main className={`${PAGE_COLUMN} mt-8 pb-24`}>
      {empty ? (
        <>
          <FirstArtifact />
          <div className="mb-6"><GetStarted /></div>
        </>
      ) : (
        <Dashboard rows={home.artifacts as never} />
      )}
      {/* Kept outside the empty/full branch so a successful claim can report
        * its result while the page refreshes into the dashboard. */}
      <ClaimBanner />
      {empty ? (
        /* Inspiration, not decoration: an empty library has no examples of its
         * own, so these are the real published documents from the landing —
         * under this page's own name, and without the landing's wheel of use
         * phrases, which sells a product this reader has already signed into. */
        <div className="mt-10 sm:mt-12">
          <UseCarousel label="Inspiration Zone" wheel={false} />
        </div>
      ) : (
        <>
          {home.artifacts.length > 0 && <Shelf actions="full" rows={home.artifacts as never} />}
          <SharedWithYou items={home.shared} />
        </>
      )}
      {/* AFTER the shelves, and OUTSIDE the empty/full branch: an account that
        * owns nothing yet may already follow people, and hiding the one thing
        * on its dashboard that has anything in it would be the wrong half of
        * the flip. The section renders nothing at all when both lists are
        * empty, so the bare library still reads as bare. `feed` is optional on
        * the wire because a page served from an older bootstrap has none. */}
      <ActivityFeed mine={home.feed?.mine ?? []} following={home.feed?.following ?? []} />
      {/* THE ONE WAY BACK. Deleting is a trash now (lib/trash): a row is
        * recoverable for good, which is worth nothing if nothing on the
        * product leads to it. One quiet link at the foot of the account's own
        * page — an anonymous browser has no trash to reach. It sits BELOW the
        * activity section rather than between it and the shelves, where a bare
        * link reads as that section's own heading; and OUTSIDE the empty/full
        * flip on purpose, since an emptied library is exactly when someone is
        * looking for what they just deleted. */}
      <p className="mt-8">
        <a
          href="/trash"
          aria-label="Trash"
          className="font-mono text-[10px] text-faint no-underline transition-colors hover:text-accent"
        >
          trash
        </a>
      </p>
    </main>
  );
}

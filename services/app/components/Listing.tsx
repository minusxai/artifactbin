/**
 * The public profile listing — the pretty-URL page's chrome, rendered
 * in the browser from /api/page/profile. Moved out of the Next page as-is.
 */
import { FollowButton } from '@/components/FollowButton';
import HeaderBar, { type HeaderStats } from '@/components/HeaderBar';
import PageChrome from '@/components/PageChrome';
import { PAGE_COLUMN, MicroLabel } from '@/components/ui';

/**
 * App masthead + the shared column every listing view lives in. The controls
 * sit in the masthead's open top corners; no persistent strip is reserved.
 */
export function ListingShell({ email, username, stats, authed = false, anon = false, children }: {
  email: string | null;
  /**
   * The VIEWER's own handle, not the profile's — this is the app masthead, and
   * it says who is signed in wherever it appears. A stranger reading somebody
   * else's profile still gets their own identity line, or the login door.
   */
  username?: string | null;
  stats: HeaderStats | null; authed?: boolean; anon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageChrome authed={authed} anon={anon} />
      <HeaderBar email={email} username={username} stats={stats} />
      {/* The SHARED column: a profile and the dashboard render the same
        * shelf, so they must be the same width, and the masthead above them
        * spans it too (web/__tests__/shelf-pages). */}
      <main className={`${PAGE_COLUMN} pt-10 pb-24`}>{children}</main>
    </>
  );
}

/**
 * The profile masthead: micro-label, the handle, and a one-line readout of what
 * sits below.
 *
 * It carried a FOLDER PATH once — a crumb per segment, each its own link —
 * because a folder used to be a string on a document and a listing address.
 * Nesting is not in a URL any more (lib/urls): a folder is an artifact with its
 * own address, this page is the account ROOT, and the trail from `ancestor_ids`
 * is drawn on the folder's own document. So there is nothing here to segment.
 */
export function ListingHero({ handle, label, count, noun, follow }: {
  handle: string; label: string; count: number; noun: string;
  /**
   * The follow control, on a STRANGER's profile only — the page route ships
   * `owner`/`follow` on that branch alone, so an absent prop is exactly the
   * owner looking at their own listing, with nobody to follow.
   */
  follow?: { userId: string; following: boolean; count: number; signedIn: boolean };
}) {
  return (
    <header className="reveal mb-8">
      <MicroLabel>{label}</MicroLabel>
      <h1 className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-3xl font-semibold tracking-tight text-fg">
        <a href={`/@${handle}`} aria-label="Profile root" className="no-underline transition-colors hover:text-accent">
          <span className="text-accent">@</span>{handle}
        </a>
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="font-mono text-xs text-muted">
          {count} {noun}
          {count === 1 ? '' : 's'}
        </p>
        {follow && <FollowButton {...follow} />}
      </div>
    </header>
  );
}

export function NothingHere() {
  return (
    <p className="reveal font-mono text-sm text-muted">
      <span className="text-accent">$</span> nothing here yet
      <span className="caret text-accent">▍</span>
    </p>
  );
}

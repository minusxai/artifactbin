/**
 * The public profile listing — the pretty-URL page's chrome, rendered
 * in the browser from /api/page/profile.
 */
import { FollowButton } from '@/components/FollowButton';
import PageChrome from '@/components/PageChrome';
import { PAGE_COLUMN, MicroLabel } from '@/components/ui';

/**
 * Compact app bar and the shared column every listing view lives in.
 */
export function ListingShell({ authed = false, anon = false, children }: {
  authed?: boolean; anon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageChrome authed={authed} anon={anon} />
      {/* Profiles keep the standard reading column. The populated homepage
        * widens separately because it also carries the analytics rail. */}
      <main className={`${PAGE_COLUMN} pt-10 pb-24`}>{children}</main>
    </>
  );
}

/**
 * The profile masthead: micro-label, the handle, and a one-line readout of what
 * sits below.
 *
 * No folder path: nesting is not in a URL (lib/urls). A folder is an artifact
 * with its own address, this page is the account ROOT, and the trail from
 * `ancestor_ids` is drawn on the folder's own page. There is nothing here to
 * segment.
 */
export function ListingHero({ handle, label, count, noun, image, follow }: {
  handle: string; label: string; count: number; noun: string;
  /**
   * The owner's picture (lib/avatars), or null for none. DECORATIVE here: the
   * handle is right beside it in text, so naming the image as well would make
   * a screen reader say this person's name twice.
   */
  image?: string | null;
  /**
   * The follow control, on a STRANGER's profile only — the page route ships
   * `follow` on that branch alone, so an absent prop is exactly the
   * owner looking at their own listing, with nobody to follow.
   */
  follow?: { userId: string; following: boolean; count: number; signedIn: boolean };
}) {
  return (
    <header className="reveal mb-8">
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-2 flex items-center gap-3">
        {image && (
          <img src={image} alt="" className="size-12 shrink-0 rounded-full border border-edge object-cover" />
        )}
        <h1 className="flex flex-wrap items-baseline gap-x-1.5 text-3xl font-semibold tracking-tight text-fg">
          <a href={`/@${handle}`} aria-label="Profile root" className="no-underline transition-colors hover:text-accent">
            <span className="text-accent">@</span>{handle}
          </a>
        </h1>
      </div>
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

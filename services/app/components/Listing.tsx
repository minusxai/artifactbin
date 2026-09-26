/**
 * The public profile listing — the pretty-URL page's chrome, rendered
 * in the browser from /api/page/profile.
 */
import Avatar from '@/components/Avatar';
import { ProfileSocialHeader } from '@/components/ProfileSocial';
import type { ProfileSocial } from '@/lib/profile-social';
import PageChrome from '@/components/PageChrome';
import { PAGE_COLUMN, MicroLabel } from '@/components/ui';

/**
 * Where a listing is drawn: the app (`/@handle`, in the SPA) or the owner's
 * custom domain (server-rendered, no script, no session, no `/api`).
 */
export type ListingSurface = 'app' | 'domain';

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
      <ListingColumn>{children}</ListingColumn>
    </>
  );
}

/**
 * The column alone — what the custom-domain home page draws, with no app bar
 * above it.
 */
export function ListingColumn({ children }: { children: React.ReactNode }) {
  // Profiles keep the standard reading column. The populated homepage
  // widens separately because it also carries the analytics rail.
  return <main className={`${PAGE_COLUMN} pt-10 pb-24`}>{children}</main>;
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
export function ListingHero({ handle, label, count, noun, owner, social, surface = 'app' }: {
  handle: string; label: string; count: number; noun: string;
  /**
   * Whose listing: their id (the face's colour) and picture (lib/avatars, or
   * null for none). Known → a face, always — the initial of the handle, with
   * the picture painted over it when there is one. Absent → no face at all.
   * DECORATIVE: the handle is right beside it in text, so naming the face as
   * well would make a screen reader say this person's name twice.
   */
  owner?: { id: string; image: string | null };
  /**
   * The follow counts and, for a signed-in stranger, how they relate to this
   * person (components/ProfileSocial). Absent → no social header at all.
   */
  social?: { userId: string; signedIn: boolean; social: ProfileSocial };
  /** On a custom domain the handle links to the domain's own root, and nobody is followed there. */
  surface?: ListingSurface;
}) {
  const domain = surface === 'domain';
  return (
    <header className="reveal mb-8">
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-2 flex items-center gap-3">
        {owner && <Avatar userId={owner.id} image={owner.image} initial={handle} size={48} />}
        <h1 className="flex flex-wrap items-baseline gap-x-1.5 text-3xl font-semibold tracking-tight text-fg">
          <a href={domain ? '/' : `/@${handle}`} aria-label="Profile root" className="no-underline transition-colors hover:text-accent">
            <span className="text-accent">@</span>{handle}
          </a>
        </h1>
      </div>
      {social && !domain && <ProfileSocialHeader {...social} />}
      <p className="mt-3 font-mono text-xs text-muted">
        {count} {noun}
        {count === 1 ? '' : 's'}
      </p>
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

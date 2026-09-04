/** The pretty URLs: an id-anchored artifact or the owner's public index. */
import { useEffect, useRef, useState } from 'react';
import { takeBootstrap } from '../bootstrap';
import { Navigate, useLocation, useParams } from 'react-router';
import { useSession } from '../session';
import { ListingHero, ListingShell, NothingHere } from '@/components/Listing';
import Shelf from '@/components/Shelf';
import { canonicalArtifactPath } from '@/lib/urls';
import { ArtifactPage } from './Artifact';
import { NotFoundPage } from './NotFound';

type Resolved =
  | { kind: 'redirect'; to: string }
  | { kind: 'artifact'; id: string }
  | { kind: 'public-profile'; handle: string; owner?: { id: string }; follow?: { following: boolean; count: number }; files: never[]; email: string | null; authed: boolean; anon: boolean };

export function ProfilePage() {
  const { user, '*': rest } = useParams();
  const { session } = useSession();
  const viewerHandle = session?.user?.username ?? null;
  const { pathname } = useLocation();
  const [page, setPage] = useState<Resolved | 'missing' | null>(() => takeBootstrap<Resolved>(window.location.pathname, 'profile'));
  const served = useRef<string | null>(page ? window.location.pathname : null);
  // A handle is `@name`; anything else here is a root typo — the 404, with no
  // profile fetch to ask about an address that could never resolve.
  const typo = !user?.startsWith('@');
  useEffect(() => {
    if (typo) return;
    // Served with its data (server/app inlines it): nothing to fetch for THIS address.
    if (served.current === pathname) return;
    served.current = null;
    let alive = true;
    setPage(null);
    void fetch(`/api/page/profile/${encodeURIComponent(user ?? '')}${rest ? '/' + rest : ''}`, { credentials: 'same-origin' })
      .then((r): Promise<Resolved | 'missing'> => (r.ok ? (r.json() as Promise<Resolved>) : Promise.resolve('missing' as const)))
      .then((p) => { if (alive) setPage(p); })
      .catch(() => { if (alive) setPage('missing'); });
    return () => { alive = false; };
  }, [user, rest, pathname, typo]);
  if (typo) return <NotFoundPage />;
  if (page === null) return <div aria-label="Loading page" />;
  if (page === 'missing') return <NotFoundPage />;
  if (page.kind === 'redirect') return <Navigate to={page.to} replace />;
  if (page.kind === 'artifact') return <ArtifactPage id={page.id} />;
  // The masthead names the VIEWER, on a profile as everywhere else — which is
  // the session's handle, never the profile's (components/HeaderBar).
  return (
    <ListingShell email={page.email} username={viewerHandle} stats={null} authed={page.authed} anon={page.anon}>
      <ProfileListing data={page} />
    </ListingShell>
  );
}

/**
 * EVERYTHING INSIDE THE SHELL, as one component. The page renders it and the
 * suite renders it — `__tests__/pretty-urls` used to re-compose these pieces
 * by hand, which is how it came to assert a listing the page had stopped
 * rendering.
 *
 * DOCUMENTS, not artifacts, in the count: the assets band is withheld below,
 * so counting datasets would promise rows that are not there.
 */
export function ProfileListing({ data }: { data: { handle: string; owner?: { id: string }; follow?: { following: boolean; count: number }; authed?: boolean; files: Array<Record<string, unknown> & { id: string; format: string }> } }) {
  // Folders are ROWS in this listing now (`format: 'folder'`), reached at their
  // own address, so there is no derived folder panel and no path crumb to draw.
  return (
    <>
      <ListingHero
        handle={data.handle}
        label="public index"
        count={data.files.filter((a) => a.format === 'markup').length}
        noun="public artifact"
        // Both halves or neither: the route ships `owner` and `follow`
        // together, on the public branch only.
        {...(data.owner && data.follow ? { follow: { userId: data.owner.id, ...data.follow, signedIn: !!data.authed } } : {})}
      />
      {data.files.length === 0 ? <NothingHere /> : <ProfileShelf handle={data.handle} files={data.files} />}
    </>
  );
}

/**
 * The owner's own profile root is the dashboard's shelf asked a different
 * question — same account, same root — so it gets the one control that puts
 * something new on it. Never the row verbs: `actions` stays `share`, because a
 * page whose whole point is handing someone a link should not be where a
 * document is edited or deleted. A stranger's profile passes `owned` false and
 * is unchanged.
 */
function ProfileShelf({ handle, files }: { handle: string; files: Array<Record<string, unknown> & { id: string; format: string }> }) {
  return (
    <Shelf
      actions="share"
      assets={false}
      dates="absolute"
      rows={files.map((a) => ({ ...a, url: canonicalArtifactPath(a as never, handle) }) as never)}
    />
  );
}

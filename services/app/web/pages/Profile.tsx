/** The pretty URLs: an id-anchored artifact or the owner's public index. */
import {appFetch as fetch} from '@/web/api-origin';
import { useEffect, useRef, useState } from 'react';
import { takeBootstrap } from '../bootstrap';
import { Navigate, useLocation, useParams } from 'react-router';
import { ListingShell } from '@/components/Listing';
import {ProfileListing} from '@/components/ProfileListing';
export {ProfileListing} from '@/components/ProfileListing';
import { ArtifactPage } from './Artifact';
import { NotFoundPage } from './NotFound';

type Resolved =
  | { kind: 'redirect'; to: string }
  | { kind: 'artifact'; id: string }
  | { kind: 'public-profile'; handle: string; owner?: { id: string }; follow?: { following: boolean; count: number }; files: never[]; authed: boolean; anon: boolean };

export function ProfilePage() {
  const { user, '*': rest } = useParams();
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
  return (
    <ListingShell authed={page.authed} anon={page.anon}>
      <ProfileListing data={page} />
    </ListingShell>
  );
}

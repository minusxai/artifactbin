/** The pretty URLs: an id-anchored artifact or the owner's public index. */
import {pageJson,PageRequestError} from '../page-data';
import {PageStatus} from '../PageStatus';
import {useSession} from '../session';
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
  const {session}=useSession();
  const [error,setError]=useState<string|null>(null);
  const [attempt,setAttempt]=useState(0);
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
    const pending=new AbortController();
    setPage(null);setError(null);
    void pageJson<Resolved>(`/api/page/profile/${encodeURIComponent(user ?? '')}${rest ? '/' + rest : ''}`,pending.signal)
      .then((p) => { if (alive) setPage(p); })
      .catch(cause => { if (alive) {if(cause instanceof PageRequestError && cause.status===404)setPage('missing');else setError(cause.message);} });
    return () => { alive = false;pending.abort(); };
  }, [user, rest, pathname, typo,attempt]);
  if (typo || page==='missing') return <ListingShell authed={!!session?.user} anon={session?.kind==='anon'}><NotFoundPage/></ListingShell>;
  if (page === null) return <ListingShell authed={!!session?.user} anon={session?.kind==='anon'}><PageStatus label="profile" error={error} retry={()=>setAttempt(n=>n+1)}/></ListingShell>;
  if (page.kind === 'redirect') return <Navigate to={page.to} replace />;
  if (page.kind === 'artifact') return <ArtifactPage id={page.id} />;
  return (
    <ListingShell authed={page.authed} anon={page.anon}>
      <ProfileListing data={page} />
    </ListingShell>
  );
}

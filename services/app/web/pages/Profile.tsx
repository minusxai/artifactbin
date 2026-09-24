/** The pretty URLs: an id-anchored artifact or the owner's public index. */
import { usePageData } from '../use-page-data';
import { takeBootstrap } from '../bootstrap';
import { PageLoading } from '../PageLoading';
import { Navigate, useLocation, useParams } from 'react-router';
import { ListingShell } from '@/components/Listing';
import { ProfileListing } from '@/components/ProfileListing';
import { artifactViewPath, parsePrettyPath } from '@/lib/urls';
import { routePages } from '../route-pages';
import { NotFoundPage } from './NotFound';

// A profile listing does not need the artifact renderer/editor bundle.
const { ArtifactPage } = routePages;

type Resolved =
  | { kind: 'redirect'; to: string }
  | { kind: 'artifact'; id: string }
  | { kind: 'public-profile'; handle: string; owner?: { id: string; image: string | null }; follow?: { following: boolean; count: number }; files: never[]; authed: boolean; anon: boolean };

export function ProfilePage() {
  const { user, '*': rest, id } = useParams();
  // Both aliases use this SAME route element/child position, so healing /a/id
  // to its pretty address does not tear down the editor or author runtime.
  const artifactId = id ?? (user?.startsWith('@') ? parsePrettyPath(artifactViewPath(rest ?? '').split('/'))?.id : undefined);
  if (artifactId) return <ArtifactPage id={artifactId} />;
  return <ResolvedProfile key={`${user}/${rest}`} user={user} rest={rest} />;
}

function ResolvedProfile({ user, rest }: { user: string | undefined; rest: string | undefined }) {
  const { pathname } = useLocation();
  // A handle is `@name`; anything else here is a root typo — the 404, with no
  // profile fetch to ask about an address that could never resolve.
  const typo = !user?.startsWith('@');
  const { data: page, error, refresh } = usePageData<Resolved>(`/api/page/profile/${encodeURIComponent(user ?? '')}${rest ? '/' + rest : ''}`, { enabled: !typo, seed: () => takeBootstrap<Resolved>(pathname, 'profile') });
  if (typo) return <NotFoundPage />;
  if (page === null) return error ? <NotFoundPage /> : <PageLoading />;
  if (page.kind === 'redirect') return <Navigate to={page.to} replace />;
  if (page.kind === 'artifact') return <ArtifactPage id={page.id} />;
  return (
    <ListingShell authed={page.authed} anon={page.anon}>
      {error && <button aria-label="Retry profile" onClick={() => void refresh(true)}>Could not refresh profile. Retry</button>}
      <ProfileListing data={page} />
    </ListingShell>
  );
}

/** The listing is shared with the custom-domain home page (components/ProfileListing). */
export { ProfileListing };

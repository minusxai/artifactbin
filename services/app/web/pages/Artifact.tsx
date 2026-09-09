/**
 * Shared artifact route for readers, editors and owners. The page API supplies
 * authorized content and role capabilities; markup renders inline in the SPA,
 * while author scripts run only in managed sandboxed child frames.
 */
import { useEffect, useMemo, useRef } from 'react';
import { usePageData } from '../use-page-data';
import { expandSurface, type CompactSurface } from '@/lib/story/page-transport';
import { takeBootstrap } from '../bootstrap';
import { useLocation, useNavigate, useParams } from 'react-router';
import ArtifactShell from '@/components/ArtifactShell';
import ArtifactSurface from '@/components/ArtifactSurface';
import type { AccountWorkspace } from '@/lib/workspace';
import { ShellFrame } from '@/web/Shell';
import { PageLoading } from '@/web/PageLoading';
import { FolderPage } from './Folder';
import { NotFoundPage } from './NotFound';

/**
 * ONE ADDRESS, TWO PAGES, and `folder` is the discriminator.
 *
 * `/a/<id>` names any artifact, and a FOLDER has no document behind it — no
 * source or sheet — so the endpoint answers it with a listing
 * instead of a `surface`, and this page hands that to the folder page. The
 * discriminator is the block's PRESENCE rather than a `kind` field, because
 * `kind` here already means the browser credential (account | anon) and a
 * second meaning for the word is how a payload starts lying about itself.
 */
type Page =
  | { canonical: string; role: Parameters<typeof ArtifactShell>[0]['role']; kind: string; folder: Parameters<typeof FolderPage>[0]['folder']; workspace?: AccountWorkspace; ownerUsername?: string | null; surface?: undefined }
  | { canonical: string; role: Parameters<typeof ArtifactShell>[0]['role']; kind: string; like?: { liked: boolean; count: number }; follow?: { userId: string; following: boolean; count: number } | null; surface: Parameters<typeof ArtifactSurface>[0]; folder?: undefined };

type TransportPage = Extract<Page, { folder: unknown }> | (Omit<Extract<Page, { surface: object }>, 'surface'> & { surface: CompactSurface<Parameters<typeof ArtifactSurface>[0]> });
function decodePage(page: TransportPage): Page {
  return page.surface ? { ...page, surface: expandSurface<Parameters<typeof ArtifactSurface>[0]>(page.surface) } : page;
}

export function ArtifactPage({ id: given }: { id?: string } = {}) {
  const params = useParams();
  const id = given ?? params.id!;
  return <ArtifactDocument key={id} id={id} />;
}

/** Identity alone owns this lifetime; signal/search updates never recreate the editor. */
function ArtifactDocument({ id }: { id: string }) {
  const location = useLocation();
  const { search } = location;
  const navigate = useNavigate();
  // The server may have inlined this page's data (server/app): render from it at once.
  const initialSearch = useRef(search).current;
  const url = `/api/page/artifact/${id}${initialSearch}`;
  const { data: transport, error, refresh } = usePageData<TransportPage>(url, { refreshMounted: false, pauseRevalidation: location.hash === '#edit', seed: () => takeBootstrap<TransportPage>(window.location.pathname, 'artifact') });
  // Decode once at consumption, regardless of whether JSON came from SSR,
  // a cached navigation, or a network read. The cache keeps the compact shape.
  const page = useMemo(() => transport ? decodePage(transport) : null, [transport]);
  useEffect(() => {
    // The address heals to the canonical one — after the ACL, which the fetch already passed.
    if (page && !page.surface?.captureKey && page.canonical !== location.pathname) {
      void navigate(page.canonical + search + location.hash, { replace: true, state: location.state });
    }
  }, [page, search, location.pathname, location.hash, location.state, navigate]);
  if (page === null) return error ? <NotFoundPage /> : <PageLoading />;
  // A folder is a listing, not a document: no ArtifactShell and no surface
  // (there is no inline story runtime). Every folder gets the normal PAGE frame;
  // account-wide dashboard data is still supplied only to its owner.
  if (page.folder) {
    const folder = <FolderPage folder={page.folder} role={page.role} workspace={page.workspace} ownerUsername={page.ownerUsername} />;
    return <ShellFrame hideBreadcrumb>{folder}</ShellFrame>;
  }
  return (
    <ArtifactShell role={page.role}>
      {error && <button aria-label="Retry artifact" disabled={location.hash === '#edit'} onClick={() => void refresh(true)}>Could not refresh artifact. {location.hash === '#edit' ? 'Finish editing to retry.' : 'Retry'}</button>}
      {/* The reader's `<Value>` selection travels in this page's own query
          string (`?$region=west`); the surface forwards its `$` params into
          the inline document runtime. From the ROUTER, never `window.location` —
          nothing may read that during render. */}
      {/* `like` rides beside `surface` rather than inside it: the surface's own
          props are what the DOCUMENT is, and this is what the viewer is to
          it — one fetch either way, and the export capture (which has no
          viewer) never carries it. */}
      <ArtifactSurface {...page.surface} search={search} {...(page.like ? { like: page.like } : {})} {...(page.follow !== undefined ? { follow: page.follow } : {})} />
    </ArtifactShell>
  );
}

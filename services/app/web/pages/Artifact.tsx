/**
 * Shared artifact route for readers, editors and owners. The page API supplies
 * authorized content and role capabilities; markup renders inline in the SPA,
 * while author scripts run only in managed sandboxed child frames.
 */
import { useEffect, useMemo, useRef } from 'react';
import { usePageData } from '../use-page-data';
import { expandSurface } from '@/lib/story/page-transport';
import { takeBootstrap } from '../bootstrap';
import { useLocation, useNavigate, useParams } from 'react-router';
import ArtifactShell from '@/components/ArtifactShell';
import ArtifactSurface from '@/components/ArtifactSurface';
import { PageLoading } from '@/web/PageLoading';
import { canEdit } from '@/lib/share-roles';
import { NotFoundPage } from './NotFound';
import { useArtifactView } from '../use-artifact-view';
import { didClientNavigateTo, initialStoryIsCompiled } from '../initial-story';
import { readerNavigation } from '../reader-navigation';

/**
 * `/a/<id>[/edit]` and the pretty `/@user/...` alias both admit here, but ONLY for a document a
 * markup reader can show. Solid owns every folder and every dataset edit address at either shape
 * (lib/solid-routes isSolidPage; server/app documentPreparation heals BOTH shapes to whichever HTML
 * entry owns the resolved format), so a fresh load never lands here with `folder` set or with
 * `surface.format === 'dataset'` while editing. The only way it could is an in-app link that soft-
 * navigated across that boundary instead of a full one — reload lands it on the entry that does own it.
 */
type Page =
  { canonical: string; role: Parameters<typeof ArtifactShell>[0]['role']; kind: string; like?: { liked: boolean; count: number }; follow?: { userId: string; following: boolean; count: number } | null;
    /** `?version=N` on this page's own address, resolved by the endpoint (lib/archived-version). Absent for the head. */
    archived?: { version: number; head: number };
    surface: Parameters<typeof ArtifactSurface>[0]; folder?: unknown };

/** The wire shape: a document's surface carries no raw sheet and its dataflow only inside its runtime (lib/story/page-transport). A `folder` answer (see the type doc above) carries no surface at all. */
type TransportPage = Omit<Page, 'surface'> & { surface?: object };
function decodePage(page: TransportPage): Page {
  return page.folder ? (page as Page) : { ...page, surface: expandSurface<Parameters<typeof ArtifactSurface>[0]>(page.surface!) };
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
  const editingRoute = location.pathname.endsWith('/edit');
  const navigate = useNavigate();
  // The server may have inlined this page's data (server/app): render from it at once.
  const initialSearch = useRef(search).current;
  const url = `/api/page/artifact/${id}${initialSearch}`;
  const { data: transport, error, refresh } = usePageData<TransportPage>(url, { refreshMounted: false, pauseRevalidation: editingRoute || location.hash === '#edit', seed: () => takeBootstrap<TransportPage>(window.location.pathname, 'artifact') });
  // Decode once at consumption, regardless of whether JSON came from SSR,
  // a cached navigation, or a network read. The cache keeps the compact shape.
  const page = useMemo(() => transport ? decodePage(transport) : null, [transport]);
  const needsReaderDocument = !!page?.surface && page.surface.format === 'markup' && !page.surface.captureKey
    && !editingRoute && !initialStoryIsCompiled() && didClientNavigateTo(location.pathname);
  // Solid owns this address's shell (a folder, or a dataset's edit route) but an in-app link soft-
  // navigated here instead of loading it fresh. A reload lands on the entry that does own it.
  const crossesToSolid = !!page && (!!page.folder || (editingRoute && page.surface?.format === 'dataset'));
  useEffect(() => {
    if (crossesToSolid) window.location.reload();
  }, [crossesToSolid]);
  useEffect(() => {
    if (needsReaderDocument) readerNavigation.open(location.pathname + search + location.hash);
  }, [needsReaderDocument, location.pathname, location.hash, search]);
  useArtifactView(id, page?.surface?.format === 'markup' && !page.surface.captureKey && (!editingRoute || canEdit(page.role)));
  useEffect(() => {
    // The address heals to the canonical one — after the ACL, which the fetch already passed.
    if (needsReaderDocument) return;
    if (page && !page.surface?.captureKey && page.canonical + (editingRoute ? '/edit' : '') !== location.pathname) {
      void navigate(page.canonical + (editingRoute ? '/edit' : '') + search + location.hash, { replace: true, state: location.state });
    }
  }, [page, needsReaderDocument, editingRoute, search, location.pathname, location.hash, location.state, navigate]);
  if (page === null) return error ? <NotFoundPage /> : <PageLoading />;
  if (needsReaderDocument) return <PageLoading />;
  if (crossesToSolid) return <PageLoading />;
  if (editingRoute && !canEdit(page.role)) return <NotFoundPage />;
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
      {/* `archived` rides beside `surface` for the same reason `like` does: the
          surface's own props are what the DOCUMENT is, and this is what this
          RENDER is — an older version, read-only. `version=N` stays in the
          address (it is not a `$` value, and the intent strip keeps every other
          byte), so a refresh and a copied link both show the same version. */}
      <ArtifactSurface {...page.surface} search={search} {...(page.like ? { like: page.like } : {})} {...(page.follow !== undefined ? { follow: page.follow } : {})} {...(page.archived ? { archived: page.archived } : {})} />
    </ArtifactShell>
  );
}

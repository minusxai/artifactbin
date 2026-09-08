/**
 * The OWNER's/editor's page for a document: the shell around the served
 * document, from /api/page/artifact/:id. A reader never reaches this — the
 * server hands them the document itself at the same URL.
 */
import { useEffect, useRef, useState } from 'react';
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
 * source, no sheet, no frame — so the endpoint answers it with a listing
 * instead of a `surface`, and this page hands that to the folder page. The
 * discriminator is the block's PRESENCE rather than a `kind` field, because
 * `kind` here already means the browser credential (account | anon) and a
 * second meaning for the word is how a payload starts lying about itself.
 */
type Page =
  | { canonical: string; role: Parameters<typeof ArtifactShell>[0]['role']; kind: string; folder: Parameters<typeof FolderPage>[0]['folder']; workspace?: AccountWorkspace; ownerUsername?: string | null; surface?: undefined }
  | { canonical: string; role: Parameters<typeof ArtifactShell>[0]['role']; kind: string; like?: { liked: boolean; count: number }; follow?: { userId: string; following: boolean; count: number } | null; surface: Parameters<typeof ArtifactSurface>[0]; folder?: undefined };

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
  const [page, setPage] = useState<Page | 'missing' | null>(() => takeBootstrap<Page>(window.location.pathname, 'artifact'));
  const initialSearch = useRef(search).current;
  const bootstrapped = useRef(page !== null).current;
  useEffect(() => {
    if (bootstrapped) return;
    const controller = new AbortController();
    void fetch(`/api/page/artifact/${id}${initialSearch}`, { credentials: 'same-origin', signal: controller.signal })
      .then((r): Promise<Page | 'missing'> => (r.ok ? (r.json() as Promise<Page>) : Promise.resolve('missing' as const)))
      .then((p) => { if (!controller.signal.aborted) setPage(p); })
      .catch(() => { if (!controller.signal.aborted) setPage('missing'); });
    return () => { controller.abort(); };
  }, [id, initialSearch, bootstrapped]);
  useEffect(() => {
    // The address heals to the canonical one — after the ACL, which the fetch already passed.
    if (page && page !== 'missing' && !page.surface?.captureKey && page.canonical !== location.pathname) {
      void navigate(page.canonical + search + location.hash, { replace: true, state: location.state });
    }
  }, [page, search, location.pathname, location.hash, location.state, navigate]);
  if (page === null) return <PageLoading />;
  if (page === 'missing') return <NotFoundPage />;
  // A folder is a listing, not a document: no ArtifactShell and no surface
  // (there is nothing to frame). Every folder gets the normal PAGE frame;
  // account-wide dashboard data is still supplied only to its owner.
  if (page.folder) {
    const folder = <FolderPage folder={page.folder} role={page.role} workspace={page.workspace} ownerUsername={page.ownerUsername} />;
    return <ShellFrame hideBreadcrumb>{folder}</ShellFrame>;
  }
  return (
    <ArtifactShell role={page.role}>
      {/* The reader's `<Value>` selection travels in this page's own query
          string (`?$region=west`); the surface forwards its `$` params into
          the document it frames. From the ROUTER, never `window.location` —
          nothing may read that during render. */}
      {/* `like` rides beside `surface` rather than inside it: the surface's own
          props are what the DOCUMENT is, and this is what the viewer is to
          it — one fetch either way, and the export capture (which has no
          viewer) never carries it. */}
      <ArtifactSurface {...page.surface} search={search} {...(page.like ? { like: page.like } : {})} {...(page.follow !== undefined ? { follow: page.follow } : {})} />
    </ArtifactShell>
  );
}

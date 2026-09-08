/**
 * The OWNER's/editor's page for a document: the shell around the served
 * document, from /api/page/artifact/:id. A reader never reaches this — the
 * server hands them the document itself at the same URL.
 */
import {isControlsClient,isFolderClient} from '@/web/api-origin';
import { useEffect, useReducer, useState } from 'react';
import { takeBootstrap } from '../bootstrap';
import { useLocation, useNavigate, useParams } from 'react-router';
import ArtifactShell from '@/components/ArtifactShell';
import ArtifactSurface from '@/components/ArtifactSurface';
import type { AccountWorkspace } from '@/lib/workspace';
import { ShellFrame } from '@/web/Shell';
import { FolderPage } from './Folder';
import { NotFoundPage } from './NotFound';
import { PageStatus } from '../PageStatus';
import { pageJson, PageRequestError } from '../page-data';

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
  | { canonical: string; role: Parameters<typeof ArtifactShell>[0]['role']; kind: string; folder: Parameters<typeof FolderPage>[0]['folder']; workspace?: AccountWorkspace; ownerUsername?: string | null; liveEnabled?: boolean; surface?: undefined }
  | { canonical: string; role: Parameters<typeof ArtifactShell>[0]['role']; kind: string; like?: { liked: boolean; count: number }; follow?: { userId: string; following: boolean; count: number } | null; surface: Parameters<typeof ArtifactSurface>[0]; folder?: undefined };

export function ArtifactPage({ id: given }: { id?: string } = {}) {
  const params = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const id = given ?? params.id!;
  const requestKey = `${id}\n${search}`;
  // The server may have inlined this page's data (server/app): render from it at once.
  const [retry, retryLoad] = useReducer((value: number) => value + 1, 0);
  const [loaded, setLoaded] = useState<{ key: string; page: Page | 'missing' | Error | null }>(() => ({ key: requestKey, page: takeBootstrap<Page>(window.location.pathname, 'artifact') }));
  const page = loaded.key === requestKey ? loaded.page : null;
  useEffect(() => {
    if (loaded.key === requestKey && loaded.page) return; // served with its data
    const controller = new AbortController();
    let alive = true;
    void pageJson<Page>(`/api/page/artifact/${id}${search}`, controller.signal)
      .then((p) => { if (alive) setLoaded({ key: requestKey, page: p }); })
      .catch((error: unknown) => {
        if (!alive) return;
        setLoaded({ key: requestKey, page: error instanceof PageRequestError && error.status === 404 ? 'missing' : error instanceof Error ? error : new Error('Could not load this page. Please retry.') });
      });
    return () => { alive = false; controller.abort(); };
  }, [id, search, requestKey, loaded, retry]);
  useEffect(() => {
    // The address heals to the canonical one — after the ACL, which the fetch already passed.
    if(isFolderClient())return; // Main's server already owns canonicalization.
    if (!isControlsClient() && page && page !== 'missing' && !(page instanceof Error) && !page.surface?.captureKey && page.canonical !== window.location.pathname) navigate(page.canonical + search + window.location.hash, { replace: true });
  }, [navigate, page, search]);
  if (page === null) return <PageStatus label="artifact" />;
  if (page === 'missing') return <NotFoundPage />;
  if (page instanceof Error) return <PageStatus label="artifact" error={page.message} retry={() => { setLoaded({key: requestKey, page: null}); retryLoad(); }} />;
  // A type change after server admission must never turn this trusted frame
  // into an author surface. Only the dedicated artifact-controls path may do that.
  if(isFolderClient() && !page.folder)return <NotFoundPage />;
  // A folder is a listing, not a document: no ArtifactShell and no surface
  // (there is nothing to frame). Every folder gets the normal PAGE frame;
  // account-wide dashboard data is still supplied only to its owner.
  if (page.folder) {
    const folder = <FolderPage folder={page.folder} role={page.role} workspace={page.workspace} ownerUsername={page.ownerUsername} liveEnabled={page.liveEnabled} />;
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
      <ArtifactSurface {...page.surface} controlsOnly={isControlsClient()} search={search} {...(page.like ? { like: page.like } : {})} {...(page.follow !== undefined ? { follow: page.follow } : {})} />
    </ArtifactShell>
  );
}

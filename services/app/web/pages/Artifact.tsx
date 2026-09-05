/**
 * The OWNER's/editor's page for a document: the shell around the served
 * document, from /api/page/artifact/:id. A reader never reaches this — the
 * server hands them the document itself at the same URL.
 */
import { useEffect, useState } from 'react';
import { takeBootstrap } from '../bootstrap';
import { useLocation, useParams } from 'react-router';
import ArtifactShell from '@/components/ArtifactShell';
import ArtifactSurface from '@/components/ArtifactSurface';
import { NotFoundPage } from './NotFound';

type Page = { canonical: string; role: Parameters<typeof ArtifactShell>[0]['role']; kind: string; like?: { liked: boolean; count: number }; surface: Parameters<typeof ArtifactSurface>[0] };

export function ArtifactPage({ id: given }: { id?: string } = {}) {
  const params = useParams();
  const { search } = useLocation();
  const id = given ?? params.id!;
  // The server may have inlined this page's data (server/app): render from it at once.
  const [page, setPage] = useState<Page | 'missing' | null>(() => takeBootstrap<Page>(window.location.pathname, 'artifact'));
  useEffect(() => {
    if (page) return; // served with its data
    let alive = true;
    void fetch(`/api/page/artifact/${id}${search}`, { credentials: 'same-origin' })
      .then((r): Promise<Page | 'missing'> => (r.ok ? (r.json() as Promise<Page>) : Promise.resolve('missing' as const)))
      .then((p) => { if (alive) setPage(p); })
      .catch(() => { if (alive) setPage('missing'); });
    return () => { alive = false; };
  }, [id, search, page]);
  useEffect(() => {
    // The address heals to the canonical one — after the ACL, which the fetch already passed.
    if (page && page !== 'missing' && !page.surface.captureKey && page.canonical !== window.location.pathname) window.history.replaceState(null, '', page.canonical + search + window.location.hash);
  }, [page, search]);
  if (page === null) return <div aria-label="Loading page" />;
  if (page === 'missing') return <NotFoundPage />;
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
      <ArtifactSurface {...page.surface} search={search} {...(page.like ? { like: page.like } : {})} />
    </ArtifactShell>
  );
}

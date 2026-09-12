import { Database } from 'lucide-react';
import { usePageData, fetchPageData } from '../use-page-data';
import { Navigate } from 'react-router';
import type { PickerFolder } from '@/components/FolderPicker';
import type { ShelfRow } from '@/components/Shelf';
import { SHELF_LIST_PER_PAGE } from '@/components/Shelf';
import { ArtifactTable } from '@/components/ArtifactTable';
import { MicroLabel, PANEL } from '@/components/ui';
import { useSession } from '@/web/session';

interface AssetsData {
  assets: ShelfRow[];
  folders: ShelfRow[];
}

/** The data/image files that support documents, on their own management page. */
export function AssetsPage() {
  const { session } = useSession();
  const { data, error: failed, refresh } = usePageData<AssetsData>('/api/page/assets', { loader: async (signal) => {
      const response = await fetch('/api/page/assets', { credentials: 'same-origin', signal });
      if (response.ok) return response.json() as Promise<AssetsData>;
      // During Vite development the SPA hot-reloads, while Hono's generated
      // route table is mounted only at process boot. Let a newly-added page
      // work before that one required restart by reading the already-mounted
      // Home payload; production and every subsequent boot use the focused API.
      if (response.status === 404) {
          const home = await fetchPageData<{ signedIn: boolean; artifacts?: ShelfRow[] }>('/api/page/home', signal);
        if (home.signedIn) {
          const rows = home.artifacts ?? [];
          return {
            assets: rows.filter((row) => row.format !== 'markup' && row.format !== 'folder'),
            folders: rows.filter((row) => row.format === 'folder'),
          };
        }
      }
      throw Object.assign(new Error('assets unavailable'), { status: response.status });
  } });
  const load = () => { void refresh(true); };

  if (session && !session.user) return <Navigate to="/login?callbackUrl=/assets" replace />;
  const folders: PickerFolder[] = (data?.folders ?? []).map((folder) => ({
    id: folder.id,
    title: folder.title,
    ancestor_ids: folder.ancestor_ids ?? [],
  }));

  return (
    <main className="mx-auto mt-8 max-w-[80rem] px-4 pb-24 sm:px-6">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Database aria-hidden="true" className="size-3 stroke-[1.8] text-accent" />
        <MicroLabel>assets</MicroLabel>
        <span className="font-mono text-[10px] text-faint">the material documents are built from</span>
        <a href="/datasets/new" aria-label="Create dataset" className="ml-auto rounded border border-edge-bright px-3 py-1.5 font-mono text-xs text-accent hover:border-accent">Create dataset</a>
      </div>

      {failed && !data ? (
        <section aria-label="Assets unavailable" className={`${PANEL} flex h-24 items-center justify-center gap-3 px-4 font-mono text-xs text-faint`}>
          <span>could not load assets</span>
          <button type="button" aria-label="Retry assets" onClick={load} className="cursor-pointer text-accent underline underline-offset-4">retry</button>
        </section>
      ) : !data ? (
        <section aria-label="Loading assets" aria-busy="true" className={`${PANEL} flex h-24 items-center justify-center font-mono text-xs text-faint`}>
          loading assets…
        </section>
      ) : data.assets.length === 0 ? (
        <section aria-label="Assets" className={`${PANEL} px-4 py-8 text-center font-mono text-xs text-faint`}>
          no assets yet
        </section>
      ) : (
        <section aria-label="Assets">
          {failed && <button aria-label="Retry assets" onClick={load}>Could not refresh assets. Retry</button>}
          <ArtifactTable
            artifacts={data.assets}
            folders={folders}
            manage
            canEdit={false}
            showViews={false}
            filtersInline
            perPage={SHELF_LIST_PER_PAGE}
            searchLabel="Search assets"
            searchPlaceholder="search assets"
          />
        </section>
      )}
    </main>
  );
}

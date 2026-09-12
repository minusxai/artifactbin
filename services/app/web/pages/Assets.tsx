import { Database } from 'lucide-react';
import { usePageData } from '../use-page-data';
import { Navigate } from 'react-router';
import type { PickerFolder } from '@/components/FolderPicker';
import { useRef, useState } from 'react';
import type { AssetSelection, WorkspaceAssets } from '@/lib/workspace-inventory';
import { ArtifactTable } from '@/components/ArtifactTable';
import { MicroLabel, PANEL } from '@/components/ui';
import { useSession } from '@/web/session';

/** The data/image files that support documents, on their own management page. */
export function AssetsPage() {
  const { session } = useSession();
  const [selection, setSelection] = useState<AssetSelection>({ page: 0, query: '', formats: [], visibilities: [] });
  const params = new URLSearchParams();
  if (selection.page) params.set('page', String(selection.page));
  if (selection.query) params.set('q', selection.query);
  selection.formats.forEach(format => params.append('formats', format));
  selection.visibilities.forEach(visibility => params.append('visibilities', visibility));
  const key = `/api/page/assets${params.size ? `?${params}` : ''}`;
  const { data: response, error: failed, pending, refresh } = usePageData<WorkspaceAssets>(key, { enabled: Boolean(session?.user) });
  // Keep the search control mounted while its next server result loads. Never retain another account's rows.
  const previous = useRef<{ owner: string; data: WorkspaceAssets } | null>(null);
  const owner = session?.user?.id;
  if (response && owner) previous.current = { owner, data: response };
  const data = response ?? (previous.current?.owner === owner ? previous.current?.data : null);
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
      ) : data.assets.length === 0 && !selection.query && !selection.formats.length && !selection.visibilities.length ? (
        <section aria-label="Assets" className={`${PANEL} px-4 py-8 text-center font-mono text-xs text-faint`}>
          no assets yet
        </section>
      ) : (
        <section aria-label="Assets" aria-busy={pending}>
          {failed && <button aria-label="Retry assets" onClick={load}>Could not refresh assets. Retry</button>}
          <ArtifactTable
            artifacts={data.assets}
            folders={folders}
            manage
            canEdit={false}
            showViews={false}
            filtersInline
            perPage={data.perPage}
            remote={{
              selection: { ...selection, page: response?.page ?? selection.page },
              total: data.total, formats: data.formats, visibilities: data.visibilities, pending,
              onChange: setSelection,
            }}
            searchLabel="Search assets"
            searchPlaceholder="search assets"
          />
        </section>
      )}
    </main>
  );
}

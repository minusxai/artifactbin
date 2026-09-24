import { useEffect, useMemo, useState } from 'react';
import { collectRefUses } from '@/lib/story/refs';
import { artifactEditPath } from '@/lib/urls';
import { canEdit, type ArtifactRole } from '@/lib/share-roles';
import { CatalogRows, DatasetCatalogView } from '@/components/DatasetCatalogView';
import ShareLink from '@/components/ShareLink';
import { DatasetPolicies } from '@/components/DatasetPolicies';
import type { DatasetCatalog } from '@/lib/datasets/types';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import type { Row } from '@/lib/story/dataflow';

export interface ArtifactReference {
  id: string;
  kind: string;
  title?: string | null;
}

/** Current source owns membership; saved reference metadata supplies readable names. */
export interface ReferencedFilesProps {
  source: string;
  references: ArtifactReference[];
  datasetsOnly?: boolean;
}

export function ReferencedFiles({ source, references, datasetsOnly = false }: ReferencedFilesProps) {
  const files = useMemo(() => {
    const names = new Map(references.map(ref => [ref.id, ref.title]));
    const uses = collectRefUses(source);
    // During an incomplete source edit keep the last saved reference list.
    return [...new Map((uses ?? references).filter(ref => !datasetsOnly || ref.kind === 'dataset')
      .map(ref => [ref.id, { id: ref.id, kind: ref.kind, title: names.get(ref.id) }])).values()];
  }, [source, references, datasetsOnly]);
  const [selected, setSelected] = useState<string | null>(null);
  const file = files.find(ref => ref.id === selected);
  return <section aria-label={datasetsOnly ? 'Referenced datasets' : 'Referenced files'} className="space-y-4">
    <h2 className="text-base font-semibold text-fg">{datasetsOnly ? 'Datasets' : 'Referenced files'}</h2>
    {!files.length ? <p className="text-sm text-muted">{datasetsOnly ? 'No referenced datasets.' : 'No referenced files.'}</p> : <>
      <div className="flex flex-wrap gap-2">
        {files.map(ref => <button key={ref.id} type="button" aria-label={`View ${ref.title || ref.id}`} aria-pressed={ref.id === selected}
          onClick={() => setSelected(ref.id)} className={`min-w-0 rounded border px-3 py-2 text-left text-sm ${ref.id === selected ? 'border-accent bg-accent-soft text-accent' : 'border-edge text-fg hover:bg-raised'}`}>
          <span className="block break-all">{ref.title || ref.id}</span><span className="text-xs text-muted">{ref.kind}</span>
        </button>)}
      </div>
      {file ? <ReferencePreview key={file.id} file={file} /> : <p className="text-sm text-muted">Select a file to preview it{datasetsOnly ? ' and manage its data settings' : ''}.</p>}
    </>}
  </section>;
}

interface ReferencePage {
  role: ArtifactRole;
  surface: {
    id: string; format: string; title: string | null; version: number;
    content?: string; columns?: DatasetColumn[]; catalog?: DatasetCatalog;
  };
}

/** The ordinary reader endpoint owns authorization; never inherit the document's edit role. */
function ReferencePreview({ file }: { file: ArtifactReference }) {
  const [page, setPage] = useState<ReferencePage | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError(false);
    void fetch(`/api/page/artifact/${encodeURIComponent(file.id)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('unavailable');
        const result = await response.json() as ReferencePage;
        if (!result.surface) throw new Error('unavailable');
        if (!controller.signal.aborted) setPage(result);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [file.id, attempt]);
  if (error) return <div role="alert" className="space-y-2 text-sm text-muted">
    <p>This file is unavailable or you do not have access.</p>
    <button type="button" onClick={() => setAttempt(value => value + 1)} className="underline">Retry file preview</button>
  </div>;
  if (!page) return <p role="status" className="text-sm text-muted">Loading file…</p>;
  const { surface } = page;
  const title = surface.title || file.title || file.id;
  const href = `/a/${encodeURIComponent(file.id)}`;
  const raw = `${href}/raw?v=${surface.version}`;
  const editable = canEdit(page.role);
  return <div className="space-y-5 rounded border border-edge p-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="break-all text-sm font-semibold">{title}</h3>
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-muted underline">Open file in new tab</a>
    </header>
    {surface.format === 'image' && <img src={raw} alt={title} className="max-h-[60vh] max-w-full object-contain" />}
    {surface.format === 'pdf' && <iframe title={`Preview ${title}`} src={raw} className="h-[60vh] w-full rounded border border-edge" />}
    {surface.format === 'file' && <a href={raw} target="_blank" rel="noopener noreferrer" className="text-sm underline">Download {title}</a>}
    {surface.format === 'viz' && <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-xs">{surface.content}</pre>}
    {surface.format === 'dataset' && <>
      {surface.catalog ? <DatasetCatalogView id={file.id} catalog={surface.catalog} canEdit={false} />
        : <CatalogRows result={{ rows: JSON.parse(surface.content || '[]') as Row[], columns: surface.columns ?? [], refreshedAt: '' }} />}
      {editable && <div className="space-y-5 border-t border-edge pt-4">
        <a aria-label="Configure dataset" href={artifactEditPath(file.id)} target="_blank" rel="noopener noreferrer" className="text-sm underline">Configure dataset →</a>
        <ShareLink className="" artifactId={file.id} title={title} editable format="dataset" datasetKind={surface.catalog?.kind} variant="embedded" url={href} />
        {surface.catalog?.kind !== 'postgres' && <DatasetPolicies artifactId={file.id} />}
      </div>}
    </>}
  </div>;
}

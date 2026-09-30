/* @jsxImportSource solid-js */
/**
 * THE DATA TIERS' PAGE — `/a/<id>` (and its pretty alias) for an image, a pdf, a stored file, a viz
 * recipe or a dataset: the data branch of components/ArtifactSurface in Solid. The data tiers are
 * VALUES, not documents: they read as an image, a file card, a table or a recipe inside the app's own
 * measure, under the one app bar (solid/components/PageChrome) carrying the artifact's title as its
 * crumb, Fork as the bar's action and the "Artifact controls" panel (forked-from, the owner's dataset
 * reference and the sharing menu).
 *
 * A capture (the exporter's keyed `/a/<id>?key=`, lib/export) photographs `<main>`: it renders the same
 * view without opening the live stream. Everyone else follows the artifact live: a new version redraws
 * the image, the preview and the title, and a dataset re-reads its catalog from the page door
 * (`/api/page/artifact/<id>`) — a version frame carries rows, not catalog definitions.
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { ArtifactRole } from '@/lib/share-roles';
import { canEdit as canEditRole, canGovern } from '@/lib/share-roles';
import type { DatasetCatalog } from '@/lib/datasets/types';
import { datasetQuerySnippet } from '@/lib/story/dataset-usage';
import { formatFileSize } from '@/lib/file-display';
import { displayTitle } from '@/lib/story/title';
import type { ReaderForkedFrom } from '@/lib/story/reader-chrome';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { pageDataChanged } from '@/web/page-data-events';
import { PageChrome, useChromeVisibility } from '../components/PageChrome';
import { DatasetCatalogView } from '../components/DatasetCatalogView';
import { DocumentSharing } from '../document/DocumentSharing';
import { ForkArtifact } from '../document/ForkArtifact';
import { createLiveArtifact } from '../editor/create-live-artifact';

export interface DataAnswer {
  role: ArtifactRole;
  kind: string;
  canonical?: string;
  archived?: { version: number; head: number } | null;
  surface: {
    id: string; editId: string; format: string; title: string | null; version: number;
    visibility?: string; captureKey?: string | null;
    /** The data tiers' content: a viz recipe's source, a dataset's legacy rows (JSON) — null for readers where withheld. */
    source?: string | null; dataPreview: string; columns: Array<{ name: string; type?: string }>;
    catalog?: DatasetCatalog;
    /** pdf / file: the two facts a person picks a file by. */
    bytes?: number; pages?: number | null;
    author?: { username: string | null; forkedFrom?: ReaderForkedFrom | null } | null;
  };
}

const CONTROL_ROW = 'flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs text-muted transition-colors hover:bg-raised hover:text-fg';
const SECTION_HEADING = 'mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint';

const safeRows = (content: string): Array<Record<string, unknown>> => {
  try { const parsed = JSON.parse(content); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

export function ArtifactDataPage(props: { answer: DataAnswer }): JSX.Element {
  const surface = props.answer.surface;
  const id = surface.id;
  const format = surface.format;
  const archived = !!props.answer.archived;
  // An archived render acts on nothing: every affordance here acts on the head.
  const owner = () => canGovern(props.answer.role) && !archived;
  const canEdit = () => canEditRole(props.answer.role) && !archived;
  const capture = !!surface.captureKey;

  // This page draws the one bar itself: with the artifact's title, its Fork action and its controls.
  const setChromeVisible = useChromeVisibility();
  onMount(() => setChromeVisible?.(false));
  onCleanup(() => setChromeVisible?.(true));

  const live = createLiveArtifact({
    backend: createHttpBackend(id), id, initialEditId: surface.editId, initialVersion: surface.version,
    enabled: !capture && typeof EventSource === 'function',
  });
  createEffect(() => { if (live()) pageDataChanged(); });
  const [liveCatalog, setLiveCatalog] = createSignal<{ version: number; catalog: DatasetCatalog } | null>(null);
  createEffect(() => {
    const frame = live();
    if (format !== 'dataset' || frame?.format !== 'dataset') return;
    let alive = true;
    const minimumVersion = frame.version;
    void fetch(`/api/page/artifact/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() as Promise<{ surface?: { version: number; catalog?: DatasetCatalog } }> : null)
      .then((page) => {
        const next = page?.surface;
        if (alive && next?.catalog && next.version >= minimumVersion) setLiveCatalog({ version: next.version, catalog: next.catalog });
      })
      .catch(() => { /* Keep the current table; another stream wakeup retries. */ });
    onCleanup(() => { alive = false; });
  });
  const catalog = () => { const adopted = liveCatalog(); return adopted && adopted.version >= surface.version ? adopted.catalog : surface.catalog; };

  const title = () => displayTitle({ title: live()?.title ?? surface.title, source: null });
  createEffect(() => { document.title = title(); });
  const content = () => live()?.dataPreview ?? surface.dataPreview;
  // The image renders from ./raw; a new version remounts it so the browser asks again.
  const rawKey = () => live()?.editId ?? surface.editId;
  const rows = () => safeRows(content());
  const columns = () => surface.columns.length ? surface.columns : Object.keys(rows()[0] ?? {}).map((name) => ({ name, type: undefined as string | undefined }));

  const [copiedRef, setCopiedRef] = createSignal(false);
  const controls = () => <div class="space-y-4">
    <Show when={surface.author?.forkedFrom || canEdit()}>
      <section aria-label="Document actions">
        <h2 class={SECTION_HEADING}>Artifact</h2>
        <Show when={surface.author?.forkedFrom}>{(source) => <p data-mx-forked-from class="px-2 py-2 font-mono text-xs text-muted">forked from <Show when={source().href} fallback={source().label}>{(href) => <a href={href()} aria-label="Open the artifact this was forked from" class="underline">{source().label}</a>}</Show></p>}</Show>
        <Show when={canEdit() && !owner()}><DocumentSharing id={id} title={title()} owner={false} editable variant="menu" version={live()?.version ?? surface.version} format={format} datasetKind={catalog()?.kind} /></Show>
      </section>
    </Show>
    <Show when={owner()}>
      <section aria-label="Owner actions">
        <h2 class={SECTION_HEADING}>owner</h2>
        <Show when={format === 'dataset'}>
          <button type="button" aria-label="Copy dataset reference" class={`${CONTROL_ROW} text-accent`}
            onClick={() => { void navigator.clipboard?.writeText(catalog() ? datasetQuerySnippet(id, catalog()) : `ref:${id}`); setCopiedRef(true); }}>
            {copiedRef() ? 'copied dataset reference' : catalog() ? `copy query · source="${id}"` : `copy ref:${id}`}
          </button>
        </Show>
        <DocumentSharing id={id} title={title()} owner variant="menu" version={live()?.version ?? surface.version} format={format} datasetKind={catalog()?.kind} />
      </section>
    </Show>
  </div>;

  return <>
    <PageChrome title={title()} label="Artifact controls" actions={<ForkArtifact id={id} title={title()} variant="bar" />} controls={controls} />
    <main class="mx-auto w-full max-w-5xl px-4 pt-6 pb-6">
      <Show when={format === 'image'}>
        <Show when={rawKey()} keyed>{(_version) => <img src={`/a/${id}/raw`} alt={title()} class="mt-4 max-w-full rounded-[6px] border border-edge" />}</Show>
      </Show>
      <Show when={format === 'pdf' || format === 'file'}>
        {/* A file is not something the app renders: the browser does, at /raw. This is the two facts a
            person picks a file by and the link that opens it — the same card <File> draws in a document. */}
        <div class="mt-4 rounded-[6px] border border-edge bg-surface p-4">
          <p class="font-sans text-xs text-muted" aria-label={format === 'pdf' ? 'PDF summary' : 'File summary'}>
            {format === 'pdf' ? 'PDF' : 'File'}{surface.bytes ? ` · ${formatFileSize(surface.bytes)}` : ''}{surface.pages ? ` · ${surface.pages} page${surface.pages === 1 ? '' : 's'}` : ''}
          </p>
          <a aria-label={format === 'pdf' ? 'Open the PDF' : 'Download file'} href={`/a/${id}/raw`} target="_blank" rel="noopener noreferrer" class="mt-2 inline-block font-sans text-sm underline underline-offset-2">
            {format === 'pdf' ? 'Open' : 'Download'} {title()}
          </a>
        </div>
      </Show>
      <Show when={format === 'dataset' && catalog()}>{(shown) => <DatasetCatalogView id={id} catalog={shown()} canEdit={canEdit()} />}</Show>
      <Show when={format === 'dataset' && !catalog()}>
        <p class="mt-4 font-sans text-xs text-muted" aria-label="Dataset summary">
          {rows().length.toLocaleString()} rows · {surface.columns.length} columns
          <Show when={rows().length > 50}><span class="text-faint"> · showing the first 50</span></Show>
        </p>
        <div class="mt-2 max-h-[70vh] overflow-auto rounded-[6px] border border-edge">
          <table class="w-full border-collapse font-mono text-xs">
            <thead class="sticky top-0 z-10 bg-raised">
              <tr class="border-b border-edge text-left text-faint">
                <For each={columns()}>{(column) => <th class="whitespace-nowrap px-3 py-2 font-normal">{column.name}<Show when={column.type}><span class="ml-1.5 text-[10px] text-faint">{column.type}</span></Show></th>}</For>
              </tr>
            </thead>
            <tbody>
              <For each={rows().slice(0, 50)}>{(row) => <tr class="border-b border-edge/50 text-muted">
                <For each={surface.columns.length ? surface.columns.map((column) => column.name) : Object.keys(row)}>{(name) =>
                  // A blank cell is MISSING; rendering it as '' makes an absent value look like an empty string.
                  <td class="whitespace-nowrap px-3 py-1.5">{row[name] === null || row[name] === undefined ? <span class="text-faint">—</span> : String(row[name])}</td>}</For>
              </tr>}</For>
            </tbody>
          </table>
        </div>
      </Show>
      <Show when={format === 'viz'}>
        <pre class="mt-4 overflow-x-auto rounded-[6px] border border-edge bg-surface p-4 font-mono text-xs text-muted">{content()}</pre>
      </Show>
    </main>
  </>;
}

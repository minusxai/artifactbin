/* @jsxImportSource solid-js */
/**
 * THE NEW-DATASET SCREEN (`/datasets/new`): choose the source first, then its own form. Live sources are the built-in
 * connectors (`GET /api/connections`, generated from the registry; one this install cannot run yet is shown, not
 * offered); stored sources are CSV and JSON rows, the existing upload flow (pages/DatasetEditor). `?source=<id>` opens
 * a source directly.
 */
import { createResource, createSignal, For, Match, Show, Switch, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { DatasetEditorPage } from '../pages/DatasetEditor';
import { apiRequest } from '../lib/api';
import { useSession } from '../lib/session';
import { Button } from '../ui/Button';
import { SectionHeading } from '../ui/PageHeader';
import { StatusMessage } from '../ui/StatusMessage';
import { LiveDatasetForm, VIEWER_NOTE, type ListedConnector } from './LiveDatasetForm';

const STORED = [
  { id: 'csv', label: 'CSV', summary: 'Upload a CSV file, or import a public Google Sheet. The rows are kept in Artifactbin.' },
  { id: 'json', label: 'JSON', summary: 'Paste JSON rows, one table or several. The rows are kept in Artifactbin.' },
] as const;

function SourceTile(props: { label: string; summary: string; note?: string; disabled?: boolean; onChoose: () => void }): JSX.Element {
  return <Button variant="secondary" shape="tile" class="h-full p-3" type="button" disabled={props.disabled} aria-label={props.disabled ? `${props.label}, not yet available` : props.label} onClick={props.onChoose}>
    <span class="block text-left">
      <span class="block text-sm font-semibold text-fg">{props.label}<Show when={props.note}><span class="ml-2 text-micro font-normal text-faint">{props.note}</span></Show></span>
      <span class="mt-1 block text-xs font-normal text-muted">{props.summary}</span>
    </span>
  </Button>;
}

export function NewDatasetPage(): JSX.Element {
  const { session } = useSession();
  const [source, setSource] = createSignal<string | null>(new URLSearchParams(window.location.search).get('source'));
  const [connectors] = createResource(async () => (await apiRequest<{ connectors: ListedConnector[] }>('/api/connections')).connectors);
  const live = () => connectors()?.find((c) => c.id === source() && c.available) ?? null;
  if (session() && !session()?.user) return <Navigate href={`/login?callbackUrl=${encodeURIComponent('/datasets/new')}`} />;
  return <Switch fallback={
    <section aria-label="Choose a data source" class="mx-auto max-w-4xl space-y-8 px-4 py-8 font-sans">
      <header><h1 class="text-xl font-semibold">New dataset</h1><p class="mt-1 text-sm text-muted">Choose where the data comes from.</p></header>
      <section aria-label="Live sources" class="space-y-3">
        <SectionHeading>Live</SectionHeading>
        <p class="text-xs text-muted">Query a database in place: pages read it as it is now, read-only. {VIEWER_NOTE}</p>
        <Show when={connectors()} fallback={<Show when={connectors.error} fallback={<StatusMessage kind="loading">Loading sources…</StatusMessage>}><StatusMessage kind="error">Could not load the sources.</StatusMessage></Show>}>
          <div class="grid gap-3 sm:grid-cols-3">
            <For each={connectors()!.filter((c) => c.group === 'live')}>{(c) => <SourceTile label={c.label} summary={c.summary} note={c.available ? undefined : 'Not yet available'} disabled={!c.available} onChoose={() => setSource(c.id)} />}</For>
          </div>
        </Show>
      </section>
      <section aria-label="Stored sources" class="space-y-3">
        <SectionHeading>Stored</SectionHeading>
        <div class="grid gap-3 sm:grid-cols-3">
          <For each={STORED}>{(s) => <SourceTile label={s.label} summary={s.summary} onChoose={() => setSource(s.id)} />}</For>
        </div>
      </section>
    </section>}>
    <Match when={source() === 'csv' || source() === 'json'}><DatasetEditorPage initialSource={source() as 'csv' | 'json'} /></Match>
    <Match when={live()}>{(c) => <div class="px-4 py-8"><LiveDatasetForm connector={c()} onBack={() => setSource(null)} /></div>}</Match>
  </Switch>;
}

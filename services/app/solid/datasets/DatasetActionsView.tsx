/* @jsxImportSource solid-js */
import { retryingFetch } from '@/lib/http/retry-lazily';
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { SectionHeading } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';

/** The parts of the policy API's GET (`/api/artifacts/:id/policy`, lib/dataset-graphql `policy`) this view reads. */
type Actions = {
  source: 'v3' | 'v1' | 'v2' | 'none' | 'unreadable';
  report: Array<{ code: string; message: string }>;
  readBackTables: Array<{ title: string; lines: string[] }>;
  warnings: Array<{ code: string; message: string }>;
};

/** Read-only inspection: the v3 read-back of who can see and change the data, from the editor-scoped policy API; never widens access. */
export function DatasetActionsView(props: { id: string; canInspect: boolean; kind?: string }): JSX.Element {
  return <section aria-label="Read-only data actions" class="space-y-5 text-sm">
    <header><SectionHeading>Data actions</SectionHeading><p class="mt-1 text-muted">Who can see and change this data. Use Edit dataset to change the rules.</p></header>
    <Show when={props.kind !== 'postgres'} fallback={<p class="text-muted">PostgreSQL datasets are read-only.</p>}>
      <Show when={props.canInspect} fallback={<p class="text-muted">Data action rules are visible to dataset editors.</p>}>
        <SavedActions id={props.id} />
      </Show>
    </Show>
  </section>;
}

function SavedActions(props: {id: string}): JSX.Element {
  const [state, setState] = createSignal<Actions>();
  const [error, setError] = createSignal('');
  onMount(() => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    void retryingFetch(`/api/artifacts/${encodeURIComponent(props.id)}/policy`, {signal: controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error('Could not load data action rules. Dataset edit access is required.');
        return response.json() as Promise<Actions>;
      }).then(value => { if (!controller.signal.aborted) setState(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load data action rules.'); });
  });
  return <>
    <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
    <Show when={!state() && !error()}><StatusMessage kind="loading">Loading data actions…</StatusMessage></Show>
    <Show when={state()}>{loaded => <>
      <Show when={loaded().source === 'none'}><p class="text-muted">No rules are saved yet. These are the defaults: everyone who reaches the dataset reads it, and only the owner and editors change rows.</p></Show>
      <Show when={loaded().source === 'unreadable'}><StatusMessage kind="error">The stored rules could not be read, so nobody below editor can use the data until new rules are saved.</StatusMessage></Show>
      <Show when={loaded().source === 'v1' || loaded().source === 'v2'}>
        <Panel padding="sm" label="Policy migration" class="space-y-2">
          <p class="font-medium">These rules use the older version {loaded().source === 'v1' ? 1 : 2} format. This is how they apply today; saving them in Edit dataset writes them as version 3 rules.</p>
          <ul class="list-disc space-y-1 pl-5"><For each={loaded().report}>{item => <li>{item.message}</li>}</For></ul>
        </Panel>
      </Show>
      <For each={loaded().readBackTables}>{table => <Panel padding="sm" class="space-y-2">
        <h3 class="font-semibold">{table.title}</h3>
        <ul class="list-disc space-y-1 pl-5"><For each={table.lines}>{line => <li>{line}</li>}</For></ul>
      </Panel>}</For>
      <Show when={loaded().warnings.length}><StatusMessage kind="caution"><ul class="list-disc pl-5"><For each={loaded().warnings}>{warning => <li>{warning.message}</li>}</For></ul></StatusMessage></Show>
    </>}</Show>
  </>;
}

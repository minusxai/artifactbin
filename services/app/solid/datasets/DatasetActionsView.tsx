/* @jsxImportSource solid-js */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { DatasetAccessPolicy, DatasetGrantSelector, DatasetOperation } from '@artifactbin/contracts';
import { displayTitle } from '@/lib/document/display-title';

type Actions = { policy: DatasetAccessPolicy | null; writtenBy: Array<{id: string; title: string | null; mutations: string[]}> };
const operations: DatasetOperation[] = ['insert', 'update', 'delete'];
const describeCaller = (from: DatasetGrantSelector) => Object.entries(from).map(([key, value]) => {
  if (key === 'user') return value === '*' ? 'Users with dataset access' : value === '$owner' ? 'Dataset owner' : `User ${value}`;
  if (key === 'artifactOwner') return value === '$owner' ? 'Apps owned by the dataset owner' : `Apps owned by ${value}`;
  return `Artifact ${value}`;
}).join(' · ');

/** Read-only inspection uses the existing editor-scoped policy door; never widens access. */
export function DatasetActionsView(props: { id: string; canInspect: boolean; kind?: string }): JSX.Element {
  return <section aria-label="Read-only data actions" class="space-y-5 text-sm">
    <header><h2 class="text-xl font-semibold">Data actions</h2><p class="mt-1 text-muted">View the rules for changing this dataset. Use Edit dataset to change them.</p></header>
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
    void fetch(`/api/my/artifacts/${encodeURIComponent(props.id)}/policy`, {signal: controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error('Could not load data action rules. Dataset edit access is required.');
        return response.json() as Promise<Actions>;
      }).then(value => { if (!controller.signal.aborted) setState(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load data action rules.'); });
  });
  const grants = () => { const policy = state()?.policy; return policy?.version === 2 ? policy.allow : []; };
  return <>
    <Show when={error()}><p role="alert" class="text-danger">{error()}</p></Show>
    <Show when={!state() && !error()}><p role="status" class="text-muted">Loading data actions…</p></Show>
    <Show when={state()}>{loaded => <>
      <Show when={loaded().policy} fallback={<p class="text-muted">No data action rules are configured.</p>}>{policy => <>
        <Show when={policy().version === 2}>
          <section class="space-y-3"><h3 class="font-semibold">Allowed actions</h3>
            <For each={grants()} fallback={<p class="text-muted">No actions are granted.</p>}>{grant => <div class="rounded border border-edge bg-surface p-4"><p class="font-medium">{grant.actions.join(', ')}</p><p class="mt-1 text-muted">{describeCaller(grant.from)}</p></div>}</For>
          </section>
        </Show>
        <section class="space-y-3"><h3 class="font-semibold">Table rules</h3>
          <Show when={policy().tables === undefined}><p class="text-muted">No additional table restrictions. Granted actions apply to all tables.</p></Show>
          <Show when={policy().tables?.length === 0}><p class="text-muted">No table writes are allowed.</p></Show>
          <For each={policy().tables}>{table => <section class="space-y-3 rounded border border-edge bg-surface p-4">
            <h4 class="font-mono font-semibold">{table.table.schema}.{table.table.name}</h4>
            <For each={operations}>{operation => <For each={table[`${operation}_permissions`]} fallback={<p class="text-muted">{operation}: not allowed</p>}>{entry => <details>
              <summary class="cursor-pointer font-medium">{operation} · {entry.role}</summary>
              <pre class="mt-2 overflow-x-auto rounded bg-raised p-3 font-mono text-xs">{JSON.stringify(entry.permission, null, 2)}</pre>
            </details>}</For>}</For>
          </section>}</For>
        </section>
        <section><h3 class="font-semibold">Blocked functions</h3><p class="mt-1 text-muted">{policy().execution?.functions?.deny?.join(', ') || 'None'}</p></section>
      </>}</Show>
      <section><h3 class="font-semibold">Connected apps</h3><ul class="mt-2 space-y-2"><For each={loaded().writtenBy} fallback={<li class="text-muted">No apps use these actions yet.</li>}>{app => <li><a class="text-accent underline" href={`/a/${app.id}`}>{displayTitle(app)}</a><span class="ml-2 text-muted">{app.mutations.join(', ')}</span></li>}</For></ul></section>
    </>}</Show>
  </>;
}

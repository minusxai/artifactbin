/* @jsxImportSource solid-js */
/**
 * A LIVE DATASET'S PAGE (lib/live-datasets `GET /api/artifacts/ID/connection`): its connector, host and database
 * (never a secret), who may use it (owner and editors run any SQL; the roles its rules admit run the queries pages
 * declare), the pages that declare queries on it and, for owners and editors, the tables its account reads.
 */
import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import type { ConnectorSchema } from '@artifactbin/contracts';
import { apiRequest } from '../lib/api';
import { Checkbox } from '../ui/Checkbox';
import { Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';
import { VIEWER_NOTE } from './LiveDatasetForm';

type Details = {
  role: string; declaredQueryRoles: string[];
  connection: { connector: string; label: string; fields: Record<string, string | number> };
  pages: Array<{ id: string; title: string | null; queries: string[] }>;
};
const FIELD_LABELS: Record<string, string> = { host: 'Host', port: 'Port', database: 'Database', project: 'Project', location: 'Location', dataset: 'Dataset' };
const ROLE_LABELS: Record<string, string> = { viewer: 'People it is shared with', signed_in: 'Anyone signed in who reads a page using it', anonymous: 'Anyone reading a page using it, signed in or not' };
const RULE_ROLES = ['viewer', 'signed_in', 'anonymous'] as const;
/** The rules document for "these roles run declared queries" (lib/datasets live-rules), saved over the current revision. */
async function saveRoles(id: string, roles: string[]): Promise<void> {
  const route = `/api/artifacts/${encodeURIComponent(id)}/policy`;
  const current = await apiRequest<{ revision: number }>(route);
  await apiRequest(route, 'PUT', { expectedPolicyRevision: current.revision, policy: { version: 3, tables: [{ table: { schema: 'public', name: 'queries' }, select_permissions: roles.map((role) => ({ role, permission: { columns: '*', filter: {} } })) }] } });
}

export function LiveDatasetView(props: { id: string }): JSX.Element {
  const [details, { refetch }] = createResource(() => props.id, (id) => apiRequest<Details>(`/api/artifacts/${encodeURIComponent(id)}/connection`));
  const [saving, setSaving] = createSignal(false);
  const [ruleError, setRuleError] = createSignal('');
  const toggle = async (role: string, on: boolean) => {
    const now = details()?.declaredQueryRoles ?? [];
    setSaving(true); setRuleError('');
    try { await saveRoles(props.id, RULE_ROLES.filter((r) => (r === role ? on : now.includes(r)))); await refetch(); }
    catch (error) { setRuleError(error instanceof Error ? error.message : 'Could not save who may run declared queries.'); }
    finally { setSaving(false); }
  };
  const admin = () => details()?.role === 'owner' || details()?.role === 'editor';
  const [schema] = createResource(() => (admin() ? props.id : null), (id) => apiRequest<ConnectorSchema>(`/api/artifacts/${encodeURIComponent(id)}/connection/schema`));
  return <div class="mt-4 space-y-4 font-sans">
    <Show when={details()} fallback={<Show when={details.error} fallback={<StatusMessage kind="loading">Loading the connection…</StatusMessage>}><StatusMessage kind="error">Could not load the connection.</StatusMessage></Show>}>{(d) => <>
      <Panel label="Connection" title="Live connection">
        <p class="text-sm text-muted">Queried in place, read-only: the rows stay in this database.</p>
        <dl class="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
          <dt class="text-muted">Connector</dt><dd>{d().connection.label}</dd>
          <For each={Object.entries(d().connection.fields)}>{([name, value]) => <><dt class="text-muted">{FIELD_LABELS[name] ?? name}</dt><dd class="break-all">{String(value)}</dd></>}</For>
        </dl>
      </Panel>
      <Panel label="Who can use it" title="Who can use it">
        <p class="text-sm">Its owner and editors: any SQL, from a page or an agent.</p>
        <Show when={admin()} fallback={<ul class="mt-2 list-disc space-y-1 pl-5 text-sm"><For each={d().declaredQueryRoles}>{(role) => <li>{ROLE_LABELS[role] ?? role}: the queries pages declare on it.</li>}</For></ul>}>
          <fieldset class="mt-3 space-y-2" aria-label="Who may run declared queries">
            <legend class="mb-1 text-sm text-muted">May run the queries pages declare on it:</legend>
            <For each={RULE_ROLES}>{(role) => <Checkbox label={ROLE_LABELS[role]} checked={d().declaredQueryRoles.includes(role)} disabled={saving()} onChange={(on) => void toggle(role, on)} />}</For>
          </fieldset>
          <Show when={ruleError()}><StatusMessage kind="error" class="mt-2">{ruleError()}</StatusMessage></Show>
        </Show>
        <Show when={!d().declaredQueryRoles.length}><p class="mt-2 text-xs text-muted">No one else yet: readers of a page using it see no rows until their role is allowed here.</p></Show>
        <p class="mt-2 text-xs text-muted">{VIEWER_NOTE}</p>
      </Panel>
      <Panel label="Pages declaring queries" title="Pages declaring queries">
        <Show when={d().pages.length} fallback={<p class="text-sm text-muted">No page you can open declares a query on it yet.</p>}>
          <ul class="space-y-1 text-sm"><For each={d().pages}>{(page) => <li><a class="underline" href={`/a/${page.id}`}>{page.title ?? page.id}</a><span class="text-muted"> · {page.queries.length ? page.queries.join(', ') : 'links it, no declared queries'}</span></li>}</For></ul>
        </Show>
      </Panel>
      <Show when={admin()}>
        <Panel label="Tables" title="Tables">
          <Show when={schema()} fallback={<Show when={schema.error} fallback={<StatusMessage kind="loading">Reading the tables…</StatusMessage>}><StatusMessage kind="error">{schema.error instanceof Error ? schema.error.message : 'Could not read the tables.'}</StatusMessage></Show>}>{(s) =>
            <ul class="space-y-2 text-sm"><For each={s().tables}>{(t) => <li><span class="font-mono">{t.namespace}.{t.name}</span><span class="text-xs text-muted"> {t.kind} · {t.columns.map((c) => `${c.name} ${c.type}`).join(', ')}</span></li>}</For></ul>}</Show>
        </Panel>
      </Show>
    </>}</Show>
  </div>;
}

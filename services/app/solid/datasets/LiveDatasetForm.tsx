/* @jsxImportSource solid-js */
/**
 * A LIVE DATASET'S FORM (lib/live-datasets), drawn from its connector's own fields (contracts `ConnectorSpec`, served
 * by `GET /api/connections`): create (name, owner, the fields, Test connection, Create) or, with `datasetId`, edit
 * (owner and editors: the non-secret fields as stored, Test connection, Save). Secret inputs are write-only: never
 * prefilled, sent only when typed; the server keeps a stored secret only while nothing it depends on moves.
 */
import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import type { ConnectorField, ConnectorSpec, ConnectorTestResult, GroupSummary } from '@artifactbin/contracts';
import { apiFetch, apiRequest } from '../lib/api';
import { creationDestination } from '../lib/creation-destination';
import { Button } from '../ui/Button';
import { Field, Input, Textarea } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { Select } from '../ui/Select';
import { StatusMessage } from '../ui/StatusMessage';

export type ListedConnector = ConnectorSpec & { available: boolean };
type Details = { config?: Record<string, string | number>; secrets?: string[]; connection: { connector: string; label: string } };
const PERSONAL = 'personal';
export const VIEWER_NOTE = 'Queries may use :viewer_id, :viewer_email and :viewer_groups: the server fills them for the person reading.';

/** The typed fields as the connector's configuration: whole numbers as numbers, blanks left out. */
function configOf(spec: ConnectorSpec, values: Record<string, string>, keep: (field: ConnectorField) => boolean = () => true): Record<string, string | number> {
  const out: Record<string, string | number> = { connector: spec.id };
  for (const field of spec.fields) {
    const v = values[field.name]?.trim() ?? '';
    if (!v || !keep(field)) continue;
    out[field.name] = field.kind === 'integer' && /^\d+$/.test(v) ? Number(v) : v;
  }
  return out;
}

function FieldInput(props: { field: ConnectorField; value: string; stored: boolean; onInput: (value: string) => void; disabled: boolean }): JSX.Element {
  const f = props.field;
  const hint = () => f.secret ? (props.stored ? `${f.description} Stored; leave blank to keep it.` : f.description) : f.description.replaceAll('`', '');
  return <Field label={`${f.label}${f.required && !(f.secret && props.stored) ? ' (required)' : ''}`} hint={hint()}>
    {f.kind === 'choice'
      ? <Select value={props.value || String(f.default ?? '')} options={(f.choices ?? []).map((c) => ({ value: c, label: c }))} onChange={props.onInput} disabled={props.disabled} />
      : f.kind === 'pem' || f.kind === 'json'
        ? <Textarea size="sm" rows={4} spellcheck={false} value={props.value} disabled={props.disabled} autocomplete="off" onInput={(e) => props.onInput(e.currentTarget.value)} />
        : <Input type={f.secret ? 'password' : f.kind === 'integer' ? 'number' : 'text'} value={props.value} disabled={props.disabled}
            autocomplete={f.secret ? 'new-password' : 'off'} placeholder={f.default !== undefined ? String(f.default) : ''} onInput={(e) => props.onInput(e.currentTarget.value)} />}
  </Field>;
}

export function LiveDatasetForm(props: { connector: ListedConnector; datasetId?: string; onBack?: () => void }): JSX.Element {
  const spec = props.connector;
  const editing = !!props.datasetId;
  const [values, setValues] = createSignal<Record<string, string>>({});
  const [title, setTitle] = createSignal('');
  const [owner, setOwner] = createSignal(creationDestination(window.location.search)?.type === 'group' ? (creationDestination(window.location.search) as { id: string }).id : PERSONAL);
  const [busy, setBusy] = createSignal<'' | 'test' | 'save'>('');
  const [result, setResult] = createSignal<{ kind: 'notice' | 'error'; text: string } | null>(null);
  const [stored] = createResource(() => props.datasetId, async (id) => {
    const details = await apiRequest<Details>(`/api/artifacts/${encodeURIComponent(id)}/connection`);
    setValues(Object.fromEntries(Object.entries(details.config ?? {}).filter(([k]) => k !== 'connector').map(([k, v]) => [k, String(v)])));
    return details;
  });
  const [groups] = createResource(() => !editing, async () => (await apiRequest<{ groups: GroupSummary[] }>('/api/groups')).groups.filter((g) => g.role === 'editor'), { initialValue: [] });
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  const storedSecret = (field: ConnectorField) => field.secret && !!stored()?.secrets?.includes(field.name);
  const say = (kind: 'notice' | 'error', text: string) => setResult({ kind, text });

  const test = async () => {
    setBusy('test'); setResult(null);
    try {
      const response = editing
        ? await apiFetch(`/api/artifacts/${encodeURIComponent(props.datasetId!)}/connection/test`, 'POST', {})
        : await apiFetch('/api/connections/test', 'POST', { connection: configOf(spec, values()) });
      const body = await response.json() as ConnectorTestResult & { message?: string };
      if (!response.ok) say('error', body.message ?? 'Could not test the connection.');
      else say(body.ok ? 'notice' : 'error', body.ok ? `Connected in ${body.latencyMs} ms.` : `${body.error.code}: ${body.error.message}`);
    } catch { say('error', 'Could not test the connection. Try again.'); }
    finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('save'); setResult(null);
    try {
      if (editing) {
        // Only what changed, and a secret only when typed: an untouched secret stays stored.
        const before = stored()?.config ?? {};
        const typed = configOf(spec, values());
        const changed: Record<string, string | number | null> = {};
        for (const field of spec.fields) {
          const next = typed[field.name];
          if (field.secret) { if (next !== undefined) changed[field.name] = next; continue; }
          if (String(next ?? '') !== String(before[field.name] ?? '')) changed[field.name] = next ?? null;
        }
        await apiRequest(`/api/artifacts/${encodeURIComponent(props.datasetId!)}/connection`, 'PATCH', changed);
        say('notice', 'Saved. Secrets you left blank are kept.');
        setValues((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !spec.fields.some((f) => f.secret && f.name === k))));
      } else {
        const name = title().trim();
        if (!name) throw new Error('Give the dataset a name.');
        const created = await apiRequest<{ id: string }>('/api/my/artifacts', 'POST', {
          connection: configOf(spec, values()), title: name,
          destination: owner() === PERSONAL ? { type: 'personal' } : { type: 'group', id: owner() },
        });
        window.location.assign(`/a/${created.id}`);
      }
    } catch (error) { say('error', error instanceof Error ? error.message : 'Could not save the dataset.'); }
    finally { setBusy(''); }
  };

  return <Panel label={`${spec.label} connection`} title={editing ? `Edit ${spec.label} connection` : `New ${spec.label} dataset`} class="mx-auto max-w-2xl font-sans"
    actions={props.onBack ? <Button variant="ghost" size="sm" type="button" onClick={props.onBack}>Choose another source</Button> : undefined}>
    <form class="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p class="text-sm text-muted">{spec.summary} The rows stay in your database; pages query it in place, read-only.</p>
      <Show when={!editing}>
        <Field label="Name (required)"><Input value={title()} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="Orders database" /></Field>
        <Field label="Owner" hint="A group's editors can change a dataset the group owns.">
          <Select value={owner()} onChange={setOwner} options={[{ value: PERSONAL, label: 'Me' }, ...groups().map((g) => ({ value: g.id, label: g.name }))]} />
        </Field>
      </Show>
      <Show when={!editing || stored()} fallback={<StatusMessage kind="loading">Loading the connection…</StatusMessage>}>
        <For each={spec.fields}>{(field) => <FieldInput field={field} value={values()[field.name] ?? ''} stored={storedSecret(field)} disabled={!!busy()} onInput={(v) => set(field.name, v)} />}</For>
      </Show>
      <Show when={editing}><p class="text-xs text-muted">Changing the host, port, database, user, TLS or certificate needs the password again, so a stored password is never sent to a different server.</p></Show>
      <p class="text-xs text-muted">{VIEWER_NOTE}</p>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="secondary" type="button" disabled={!!busy()} onClick={() => void test()}>{busy() === 'test' ? 'Testing…' : 'Test connection'}</Button>
        <Button type="submit" disabled={!!busy() || (!editing && !title().trim())}>{busy() === 'save' ? 'Saving…' : editing ? 'Save connection' : 'Create dataset'}</Button>
      </div>
      <Show when={result()}>{(r) => <StatusMessage kind={r().kind}>{r().text}</StatusMessage>}</Show>
    </form>
  </Panel>;
}

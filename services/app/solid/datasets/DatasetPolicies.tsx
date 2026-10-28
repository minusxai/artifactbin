/* @jsxImportSource solid-js */
import { retryingFetch } from '@/lib/http/retry-lazily';
import { createMemo, createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { parse as parseYaml } from 'yaml';
import { parseDatasetAccessPolicy } from '@artifactbin/utils/dataset-grants';
import type { DatasetAccessPolicy, DatasetOperation, DatasetTablePolicy, InsertPermission, UpdatePermission, DeletePermission } from '@artifactbin/contracts';
import { Disclosure } from '../ui/Disclosure';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Field, Input, Textarea } from '../ui/Field';
import { SectionHeading } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { Select } from '../ui/Select';
import { StatusMessage } from '../ui/StatusMessage';
import { PolicyConditions } from './PolicyConditions';
import { apiFetch } from '../lib/api';
import { artifactLink } from '../lib/artifact-link';

type Table = { schema: string; name: string; columns: Array<{ name: string }> };
type PolicyState = { canManage?: boolean; policy: DatasetAccessPolicy | null; revision: number; tables: Table[]; writtenBy: Array<{ id: string; title: string | null; mutations: string[] }> };
type Permission = InsertPermission | UpdatePermission | DeletePermission;
const operations: DatasetOperation[] = ['insert', 'update', 'delete'];
const blank = (tables: Table[]): DatasetAccessPolicy => ({ version: 1, enforcement: 'enabled', tables: tables.map(table => ({ table: { schema: table.schema, name: table.name } })) });
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/** The server remains the admission and validation boundary for every policy write. */
export function DatasetPolicies(props: { artifactId: string; expanded?: boolean; saveTarget?: HTMLElement }): JSX.Element {
  const [open, setOpen] = createSignal(Boolean(props.expanded));
  return <div>
    <Show when={!props.expanded}><Button variant="secondary" aria-expanded={open()} onClick={() => setOpen(value => !value)}>Manage access policies</Button></Show>
    <Show when={open()}><PolicyEditor artifactId={props.artifactId} saveTarget={props.saveTarget} /></Show>
  </div>;
}

function PolicyEditor(props: { artifactId: string; saveTarget?: HTMLElement }): JSX.Element {
  const [state, setState] = createSignal<PolicyState | null>(null);
  const [draft, setDraft] = createSignal<DatasetAccessPolicy | null>(null);
  const [source, setSource] = createSignal<string | null>(null);
  const [tableIndex, setTableIndex] = createSignal(0);
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [deniedText, setDeniedText] = createSignal('');
  onMount(() => {
    let alive = true;
    void retryingFetch(`/api/my/artifacts/${encodeURIComponent(props.artifactId)}/policy`).then(async response => {
      if (!response.ok) throw new Error('Dataset edit access is required to inspect its data rules.');
      return response.json() as Promise<PolicyState>;
    }).then(value => { if (!alive) return; setState(value); setDraft(value.policy ?? blank(value.tables)); setDeniedText((value.policy?.execution?.functions?.deny ?? []).join(', ')); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'Could not load policies.'); });
    return () => { alive = false; };
  });
  const change = (policy: DatasetAccessPolicy | null) => { setDraft(policy); setNotice(''); setError(''); };
  const selected = createMemo(() => draft()?.tables?.[tableIndex()]);
  const columns = createMemo(() => state()?.tables.find(table => table.schema === selected()?.table.schema && table.name === selected()?.table.name)?.columns ?? []);
  const permission = (op: DatasetOperation): Permission | undefined => selected()?.[`${op}_permissions`]?.find(entry => entry.role === 'viewer')?.permission as Permission | undefined;
  const setPermission = (op: DatasetOperation, value: Permission | null) => {
    const policy = draft(), table = selected(); if (!policy || !table) return;
    const field = `${op}_permissions` as const;
    const previous = table[field]?.find(entry => entry.role === 'viewer');
    const remaining = (table[field] ?? []).filter(entry => entry.role !== 'viewer');
    const nextTable: DatasetTablePolicy = { ...table, [field]: value ? [...remaining, { ...previous, role: 'viewer', permission: value }] : remaining };
    change({ ...policy, tables: (policy.tables ?? []).map((entry, index) => index === tableIndex() ? nextTable : entry) } as DatasetAccessPolicy);
  };
  const save = async () => {
    const loaded = state(); if (!loaded) return;
    setSaving(true); setError('');
    try {
      const policy = draft() ? parseDatasetAccessPolicy(draft()) : null;
      const response = await apiFetch(`/api/my/artifacts/${encodeURIComponent(props.artifactId)}/policy`, 'PUT', { policy, expectedPolicyRevision: loaded.revision });
      const answer = await response.json();
      if (!response.ok) throw new Error(answer.detail ?? answer.error ?? 'Could not save policies.');
      setState({ ...loaded, policy: answer.policy, revision: answer.revision }); setDraft(answer.policy); setNotice('Access policies saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save policies.'); }
    finally { setSaving(false); }
  };
  const saveButton = (compact = false) => <Button aria-label="Save access policies" disabled={!state() || state()?.canManage === false || saving() || source() !== null} onClick={() => void save()}>{saving() ? 'Saving…' : compact ? 'Save' : 'Save access policies'}</Button>;
  return <section aria-label="Access policies" class="space-y-5 py-4 text-sm text-fg">
    <header class="flex flex-wrap justify-between gap-3"><div><SectionHeading>Control how data can change</SectionHeading><p class="mt-1 text-muted">Choose allowed actions, then narrow them with column and row rules.</p></div>
      <Show when={state() && state()?.canManage !== false && source() === null}><Button variant="secondary" onClick={() => setSource(pretty(draft()))}>Edit JSON / YAML</Button></Show></header>
    <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
    <Show when={!state() && !error()}><StatusMessage kind="loading">Loading data actions…</StatusMessage></Show>
    <Show when={state()?.canManage === false}><p>Dataset edit access is required to change these rules.</p></Show>
    <Show when={state() && state()?.canManage !== false}>
      <Show when={source() !== null} fallback={<>
        <Show when={draft()?.tables?.length}><Field label="Rules for table"><Select ariaLabel="Policy table" value={String(tableIndex())} options={(draft()?.tables ?? []).map((entry, index) => ({ value: String(index), label: `${entry.table.schema}.${entry.table.name}` }))} onChange={value => setTableIndex(Number(value))} /></Field></Show>
        <Show when={selected()}><For each={operations}>{op => {
          const current = () => permission(op);
          return <Panel padding="sm"><Checkbox class="font-semibold" label={<><span class="sr-only">Allow </span>{op}</>} checked={Boolean(current())} onChange={checked => setPermission(op, checked ? op === 'insert' ? { columns: '*', check: {} } : op === 'update' ? { columns: '*', filter: {}, check: {} } : { filter: {} } : null)} />
            <Show when={current() && 'columns' in current()!}><div class="mt-3 space-y-2">
              <Checkbox label={<><span class="sr-only">{op} all columns</span><span aria-hidden="true">Allow all columns</span></>} checked={(current() as InsertPermission | UpdatePermission).columns === '*'} onChange={checked => setPermission(op, { ...current(), columns: checked ? '*' : [] } as Permission)} />
              <Show when={(current() as InsertPermission | UpdatePermission).columns !== '*'}><For each={columns()}>{column => <Checkbox label={<><span class="sr-only">{op} column </span>{column.name}</>} checked={((current() as InsertPermission | UpdatePermission).columns as string[] ?? []).includes(column.name)} onChange={checked => { const prior = ((current() as InsertPermission | UpdatePermission).columns as string[] ?? []); setPermission(op, { ...current(), columns: checked ? [...prior, column.name] : prior.filter(name => name !== column.name) } as Permission); }} />}</For></Show>
            </div></Show>
            <Show when={current() && 'filter' in current()!}><PolicyConditions label={`${op} filter`} title="Which existing rows can change?" value={(current() as UpdatePermission | DeletePermission).filter ?? {}} columns={columns()} onChange={filter => setPermission(op, { ...current(), filter } as Permission)} /></Show>
            <Show when={current() && op !== 'delete'}><PolicyConditions label={`${op} check`} title="What must the new values satisfy?" value={(current() as InsertPermission | UpdatePermission).check ?? {}} columns={columns()} onChange={check => setPermission(op, { ...current(), check } as Permission)} /></Show>
          </Panel>;
        }}</For></Show>
        <Field label="Blocked functions"><Input aria-label="Denied functions" value={deniedText()} onInput={event => { const text = event.currentTarget.value; setDeniedText(text); const policy = draft(); if (policy) change({ ...policy, execution: { ...policy.execution, functions: { ...policy.execution?.functions, deny: text.split(',').map(item => item.trim()).filter(Boolean) } } }); }} /></Field>
        <section><h3 class="font-semibold">Connected apps</h3><Show when={state()?.writtenBy?.length} fallback={<p>No apps use these actions yet.</p>}><For each={state()?.writtenBy}>{item => <p><a {...artifactLink(`/a/${item.id}`, 'markup')}>{item.title ?? item.id}</a> · {item.mutations.join(', ')}</p>}</For></Show></section>
      </>}>
        <Field label="Policy JSON or YAML"><Textarea size="sm" rows={24} aria-label="Policy JSON or YAML" spellcheck={false} value={source() ?? ''} onInput={event => setSource(event.currentTarget.value)} /></Field>
        <div class="flex gap-2"><Button onClick={() => { try { change(parseDatasetAccessPolicy(parseYaml(source()!))); setSource(null); setTableIndex(0); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid policy'); } }}>Apply policy source</Button><Button variant="secondary" onClick={() => setSource(null)}>Cancel source changes</Button></div>
      </Show>
      <Disclosure summary="Review permission changes"><pre class="mt-2 overflow-x-auto font-mono text-xs">{pretty(draft())}</pre></Disclosure>
      <Panel padding="sm" class="flex items-center justify-between gap-3"><p role="status">{notice() || (pretty(draft()) !== pretty(state()?.policy) ? 'You have unsaved rule changes.' : 'Rules are up to date.')}</p><Show when={props.saveTarget} fallback={saveButton()}>{target => <Portal mount={target()}>{saveButton(true)}</Portal>}</Show></Panel>
    </Show>
  </section>;
}

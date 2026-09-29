/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { parse as parseYaml } from 'yaml';
import { parseDatasetAccessPolicy } from '@artifactbin/utils/dataset-grants';
import type { DatasetAccessPolicy, DatasetOperation, DatasetTablePolicy, InsertPermission, UpdatePermission, DeletePermission } from '@artifactbin/contracts';
import { Button } from './ui';

type Table = { schema: string; name: string; columns: Array<{ name: string }> };
type PolicyState = { canManage?: boolean; policy: DatasetAccessPolicy | null; revision: number; tables: Table[]; writtenBy: Array<{ id: string; title: string | null; mutations: string[] }> };
type Permission = InsertPermission | UpdatePermission | DeletePermission;
const operations: DatasetOperation[] = ['insert', 'update', 'delete'];
const blank = (tables: Table[]): DatasetAccessPolicy => ({ version: 1, enforcement: 'enabled', tables: tables.map(table => ({ table: { schema: table.schema, name: table.name } })) });
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const control = 'w-full rounded border border-edge bg-surface px-3 py-2 text-sm text-fg';

/** The server remains the admission and validation boundary for every policy write. */
export function DatasetPolicies(props: { artifactId: string; expanded?: boolean }): JSX.Element {
  const [open, setOpen] = createSignal(Boolean(props.expanded));
  return <div>
    <Show when={!props.expanded}><Button variant="ghost" aria-expanded={open()} onClick={() => setOpen(value => !value)}>Manage access policies</Button></Show>
    <Show when={open()}><PolicyEditor artifactId={props.artifactId} /></Show>
  </div>;
}

function PolicyEditor(props: { artifactId: string }): JSX.Element {
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
    void fetch(`/api/my/artifacts/${encodeURIComponent(props.artifactId)}/policy`).then(async response => {
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
      const response = await fetch(`/api/my/artifacts/${encodeURIComponent(props.artifactId)}/policy`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policy, expectedPolicyRevision: loaded.revision }) });
      const answer = await response.json();
      if (!response.ok) throw new Error(answer.detail ?? answer.error ?? 'Could not save policies.');
      setState({ ...loaded, policy: answer.policy, revision: answer.revision }); setDraft(answer.policy); setNotice('Access policies saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save policies.'); }
    finally { setSaving(false); }
  };
  return <section aria-label="Access policies" class="space-y-5 py-4 text-sm text-fg">
    <header class="flex flex-wrap justify-between gap-3"><div><h2 class="text-xl font-semibold">Control how data can change</h2><p class="mt-1 text-muted">Choose allowed actions, then narrow them with column and row rules.</p></div>
      <Show when={state() && state()?.canManage !== false && source() === null}><Button variant="ghost" onClick={() => setSource(pretty(draft()))}>Edit JSON / YAML</Button></Show></header>
    <Show when={error()}><p role="alert" class="rounded border border-danger/30 bg-danger-soft p-3 text-danger">{error()}</p></Show>
    <Show when={!state() && !error()}><p role="status">Loading data actions…</p></Show>
    <Show when={state()?.canManage === false}><p>Dataset edit access is required to change these rules.</p></Show>
    <Show when={state() && state()?.canManage !== false}>
      <Show when={source() !== null} fallback={<>
        <Show when={draft()?.tables?.length}><label class="grid gap-1">Rules for table<select aria-label="Policy table" class={control} value={tableIndex()} onInput={event => setTableIndex(Number(event.currentTarget.value))}>
          <For each={draft()?.tables ?? []}>{(entry, index) => <option value={index()}>{entry.table.schema}.{entry.table.name}</option>}</For>
        </select></label></Show>
        <Show when={selected()}><For each={operations}>{op => {
          const current = () => permission(op);
          return <section class="rounded border border-edge bg-surface p-4"><label class="flex items-center gap-2 font-semibold"><input type="checkbox" aria-label={`Allow ${op}`} checked={Boolean(current())} onChange={event => setPermission(op, event.currentTarget.checked ? op === 'insert' ? { columns: '*', check: {} } : op === 'update' ? { columns: '*', filter: {}, check: {} } : { filter: {} } : null)} />{op}</label>
            <Show when={current() && 'columns' in current()!}><div class="mt-3 space-y-2"><label class="flex gap-2"><input type="checkbox" aria-label={`${op} all columns`} checked={(current() as InsertPermission | UpdatePermission).columns === '*'} onChange={event => setPermission(op, { ...current(), columns: event.currentTarget.checked ? '*' : [] } as Permission)} />Allow all columns</label>
              <Show when={(current() as InsertPermission | UpdatePermission).columns !== '*'}><For each={columns()}>{column => <label class="flex gap-2"><input type="checkbox" aria-label={`${op} column ${column.name}`} checked={((current() as InsertPermission | UpdatePermission).columns as string[] ?? []).includes(column.name)} onChange={event => { const prior = ((current() as InsertPermission | UpdatePermission).columns as string[] ?? []); setPermission(op, { ...current(), columns: event.currentTarget.checked ? [...prior, column.name] : prior.filter(name => name !== column.name) } as Permission); }} />{column.name}</label>}</For></Show>
            </div></Show>
          </section>;
        }}</For></Show>
        <label class="grid gap-1">Blocked functions<input aria-label="Denied functions" class={control} value={deniedText()} onInput={event => { const text = event.currentTarget.value; setDeniedText(text); const policy = draft(); if (policy) change({ ...policy, execution: { ...policy.execution, functions: { ...policy.execution?.functions, deny: text.split(',').map(item => item.trim()).filter(Boolean) } } }); }} /></label>
        <section><h3 class="font-semibold">Connected apps</h3><Show when={state()?.writtenBy?.length} fallback={<p>No apps use these actions yet.</p>}><For each={state()?.writtenBy}>{item => <p><a href={`/a/${item.id}`}>{item.title ?? item.id}</a> · {item.mutations.join(', ')}</p>}</For></Show></section>
      </>}>
        <label class="grid gap-1">Policy JSON or YAML<textarea aria-label="Policy JSON or YAML" spellcheck={false} class={`${control} min-h-96 font-mono`} value={source() ?? ''} onInput={event => setSource(event.currentTarget.value)} /></label>
        <div class="flex gap-2"><Button onClick={() => { try { change(parseDatasetAccessPolicy(parseYaml(source()!))); setSource(null); setTableIndex(0); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid policy'); } }}>Apply policy source</Button><Button variant="ghost" onClick={() => setSource(null)}>Cancel source changes</Button></div>
      </Show>
      <details><summary>Review permission changes</summary><pre>{pretty(draft())}</pre></details>
      <footer class="flex items-center justify-between gap-3 rounded border border-edge bg-surface p-3"><p role="status">{notice() || (pretty(draft()) !== pretty(state()?.policy) ? 'You have unsaved rule changes.' : 'Rules are up to date.')}</p><Button disabled={saving() || source() !== null} onClick={() => void save()}>{saving() ? 'Saving policies…' : 'Save access policies'}</Button></footer>
    </Show>
  </section>;
}
